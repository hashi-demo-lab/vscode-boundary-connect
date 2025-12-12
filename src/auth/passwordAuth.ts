/**
 * Password authentication flow
 */

import * as vscode from 'vscode';
import { AuthResult, PasswordCredentials } from '../types';
import { AuthManager } from './authManager';
import { logger } from '../utils/logger';

export interface PasswordAuthOptions {
  authMethodId?: string;
}

/**
 * Execute password authentication flow with user input
 */
export async function executePasswordAuth(
  authManager: AuthManager,
  options: PasswordAuthOptions = {}
): Promise<AuthResult> {
  logger.info('Starting password authentication flow');

  // Prompt for auth method ID if not provided
  let authMethodId = options.authMethodId;
  if (!authMethodId) {
    authMethodId = await vscode.window.showInputBox({
      prompt: 'Enter Auth Method ID',
      placeHolder: 'ampw_xxxxxxxxxx',
      validateInput: (value) => {
        if (!value) {
          return 'Auth Method ID is required';
        }
        if (!value.startsWith('ampw_')) {
          return 'Password auth method ID should start with "ampw_"';
        }
        return undefined;
      },
    });

    if (!authMethodId) {
      return { success: false, error: 'Authentication cancelled' };
    }
  }

  // Prompt for login name
  const loginName = await vscode.window.showInputBox({
    prompt: 'Enter Login Name',
    placeHolder: 'username',
    validateInput: (value) => {
      if (!value) {
        return 'Login name is required';
      }
      return undefined;
    },
  });

  if (!loginName) {
    return { success: false, error: 'Authentication cancelled' };
  }

  // Prompt for password
  const password = await vscode.window.showInputBox({
    prompt: 'Enter Password',
    password: true,
    validateInput: (value) => {
      if (!value) {
        return 'Password is required';
      }
      return undefined;
    },
  });

  if (!password) {
    return { success: false, error: 'Authentication cancelled' };
  }

  const credentials: PasswordCredentials = {
    authMethodId,
    loginName,
    password,
  };

  // Perform authentication
  const result = await authManager.login('password', credentials);

  if (result.success) {
    void vscode.window.showInformationMessage('Successfully logged in to Boundary');
  } else {
    void vscode.window.showErrorMessage(`Login failed: ${result.error}`);
  }

  return result;
}
