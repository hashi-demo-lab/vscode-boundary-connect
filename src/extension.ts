/**
 * Boundary VS Code Extension
 *
 * Integrates HashiCorp Boundary with VS Code Remote SSH for seamless
 * secure access to infrastructure.
 *
 * Architecture:
 * - AuthStateManager: Single source of truth for auth state
 * - AuthManager: Orchestrates auth operations
 * - TargetProvider: UI component that listens to auth state
 * - CLI: Boundary CLI wrapper (keyring is source of truth for tokens)
 */

import * as vscode from 'vscode';
import { BoundaryTarget, IAuthManager, ITargetProvider } from './types';
import { AuthManager, createAuthManager } from './auth/authManager';
import { createAuthStateManager, disposeAuthStateManager } from './auth/authState';
import { executePasswordAuth } from './auth/passwordAuth';
import { executeOidcAuth } from './auth/oidcAuth';
import { BoundaryCLI, disposeBoundaryCLI } from './boundary/cli';
import { TargetProvider } from './targets/targetProvider';
import { TargetService, disposeTargetService } from './targets/targetService';
import { ConnectionManager, disposeConnectionManager } from './connection/connectionManager';
import { cleanupBoundarySSHConfigEntries } from './connection/remoteSSH';
import { StatusBarManager, disposeStatusBarManager } from './ui/statusBar';
import { showAuthMethodPicker, showTargetPicker, showSessionsList } from './ui/quickPick';
import { createSessionsPanelProvider, disposeSessionsPanelProvider } from './ui/sessionsPanel';
import { getTargetDecorationProvider, disposeTargetDecorationProvider } from './ui/decorationProvider';
import { ConfigurationService, disposeConfigurationService } from './utils/config';
import { Logger, LogLevel, logger } from './utils/logger';
import { BoundaryError, BoundaryErrorCode } from './utils/errors';
import {
  createServiceContainer,
  disposeServiceContainer,
  IServiceContainer,
  ServiceFactories,
  setGlobalContainer,
} from './services/container';

let authManager: IAuthManager;
let targetProvider: ITargetProvider;
let serviceContainer: IServiceContainer;

/**
 * Create the service factory functions for dependency injection
 */
function createServiceFactories(): ServiceFactories {
  return {
    config: () => new ConfigurationService(),
    cli: (config) => new BoundaryCLI(config),
    authState: () => createAuthStateManager(),
    auth: (context, cli, authState) => createAuthManager(context, cli, authState),
    targets: (cli) => new TargetService(cli),
    connections: (cli, context) => {
      const manager = new ConnectionManager(cli, context.globalState);
      return manager;
    },
    statusBar: () => new StatusBarManager(),
  };
}

/**
 * Welcome view context state
 */
interface WelcomeViewContext {
  cliInstalled: boolean;
  addrConfigured: boolean;
}

/**
 * Update welcome view context values based on current state.
 * This enables smart welcome views that guide users through setup.
 */
