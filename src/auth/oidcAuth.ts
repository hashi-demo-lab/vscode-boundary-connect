/**
 * OIDC authentication flow
 */

import * as vscode from 'vscode';
import { AuthResult, OidcCredentials } from '../types';
import { AuthManager } from './authManager';
import { logger } from '../utils/logger';

export interface OidcAuthOptions {
  authMethodId?: string;
}

/**
 * Execute OIDC authentication flow
 */
export async function executeOidcAuth(
  authManager: AuthManager,
  options: OidcAuthOptions = {}
): Promise<AuthResult> {
  logger.info('Starting OIDC authentication flow');

  // Prompt for auth method ID if not provided
  let authMethodId = options.authMethodId;
  if (!authMethodId) {
    authMethodId = await vscode.window.showInputBox({
      prompt: 'Enter OIDC Auth Method ID',
      placeHolder: 'amoidc_xxxxxxxxxx',
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
  }

  const credentials: OidcCredentials = {
    authMethodId,
  };

  // Show progress while OIDC auth is in progress
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Authenticating with OIDC...',
      cancellable: false,
    },
    async () => {
      return authManager.login('oidc', credentials);
    }
  );

  if (result.success) {
    void vscode.window.showInformationMessage('Successfully logged in to Boundary via OIDC');
  } else {
    void vscode.window.showErrorMessage(`OIDC login failed: ${result.error}`);
  }

  return result;
}
