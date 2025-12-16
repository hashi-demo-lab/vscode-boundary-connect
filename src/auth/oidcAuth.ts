/**
 * OIDC authentication flow - Beautiful, user-friendly login experience
 */

import * as vscode from 'vscode';
import { AuthResult, BoundaryAuthMethod, IAuthManager, OidcCredentials } from '../types';
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

  // Brief delay to ensure VS Code has persisted the configuration
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify the config was saved correctly
  const verifyAddr = config.get('addr');
  logger.info(`Verified saved address: ${verifyAddr}`);
  if (!verifyAddr) {
    logger.error('Config was not saved correctly - addr is still empty');
  }

  // Update welcome view context so UI reflects the change
  await vscode.commands.executeCommand('setContext', 'boundary.addrConfigured', true);

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
  authManager: IAuthManager,
  options: OidcAuthOptions = {}
): Promise<AuthResult> {
  // Show output channel so user can see progress/errors
  logger.show();
  logger.info('=== Starting authentication flow ===');

  const cli = getBoundaryCLI();

  // Check CLI availability first
  logger.info('Step 1: Checking CLI installation...');
  let installed: boolean;
  try {
    installed = await cli.checkInstalled();
  } catch (err) {
    logger.error('Step 1 ERROR: CLI check threw:', err);
    void vscode.window.showErrorMessage(`CLI check failed: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, error: String(err) };
  }

  if (!installed) {
    logger.error('Step 1 FAILED: CLI not installed');
    void vscode.window.showErrorMessage('Boundary CLI not found. Please install it.');
    return {
      success: false,
      error: 'Boundary CLI not found. Please install it from https://developer.hashicorp.com/boundary/downloads',
    };
  }
  logger.info('Step 1: CLI is installed ✓');

  // Ensure Boundary address is configured
  logger.info('Step 2: Checking Boundary address...');
  let hasAddress: boolean;
  try {
    hasAddress = await ensureBoundaryAddress();
  } catch (err) {
    logger.error('Step 2 ERROR: Address check threw:', err);
    void vscode.window.showErrorMessage(`Address check failed: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, error: String(err) };
  }

  if (!hasAddress) {
    logger.error('Step 2 FAILED: No Boundary address configured');
    return { success: false, error: 'Boundary server address is required' };
  }
  logger.info('Step 2: Boundary address configured ✓');

  const config = getConfigurationService();
  logger.info(`Using Boundary address: ${config.get('addr')}, TLS insecure: ${config.get('tlsInsecure')}`);

  let authMethodId = options.authMethodId;

  // If no auth method specified, discover available methods
  if (!authMethodId) {
    logger.info('Step 3: Discovering auth methods from Boundary server...');

    // Show progress while discovering auth methods
    let authMethods: BoundaryAuthMethod[] = [];
    let discoveryError: Error | undefined;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering sign-in options...',
          cancellable: false,
        },
        async () => {
          try {
            logger.info('Step 3: Calling cli.listAuthMethods()...');
            authMethods = await cli.listAuthMethods();
            logger.info(`Step 3: Discovered ${authMethods.length} auth methods: ${authMethods.map(m => m.name).join(', ')}`);
          } catch (err) {
            logger.error('Step 3 ERROR: Auth method discovery failed:', err);
            discoveryError = err instanceof Error ? err : new Error(String(err));
          }
        }
      );
    } catch (progressErr) {
      logger.error('Step 3 ERROR: withProgress threw:', progressErr);
      void vscode.window.showErrorMessage(`Discovery error: ${progressErr instanceof Error ? progressErr.message : String(progressErr)}`);
      return { success: false, error: String(progressErr) };
    }

    logger.info(`Step 3 complete: ${authMethods.length} methods found, error: ${discoveryError?.message || 'none'}`);

    // If discovery failed and TLS is not disabled, offer to disable it
    if (authMethods.length === 0 && discoveryError) {
      const config = getConfigurationService();
      const addr = config.get('addr');
      const tlsInsecure = config.get('tlsInsecure');

      if (addr?.startsWith('https://') && !tlsInsecure) {
        const retry = await vscode.window.showWarningMessage(
          `Could not connect to Boundary server: ${discoveryError.message}. This may be due to a self-signed certificate.`,
          'Skip TLS Verification',
          'Cancel'
        );

        if (retry === 'Skip TLS Verification') {
          await config.update('tlsInsecure', true, vscode.ConfigurationTarget.Global);
          logger.info('TLS verification disabled, retrying...');

          // Retry discovery
          try {
            authMethods = await cli.listAuthMethods();
            discoveryError = undefined;
          } catch (err) {
            logger.error('Auth method discovery retry failed:', err);
            discoveryError = err instanceof Error ? err : new Error(String(err));
          }
        }
      } else if (!addr) {
        // No address configured - this is a different error
        logger.warn('No Boundary address configured');
      } else {
        // TLS already disabled or not HTTPS - show the actual error
        void vscode.window.showErrorMessage(
          `Failed to discover auth methods: ${discoveryError.message}`
        );
      }
    }

    if (authMethods.length === 0) {
      // Discovery failed - try direct OIDC auth (CLI may auto-select primary method)
      logger.warn('No auth methods discovered, trying direct OIDC auth');
      return executeDirectOidcAuth(authManager);
    }

    // Filter to only OIDC methods for this flow
    const oidcMethods = authMethods.filter(m => m.type === 'oidc');
    logger.info(`Found ${oidcMethods.length} OIDC methods out of ${authMethods.length} total`);

    if (oidcMethods.length === 0) {
      // No OIDC methods - check if password auth is available
      const passwordMethods = authMethods.filter(m => m.type === 'password');
      logger.info(`No OIDC methods. Found ${passwordMethods.length} password methods.`);

      // Inform user that OIDC is not configured
      void vscode.window.showInformationMessage(
        'OIDC authentication is not configured on this Boundary server. Using password authentication instead.',
        'OK'
      );

      if (passwordMethods.length === 1) {
        // Single password method - go directly to password login
        logger.info('Single password method available, redirecting to password login...');
        await vscode.commands.executeCommand('boundary.loginPassword');
        return { success: true };
      }

      // Multiple methods or mixed - show picker
      logger.info('Showing auth method picker...');
      const selected = await showAuthMethodPicker(authMethods);
      if (!selected) {
        return { success: false, error: 'Authentication cancelled' };
      }

      if (selected.type === 'password') {
        // User selected password auth - invoke password login command
        logger.info('User selected password auth method, redirecting...');
        await vscode.commands.executeCommand('boundary.loginPassword');
        // Return success since the password command will handle the actual auth
        return { success: true };
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
  logger.info(`Step 4: Prepared OIDC credentials with authMethodId: ${authMethodId}`);

  // Show prominent message about checking browser
  void vscode.window.showWarningMessage(
    '🌐 CHECK YOUR BROWSER - A sign-in page should open. Look for a new browser window or tab, it may be behind other windows.',
    'OK'
  );

  logger.info('Step 5: Calling authManager.login...');

  // Show progress while OIDC auth is in progress
  let result: AuthResult;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Waiting for browser authentication...',
        cancellable: false,
      },
      async () => {
        logger.info('Step 5: Inside withProgress, calling authManager.login()...');
        const loginResult = await authManager.login('oidc', credentials);
        logger.info(`Step 5: authManager.login returned: success=${loginResult.success}, error=${loginResult.error || 'none'}`);
        return loginResult;
      }
    );
  } catch (err) {
    logger.error('Step 5 ERROR: authManager.login threw:', err);
    void vscode.window.showErrorMessage(`Login error: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, error: String(err) };
  }

  logger.info(`Step 6: Login complete - success=${result.success}`);

  if (result.success) {
    void vscode.window.showInformationMessage('Successfully signed in to Boundary');
  } else {
    void vscode.window.showErrorMessage(`Sign-in failed: ${result.error}`);
  }

  return result;
}

/**
 * Direct OIDC auth - just run the CLI and let it handle browser redirect
 */
async function executeDirectOidcAuth(authManager: IAuthManager, authMethodId?: string): Promise<AuthResult> {
  logger.info('Attempting direct OIDC authentication...');

  // Show prominent message about checking browser
  void vscode.window.showWarningMessage(
    '🌐 CHECK YOUR BROWSER - A sign-in page should open. Look for a new browser window or tab, it may be behind other windows.',
    'OK'
  );

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Waiting for browser sign-in...',
      cancellable: false,
    },
    async () => {
      return authManager.login('oidc', authMethodId ? { authMethodId } : undefined);
    }
  );

  if (result.success) {
    void vscode.window.showInformationMessage('Successfully signed in to Boundary');
  } else {
    void vscode.window.showErrorMessage(`Sign-in failed: ${result.error}`);
  }

  return result;
}
