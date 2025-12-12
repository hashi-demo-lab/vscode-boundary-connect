/**
 * Authentication State Machine - Single source of truth for auth state
 *
 * Design principles:
 * 1. CLI keyring is the source of truth for tokens (Boundary manages it)
 * 2. Extension only caches state, never stores tokens separately
 * 3. All state transitions go through this module
 * 4. Query methods have no side effects
 */

import * as vscode from 'vscode';
import { AuthState, AuthEvent, IAuthStateManager } from '../types';
import { logger } from '../utils/logger';

// Re-export types for backward compatibility
export type { AuthState, AuthEvent } from '../types';

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<AuthState, AuthState[]> = {
  'initializing': ['authenticated', 'unauthenticated', 'error'],
  'unauthenticated': ['authenticating', 'authenticated'], // authenticated for CLI keyring pickup
  'authenticating': ['authenticated', 'unauthenticated', 'error'],
  'authenticated': ['expired', 'unauthenticated', 'authenticating'],
  'expired': ['authenticating', 'unauthenticated'],
  'error': ['unauthenticated', 'authenticating'],
};

/**
 * Authentication State Manager
 * Manages auth state transitions and notifies listeners
 */
export class AuthStateManager implements IAuthStateManager {
  private _state: AuthState = 'initializing';
  private _lastError: string | undefined;

  private readonly _onStateChanged = new vscode.EventEmitter<AuthState>();
  readonly onStateChanged = this._onStateChanged.event;

  /**
   * Get current auth state (read-only, no side effects)
   */
  get state(): AuthState {
    return this._state;
  }

  /**
   * Check if currently authenticated (read-only, no side effects)
   */
  get isAuthenticated(): boolean {
    return this._state === 'authenticated';
  }

  /**
   * Get last error if any
   */
  get lastError(): string | undefined {
    return this._lastError;
  }

  /**
   * Dispatch an event to transition state
   */
  dispatch(event: AuthEvent): void {
    const previousState = this._state;
    const nextState = this.getNextState(event);

    if (!this.isValidTransition(previousState, nextState)) {
      logger.warn(`Invalid auth state transition: ${previousState} -> ${nextState} (event: ${event.type})`);
      return;
    }

    this._state = nextState;

    // Track errors
    if ('error' in event) {
      this._lastError = event.error;
    } else if (nextState === 'authenticated') {
      this._lastError = undefined;
    }

    logger.info(`Auth state: ${previousState} -> ${nextState} (event: ${event.type})`);

    // Update VS Code context
    void vscode.commands.executeCommand('setContext', 'boundary.authenticated', this.isAuthenticated);
    void vscode.commands.executeCommand('setContext', 'boundary.authState', nextState);

    // Notify listeners
    this._onStateChanged.fire(nextState);
  }

  /**
   * Determine next state based on event
   */
  private getNextState(event: AuthEvent): AuthState {
    switch (event.type) {
      case 'INIT_COMPLETE':
        return event.hasToken ? 'authenticated' : 'unauthenticated';
      case 'LOGIN_START':
        return 'authenticating';
      case 'LOGIN_SUCCESS':
        return 'authenticated';
      case 'LOGIN_FAILURE':
        return 'unauthenticated';
      case 'TOKEN_EXPIRED':
        return 'expired';
      case 'LOGOUT':
        return 'unauthenticated';
      case 'AUTH_ERROR':
        return 'error';
      default:
        return this._state;
    }
  }

  /**
   * Check if state transition is valid
   */
  private isValidTransition(from: AuthState, to: AuthState): boolean {
    if (from === to) {
      return true; // No-op is always valid
    }
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Reset to initial state (for testing or recovery)
   */
  reset(): void {
    this._state = 'initializing';
    this._lastError = undefined;
  }

  dispose(): void {
    this._onStateChanged.dispose();
  }
}

// Singleton instance
let stateManagerInstance: AuthStateManager | undefined;

/**
 * Create a new AuthStateManager instance (for DI)
 */
export function createAuthStateManager(): AuthStateManager {
  return new AuthStateManager();
}

/**
 * Get the singleton AuthStateManager instance (for backward compatibility)
 */
export function getAuthStateManager(): AuthStateManager {
  if (!stateManagerInstance) {
    stateManagerInstance = new AuthStateManager();
  }
  return stateManagerInstance;
}

export function disposeAuthStateManager(): void {
  if (stateManagerInstance) {
    stateManagerInstance.dispose();
    stateManagerInstance = undefined;
  }
}
