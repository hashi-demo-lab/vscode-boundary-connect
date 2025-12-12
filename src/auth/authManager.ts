/**
 * Authentication Manager for Boundary
 *
 * Design principles:
 * 1. CLI keyring is the single source of truth for tokens
 * 2. AuthStateManager handles all state transitions
 * 3. This class orchestrates auth operations, not state
 * 4. No duplicate token storage - CLI manages tokens
 */

import * as vscode from 'vscode';
import { AuthMethod, AuthResult, Credentials, IAuthManager } from '../types';
import { getBoundaryCLI } from '../boundary/cli';
import { logger } from '../utils/logger';
import { AuthStateManager, getAuthStateManager } from './authState';

export class AuthManager implements IAuthManager {
  private readonly stateManager: AuthStateManager;
  private initPromise: Promise<void> | undefined;

  // Expose state manager's event for backward compatibility
  get onAuthStateChanged(): vscode.Event<boolean> {
    // Map AuthState to boolean for backward compatibility
    return (listener: (authenticated: boolean) => void) => {
      return this.stateManager.onStateChanged(state => {
        listener(state === 'authenticated');
      });
    };
  }

  constructor(private context: vscode.ExtensionContext) {
    this.stateManager = getAuthStateManager();
  }

  /**
   * Initialize auth state by checking CLI keyring
   * Call this once during extension activation
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    logger.info('Initializing auth state...');

    try {
      const cli = getBoundaryCLI();
      const token = await cli.getToken();
      const hasToken = !!token;

      logger.info(`Initial auth check: ${hasToken ? 'token found' : 'no token'}`);
      this.stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken });
    } catch (error) {
      logger.error('Auth initialization failed:', error);
      this.stateManager.dispatch({
        type: 'AUTH_ERROR',
        error: error instanceof Error ? error.message : String(error),
      });

      // Notify user of initialization failure
      void vscode.window.showWarningMessage(
        'Boundary extension initialization failed. Some features may not work.',
        'View Logs'
      ).then(action => {
        if (action === 'View Logs') {
          logger.show();
        }
      });
    }
  }

  /**
   * Login with specified method and credentials
   */
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

    // Transition to authenticating state
    this.stateManager.dispatch({ type: 'LOGIN_START' });

    try {
      const result = await cli.authenticate(method, credentials);

      if (result.success) {
        // CLI stores token in its keyring automatically
        // We just update our state
        this.stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
        logger.info('Login successful');
      } else {
        this.stateManager.dispatch({
          type: 'LOGIN_FAILURE',
          error: result.error || 'Unknown error',
        });
        logger.warn('Login failed:', result.error);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.stateManager.dispatch({ type: 'LOGIN_FAILURE', error: errorMessage });
      logger.error('Login error:', error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Logout - clear CLI keyring token
   */
  logout(): void {
    logger.info('Logging out');

    // Note: Boundary CLI doesn't have a logout command that clears keyring
    // The token will naturally expire. We just update our state.
    this.stateManager.dispatch({ type: 'LOGOUT' });
  }

  /**
   * Handle token expiration (called when API returns 401/403)
   */
  handleTokenExpired(): void {
    logger.info('Token expired, updating state');
    this.stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
  }

  /**
   * Get current auth state (read-only, no side effects)
   */
  get state() {
    return this.stateManager.state;
  }

  /**
   * Check if currently authenticated (read-only, no side effects)
   */
  async isAuthenticated(): Promise<boolean> {
    // Ensure initialization is complete
    await this.initialize();
    return this.stateManager.isAuthenticated;
  }

  /**
   * Get token from CLI keyring (read-only, no side effects)
   * Returns undefined if not authenticated
   */
  async getToken(): Promise<string | undefined> {
    if (!this.stateManager.isAuthenticated) {
      return undefined;
    }

    try {
      const cli = getBoundaryCLI();
      return await cli.getToken();
    } catch (error) {
      logger.error('Failed to get token:', error);
      return undefined;
    }
  }

  /**
   * Verify token is still valid by checking with CLI
   * Updates state if token is invalid
   */
  async verifyToken(): Promise<boolean> {
    try {
      const cli = getBoundaryCLI();
      const token = await cli.getToken();

      if (!token) {
        if (this.stateManager.isAuthenticated) {
          this.stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
        }
        return false;
      }

      // Token exists - if we weren't authenticated, update state
      if (!this.stateManager.isAuthenticated) {
        this.stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      }

      return true;
    } catch (error) {
      logger.error('Token verification failed:', error);
      return false;
    }
  }

  dispose(): void {
    // State manager is a singleton, disposed separately
  }
}

// Factory function for creating AuthManager
export function createAuthManager(context: vscode.ExtensionContext): AuthManager {
  return new AuthManager(context);
}