async function updateWelcomeViewContext(container: IServiceContainer): Promise<WelcomeViewContext> {
  const cli = container.cli;
  const config = container.config;

  // Check CLI installation
  const cliInstalled = await cli.checkInstalled();
  await vscode.commands.executeCommand('setContext', 'boundary.cliInstalled', cliInstalled);

  // Check if address is configured (setting or env var)
  const addrSetting = config.get('addr');
  const addrEnvVar = process.env.BOUNDARY_ADDR;
  const addrConfigured = !!(addrSetting || addrEnvVar);
  await vscode.commands.executeCommand('setContext', 'boundary.addrConfigured', addrConfigured);

  logger.debug('Welcome view context updated:', { cliInstalled, addrConfigured });
  return { cliInstalled, addrConfigured };
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info('Activating Boundary extension');

  // Create service container with all dependencies
  serviceContainer = createServiceContainer(context, createServiceFactories());
  setGlobalContainer(serviceContainer);

  // Initialize configuration
  const config = serviceContainer.config;
  const logLevel = (process.env.BOUNDARY_LOG_LEVEL || config.get('logLevel')) as LogLevel;
  logger.setLogLevel(logLevel);
  logger.debug('Extension activation started with log level:', logLevel);

  // Listen for config changes (log level + welcome view context)
  context.subscriptions.push(
    config.onConfigurationChanged(async cfg => {
      logger.setLogLevel(cfg.logLevel);
      // Re-evaluate welcome view context when config changes
      await updateWelcomeViewContext(serviceContainer);
    })
  );

  // Set welcome view context values (CLI installed, address configured)
  // This enables smart welcome views that guide users through setup
  const welcomeContext = await updateWelcomeViewContext(serviceContainer);

  if (welcomeContext.cliInstalled) {
    const version = await serviceContainer.cli.getVersion();
    logger.info('Boundary CLI version:', version || 'unknown');
  } else {
    logger.warn('Boundary CLI not found - welcome view will guide installation');
  }

  if (!welcomeContext.addrConfigured) {
    logger.warn('Boundary address not configured - welcome view will guide configuration');
  }

  // Initialize auth manager from container
  authManager = serviceContainer.auth;
  context.subscriptions.push(authManager);

  // Initialize auth state BEFORE creating TargetProvider to avoid race condition
  // TargetProvider subscribes to auth state changes, so we need auth state resolved first
  await (authManager as AuthManager).initialize();
  logger.debug('Auth initialization complete, state:', (authManager as AuthManager).state);

  // Initialize target provider with injected dependencies (after auth init to prevent race condition)
  targetProvider = new TargetProvider(serviceContainer.targets, serviceContainer.authState);
  targetProvider.setAuthManager(authManager); // Wire up for token expiration handling
  targetProvider.initialize(); // Set up event subscriptions
  context.subscriptions.push(targetProvider);

  // Auto-fetch targets if already authenticated AND address is configured
  // (since state change fired before subscription)
  if ((authManager as AuthManager).state === 'authenticated' && welcomeContext.addrConfigured) {
    targetProvider.refresh();
  }

  // Register TreeView
  const treeView = vscode.window.createTreeView('boundary.targets', {
    treeDataProvider: targetProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register Sessions Panel (Webview)
  const sessionsPanelProvider = createSessionsPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'boundary.sessionsPanel',
      sessionsPanelProvider
    )
  );

  // Register Tree Item Decoration Provider (shows connection status)
  const decorationProvider = getTargetDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider)
  );

  // Wire up connection manager (from container) to status bar
  const connectionManager = serviceContainer.connections;
  const statusBar = serviceContainer.statusBar;

  context.subscriptions.push(
    connectionManager.onSessionsChanged(sessions => {
      statusBar.updateSessionCount(sessions.length);
    })
  );

  // Register commands
  logger.debug('Registering commands...');
  registerCommands(context);
  logger.debug('Commands registered successfully');

  logger.info('Boundary extension activated');
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Login command - uses smart auto-discovery
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.login', async () => {
      logger.info('boundary.login command invoked');
      logger.show(); // Force show output channel
      void vscode.window.showInformationMessage('Starting Boundary login...');
      const result = await executeOidcAuth(authManager);

      // Refresh targets after successful login
      if (result.success) {
        targetProvider.refresh();
      }
    })
  );

  // Password login command (used when OIDC redirects to password)
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.loginPassword', async () => {
      logger.info('boundary.loginPassword command invoked');
      const result = await executePasswordAuth(authManager);

      // Refresh targets after successful login
      if (result?.success) {
        targetProvider.refresh();
      }
    })
  );

  // Legacy login with method picker (for users who want to choose)
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.loginWithPicker', async () => {
      logger.debug('boundary.loginWithPicker command invoked');
      const method = await showAuthMethodPicker();
      if (!method) {
        logger.debug('No auth method selected');
        return;
      }

      logger.debug('Auth method selected:', method);
      let result;
      if (method === 'oidc') {
        result = await executeOidcAuth(authManager);
      } else {
        result = await executePasswordAuth(authManager);
      }

      // Refresh targets after successful login
      if (result?.success) {
        targetProvider.refresh();
      }
    })
  );

  // Logout command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.logout', () => {
      authManager.logout();
      void vscode.window.showInformationMessage('Logged out of Boundary');
    })
  );

  // Refresh targets command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.refresh', () => {
      targetProvider.refresh();
    })
  );

  // Connect to target (QuickPick)
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.connect', async () => {
      // Check auth
      const authenticated = await authManager.isAuthenticated();
      if (!authenticated) {
        const action = await vscode.window.showWarningMessage(
          'Please login to Boundary first',
          'Login'
        );
        if (action === 'Login') {
          await vscode.commands.executeCommand('boundary.login');
        }
        return;
      }

      const target = await showTargetPicker();
      if (target) {
        await connectToTarget(target);
      }
    })
  );

  // Connect to specific target (from TreeView context menu)
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.connectTarget', async (item: unknown) => {
      if (!item) {
        return;
      }
      // Context menu passes TargetTreeItemData, extract the target
      const treeItemData = item as { target?: BoundaryTarget };
      const target = treeItemData.target;
      if (!target) {
        logger.warn('connectTarget called without valid target data');
        return;
      }
      await connectToTarget(target);
    })
  );

  // Disconnect command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.disconnect', async () => {
      await showSessionsList();
    })
  );

  // Disconnect all command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.disconnectAll', async () => {
      const connectionManager = serviceContainer.connections;
      const count = connectionManager.getSessionCount();

      if (count === 0) {
        void vscode.window.showInformationMessage('No active sessions');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Disconnect all ${count} session${count !== 1 ? 's' : ''}?`,
        'Disconnect All',
        'Cancel'
      );

      if (confirm === 'Disconnect All') {
        await connectionManager.disconnectAll();
        void vscode.window.showInformationMessage('All sessions disconnected');
      }
    })
  );

  // Show sessions command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.showSessions', async () => {
      await showSessionsList();
    })
  );
}

/**
 * Connect to a target
 */
async function connectToTarget(target: BoundaryTarget): Promise<void> {
  const statusBar = serviceContainer.statusBar;
  const connectionManager = serviceContainer.connections;

  statusBar.showConnecting(target.name);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${target.name}...`,
        cancellable: false,
      },
      async () => {
        const session = await connectionManager.connect(target);
        logger.info(`Connected to ${target.name} on port ${session.localPort}`);
      }
    );

    void vscode.window.showInformationMessage(`Connected to ${target.name}`);
  } catch (error) {
    logger.error('Connection failed:', error);

    let message = 'Connection failed';
    if (error instanceof BoundaryError) {
      message = error.getUserMessage();

      // Handle specific errors
      if (error.code === BoundaryErrorCode.TOKEN_EXPIRED) {
        const action = await vscode.window.showErrorMessage(message, 'Login');
        if (action === 'Login') {
          await vscode.commands.executeCommand('boundary.login');
        }
        return;
      }
    } else if (error instanceof Error) {
      message = error.message;
    }

    statusBar.showError('Connection failed');
    void vscode.window.showErrorMessage(message);
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  logger.info('Deactivating Boundary extension');

  // Clean up any remaining SSH config entries (fire and forget)
  void cleanupBoundarySSHConfigEntries();

  // Dispose service container (handles all DI-managed services)
  if (serviceContainer) {
    disposeServiceContainer(serviceContainer);
  }

  // Dispose remaining singletons not managed by container
  disposeSessionsPanelProvider();
  disposeTargetDecorationProvider();

  // Dispose legacy singletons (for backward compatibility during migration)
  disposeConnectionManager();
  disposeStatusBarManager();
  disposeTargetService();
  disposeBoundaryCLI();
  disposeAuthStateManager();
  disposeConfigurationService();

  Logger.getInstance().dispose();
}
