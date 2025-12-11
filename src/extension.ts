/**
 * Boundary VS Code Extension
 *
 * Integrates HashiCorp Boundary with VS Code Remote SSH for seamless
 * secure access to infrastructure.
 */

import * as vscode from 'vscode';
import { BoundaryTarget } from './types';
import { AuthManager, createAuthManager } from './auth/authManager';
import { executePasswordAuth } from './auth/passwordAuth';
import { executeOidcAuth } from './auth/oidcAuth';
import { getBoundaryCLI, disposeBoundaryCLI } from './boundary/cli';
import { createTargetProvider, TargetProvider } from './targets/targetProvider';
import { disposeTargetService } from './targets/targetService';
import { getConnectionManager, disposeConnectionManager } from './connection/connectionManager';
import { getStatusBarManager, disposeStatusBarManager } from './ui/statusBar';
import { showAuthMethodPicker, showTargetPicker, showSessionsList } from './ui/quickPick';
import { getConfigurationService, disposeConfigurationService } from './utils/config';
import { Logger, logger } from './utils/logger';
import { BoundaryError, BoundaryErrorCode } from './utils/errors';

let authManager: AuthManager;
let targetProvider: TargetProvider;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info('Activating Boundary extension');

  // Initialize configuration
  const config = getConfigurationService();
  logger.setLogLevel(config.get('logLevel'));

  // Listen for config changes
  context.subscriptions.push(
    config.onConfigurationChanged(cfg => {
      logger.setLogLevel(cfg.logLevel);
    })
  );

  // Check if Boundary CLI is available
  const cli = getBoundaryCLI();
  const cliInstalled = await cli.checkInstalled();

  if (!cliInstalled) {
    const action = await vscode.window.showWarningMessage(
      'Boundary CLI not found. Some features may not work.',
      'Install',
      'Configure Path'
    );

    if (action === 'Install') {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://developer.hashicorp.com/boundary/downloads')
      );
    } else if (action === 'Configure Path') {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'boundary.cliPath'
      );
    }
  }

  // Initialize auth manager
  authManager = createAuthManager(context);
  context.subscriptions.push(authManager);

  // Initialize target provider
  targetProvider = createTargetProvider();
  context.subscriptions.push(targetProvider);

  // Register TreeView
  const treeView = vscode.window.createTreeView('boundary.targets', {
    treeDataProvider: targetProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Wire up auth state changes to target provider
  context.subscriptions.push(
    authManager.onAuthStateChanged(authenticated => {
      targetProvider.setAuthenticated(authenticated);
    })
  );

  // Wire up connection manager to status bar
  const connectionManager = getConnectionManager();
  const statusBar = getStatusBarManager();

  context.subscriptions.push(
    connectionManager.onSessionsChanged(sessions => {
      statusBar.updateSessionCount(sessions.length);
    })
  );

  // Register commands
  registerCommands(context);

  // Check initial auth state
  const isAuthenticated = await authManager.isAuthenticated();
  targetProvider.setAuthenticated(isAuthenticated);

  logger.info('Boundary extension activated');
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Login command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.login', async () => {
      const method = await showAuthMethodPicker();
      if (!method) {
        return;
      }

      if (method === 'oidc') {
        await executeOidcAuth(authManager);
      } else {
        await executePasswordAuth(authManager);
      }
    })
  );

  // Logout command
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.logout', async () => {
      await authManager.logout();
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

  // Connect to specific target (from TreeView)
  context.subscriptions.push(
    vscode.commands.registerCommand('boundary.connectTarget', async (target: BoundaryTarget) => {
      if (!target) {
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
      const connectionManager = getConnectionManager();
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
  const statusBar = getStatusBarManager();
  const connectionManager = getConnectionManager();

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

  // Dispose all singletons
  disposeConnectionManager();
  disposeStatusBarManager();
  disposeTargetService();
  disposeBoundaryCLI();
  disposeConfigurationService();

  Logger.getInstance().dispose();
}
