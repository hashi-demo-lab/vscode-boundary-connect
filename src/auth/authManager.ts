/**
 * Authentication Manager for Boundary
 */

import * as vscode from 'vscode';
import { AuthMethod, AuthResult, Credentials, IAuthManager } from '../types';
import { getBoundaryCLI } from '../boundary/cli';
import { logger } from '../utils/logger';

const TOKEN_KEY = 'boundary.authToken';
const USER_ID_KEY = 'boundary.userId';
const EXPIRATION_KEY = 'boundary.tokenExpiration';

export class AuthManager implements IAuthManager {
  private readonly _onAuthStateChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthStateChanged = this._onAuthStateChanged.event;

  private authenticated = false;
  private secretStorage: vscode.SecretStorage;

  constructor(private context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;

    // Check initial auth state
    void this.checkAuthState();

    // Listen for secret changes
    context.subscriptions.push(
      this.secretStorage.onDidChange(e => {
        if (e.key === TOKEN_KEY) {
          void this.checkAuthState();
        }
      })
    );
  }

  private async checkAuthState(): Promise<void> {
    const token = await this.getToken();
    const wasAuthenticated = this.authenticated;
    this.authenticated = !!token;

    // Check expiration
    if (token) {
      const expirationStr = await this.secretStorage.get(EXPIRATION_KEY);
      if (expirationStr) {
        const expiration = new Date(expirationStr);
        if (expiration < new Date()) {
          logger.info('Token expired, clearing auth state');
          await this.logout();
          return;
        }
      }
    }

    if (wasAuthenticated !== this.authenticated) {
      logger.info(`Auth state changed: ${this.authenticated ? 'authenticated' : 'unauthenticated'}`);
      this._onAuthStateChanged.fire(this.authenticated);
      void vscode.commands.executeCommand('setContext', 'boundary.authenticated', this.authenticated);
    }
  }

  async login(method: AuthMethod, credentials?: Credentials): Promise<AuthResult> {
    logger.info(`Attempting login with method: ${method}`);

    const cli = getBoundaryCLI();

    // Check if CLI is available
    const installed = await cli.checkInstalled();
    if (!installed) {
      return {
        success: false,
        error: 'Boundary CLI not found. Please install it from https://developer.hashicorp.com/boundary/downloads',
      };
    }

    try {
      const result = await cli.authenticate(method, credentials);

      if (result.success && result.token) {
        // Store token securely
        await this.secretStorage.store(TOKEN_KEY, result.token);

        if (result.userId) {
          await this.secretStorage.store(USER_ID_KEY, result.userId);
        }

        if (result.expirationTime) {
          await this.secretStorage.store(EXPIRATION_KEY, result.expirationTime.toISOString());
        }

        this.authenticated = true;
        this._onAuthStateChanged.fire(true);
        await vscode.commands.executeCommand('setContext', 'boundary.authenticated', true);

        logger.info('Login successful');
      } else {
        logger.warn('Login failed:', result.error);
      }

      return result;
    } catch (error) {
      logger.error('Login error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async logout(): Promise<void> {
    logger.info('Logging out');

    await this.secretStorage.delete(TOKEN_KEY);
    await this.secretStorage.delete(USER_ID_KEY);
    await this.secretStorage.delete(EXPIRATION_KEY);

    this.authenticated = false;
    this._onAuthStateChanged.fire(false);
    await vscode.commands.executeCommand('setContext', 'boundary.authenticated', false);
  }

  async getToken(): Promise<string | undefined> {
    // First try our stored token
    let token = await this.secretStorage.get(TOKEN_KEY);

    // If no stored token, try to get from CLI keyring
    if (!token) {
      const cli = getBoundaryCLI();
      token = await cli.getToken();

      // If we got a token from CLI, store it
      if (token) {
        await this.secretStorage.store(TOKEN_KEY, token);
        this.authenticated = true;
        this._onAuthStateChanged.fire(true);
        await vscode.commands.executeCommand('setContext', 'boundary.authenticated', true);
      }
    }

    return token;
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.authenticated) {
      const token = await this.getToken();
      this.authenticated = !!token;
    }
    return this.authenticated;
  }

  dispose(): void {
    this._onAuthStateChanged.dispose();
  }
}

// Factory function for creating AuthManager
export function createAuthManager(context: vscode.ExtensionContext): AuthManager {
  return new AuthManager(context);
}
