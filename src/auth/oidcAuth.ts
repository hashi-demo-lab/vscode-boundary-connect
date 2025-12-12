/**
 * OIDC authentication flow - Beautiful, user-friendly login experience
 */

import * as vscode from 'vscode';
import { AuthResult, BoundaryAuthMethod, OidcCredentials } from '../types';
import { AuthManager } from './authManager';
import { getBoundaryCLI } from '../boundary/cli';
import { getConfigurationService } from '../utils/config';
import { logger } from '../utils/logger';

export interface OidcAuthOptions {
  authMethodId?: string;
}

/**
 * Get icon for auth method type
 */
function getAuthMethodIcon(type: string): string {
  switch (type) {
    case 'oidc':
      return '$(globe)';
    case 'password':
      return '$(lock)';
    case 'ldap':
      return '$(organization)';
    default:
      return '$(key)';
  }
}

/**
 * Get friendly description for auth method
 */
function getAuthMethodDescription(method: BoundaryAuthMethod): string {
  if (method.description) {
    return method.description;
  }
  switch (method.type) {
    case 'oidc':
      return 'Sign in with your identity provider';
    case 'password':
      return 'Sign in with username and password';
    case 'ldap':
      return 'Sign in with your directory credentials';
    default:
      return 'Authenticate to Boundary';
  }
}

/**
 * Show a beautiful auth method picker
 */
async function showAuthMethodPicker(authMethods: BoundaryAuthMethod[]): Promise<BoundaryAuthMethod | undefined> {
  // Sort: primary first, then OIDC, then others
  const sorted = [...authMethods].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) {
      return -1;
    }
    if (!a.isPrimary && b.isPrimary) {
      return 1;
    }
    if (a.type === 'oidc' && b.type !== 'oidc') {
      return -1;
    }
    if (a.type !== 'oidc' && b.type === 'oidc') {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });

  const items: (vscode.QuickPickItem & { authMethod: BoundaryAuthMethod })[] = sorted.map((method, index) => ({
    label: `${getAuthMethodIcon(method.type)} ${method.name}`,
    description: method.isPrimary ? '(Primary)' : undefined,
    detail: getAuthMethodDescription(method),
    picked: index === 0, // Pre-select first (primary or OIDC)
    authMethod: method,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Choose how to sign in',
    title: 'Boundary: Sign In',
    ignoreFocusOut: true,
  });

  return selected?.authMethod;
}

/**
 * Ensure Boundary server address is configured
 */
async function ensureBoundaryAddress(): Promise<boolean> {
  const config = getConfigurationService();
  const addr = config.get('addr') || process.env.BOUNDARY_ADDR;

  if (addr) {
    return true;
  }

  // Prompt user for the Boundary server address
  const inputAddr = await vscode.window.showInputBox({
    prompt: 'Enter your Boundary server address',
    placeHolder: 'https://boundary.example.com',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value) {
        return 'Server address is required';
      }
      try {
        new URL(value);
        return undefined;
      } catch {
        return 'Please enter a valid URL (e.g., https://boundary.example.com)';
      }
    },
  });

  if (!inputAddr) {
    return false;
  }

  // Save to settings
  await config.update('addr', inputAddr, vscode.ConfigurationTarget.Global);
  logger.info(`Boundary address configured: ${inputAddr}`);

  // For HTTPS addresses, ask about TLS verification (many dev/internal deployments use self-signed certs)
  if (inputAddr.startsWith('https://') && !inputAddr.includes('boundaryproject.io')) {
    const tlsChoice = await vscode.window.showQuickPick(
      [
        {
          label: '$(shield) Verify TLS Certificate',
          description: 'Recommended for production',
          detail: 'Requires a valid, trusted certificate',
          value: false,
        },
        {
          label: '$(unlock) Skip TLS Verification',
          description: 'For development/self-signed certs',
          detail: 'Use this if your server uses a self-signed certificate',
          value: true,
        },
      ],
      {
        placeHolder: 'Does your Boundary server use a self-signed certificate?',
        title: 'TLS Certificate Verification',
        ignoreFocusOut: true,
      }
    );

    if (tlsChoice?.value) {
      await config.update('tlsInsecure', true, vscode.ConfigurationTarget.Global);
      logger.info('TLS verification disabled for self-signed certificate');
    }
  }

  return true;
}

/**
 * Execute OIDC authentication flow with auto-discovery
 */
export async function executeOidcAuth(
  authManager: AuthManager,
  options: OidcAuthOptions = {}
): Promise<AuthResult> {
  logger.info('Starting authentication flow');

  const cli = getBoundaryCLI();

  // Check CLI availability first
  logger.info('Checking CLI installation...');
  const installed = await cli.checkInstalled();
  if (!installed) {
    logger.error('CLI not installed');
    void vscode.window.showErrorMessage('Boundary CLI not found. Please install it.');
    return {
      success: false,
      error: 'Boundary CLI not found. Please install it from https://developer.hashicorp.com/boundary/downloads',
    };
  }
  logger.info('CLI is installed');

  // Ensure Boundary address is configured
  const hasAddress = await ensureBoundaryAddress();
  if (!hasAddress) {
    return { success: false, error: 'Boundary server address is required' };
  }

  const config = getConfigurationService();
  logger.info(`Using Boundary address: ${config.get('addr')}, TLS insecure: ${config.get('tlsInsecure')}`);

  let authMethodId = options.authMethodId;

  // If no auth method specified, discover available methods
  if (!authMethodId) {
    logger.info('Discovering auth methods...');

    // Show progress while discovering auth methods
    let authMethods = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Discovering sign-in options...',
        cancellable: false,
      },
      async () => {
        try {
          const methods = await cli.listAuthMethods();
          logger.info(`Discovered ${methods.length} auth methods`);
          return methods;
        } catch (err) {
          logger.error('Auth method discovery failed:', err);
          return [];
        }
      }
    );

    // If discovery failed and TLS is not disabled, offer to disable it
    if (authMethods.length === 0) {
      const config = getConfigurationService();
      const addr = config.get('addr');
      const tlsInsecure = config.get('tlsInsecure');

      if (addr?.startsWith('https://') && !tlsInsecure) {
        const retry = await vscode.window.showWarningMessage(
          'Could not connect to Boundary server. This may be due to a self-signed certificate.',
          'Skip TLS Verification',
          'Cancel'
        );

        if (retry === 'Skip TLS Verification') {
          await config.update('tlsInsecure', true, vscode.ConfigurationTarget.Global);
          logger.info('TLS verification disabled, retrying...');

          // Retry discovery
          authMethods = await cli.listAuthMethods();
        }
      }
    }

    if (authMethods.length === 0) {
      // Fall back to manual entry if discovery still fails
      logger.warn('No auth methods discovered, falling back to manual entry');
      return executeManualOidcAuth(authManager);
    }

    // Filter to only OIDC methods for this flow
    const oidcMethods = authMethods.filter(m => m.type === 'oidc');

    if (oidcMethods.length === 0) {
      // No OIDC methods, show all available methods
      const selected = await showAuthMethodPicker(authMethods);
      if (!selected) {
        return { success: false, error: 'Authentication cancelled' };
      }

      if (selected.type === 'password') {
        // Redirect to password auth
        void vscode.commands.executeCommand('boundary.loginPassword');
        return { success: false, error: 'Redirecting to password authentication' };
      }

      authMethodId = selected.id;
    } else if (oidcMethods.length === 1) {
      // Single OIDC method - use it directly (best UX)
      authMethodId = oidcMethods[0].id;
      logger.info(`Auto-selected OIDC method: ${oidcMethods[0].name}`);
    } else {
      // Multiple OIDC methods - let user choose
      const selected = await showAuthMethodPicker(oidcMethods);
      if (!selected) {
        return { success: false, error: 'Authentication cancelled' };
      }
      authMethodId = selected.id;
    }
  }

  const credentials: OidcCredentials = { authMethodId };

  // Show a prominent message that browser is opening
  void vscode.window.showInformationMessage(
    'A browser window should open for sign-in. If you don\'t see it, check your taskbar.',
    'OK'
  );

  // Show progress while OIDC auth is in progress
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Waiting for browser authentication...',
      cancellable: false,
    },
    async () => {
      return authManager.login('oidc', credentials);
    }
  );

  if (result.success) {
    void vscode.window.showInformationMessage('Successfully signed in to Boundary');
  } else {
    void vscode.window.showErrorMessage(`Sign-in failed: ${result.error}`);
  }

  return result;
}

/**
 * Fallback: Manual OIDC auth method entry
 * Only used when auth method discovery fails
 */
async function executeManualOidcAuth(authManager: AuthManager): Promise<AuthResult> {
  const authMethodId = await vscode.window.showInputBox({
    prompt: 'Enter OIDC Auth Method ID (contact your administrator)',
    placeHolder: 'amoidc_...',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value) {
        return 'Auth Method ID is required';
      }
      if (!value.startsWith('amoidc_')) {
        return 'OIDC auth method ID should start with "amoidc_"';
      }
      return undefined;
    },
  });

  if (!authMethodId) {
    return { success: false, error: 'Authentication cancelled' };
  }

  const credentials: OidcCredentials = { authMethodId };

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Opening browser for sign-in...',
      cancellable: false,
    },
    async () => {
      return authManager.login('oidc', credentials);
    }
  );

  if (result.success) {
    void vscode.window.showInformationMessage('Successfully signed in to Boundary');
  } else {
    void vscode.window.showErrorMessage(`Sign-in failed: ${result.error}`);
  }

  return result;
}
