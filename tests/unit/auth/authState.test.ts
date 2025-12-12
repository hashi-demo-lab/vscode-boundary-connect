/**
 * Unit tests for AuthStateManager
 * Tests the auth state machine transitions and behavior
 */

// Mock logger before importing AuthStateManager
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { AuthStateManager, AuthState, AuthEvent } from '../../../src/auth/authState';

describe('AuthStateManager', () => {
  let stateManager: AuthStateManager;

  beforeEach(() => {
    stateManager = new AuthStateManager();
  });

  afterEach(() => {
    stateManager.dispose();
  });

  describe('initial state', () => {
    it('should start in initializing state', () => {
      expect(stateManager.state).toBe('initializing');
    });

    it('should not be authenticated initially', () => {
      expect(stateManager.isAuthenticated).toBe(false);
    });

    it('should have no error initially', () => {
      expect(stateManager.lastError).toBeUndefined();
    });
  });

  describe('INIT_COMPLETE event', () => {
    it('should transition to authenticated when token exists', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      expect(stateManager.state).toBe('authenticated');
      expect(stateManager.isAuthenticated).toBe(true);
    });

    it('should transition to unauthenticated when no token', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      expect(stateManager.state).toBe('unauthenticated');
      expect(stateManager.isAuthenticated).toBe(false);
    });
  });

  describe('LOGIN_START event', () => {
    it('should transition from unauthenticated to authenticating', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      expect(stateManager.state).toBe('authenticating');
    });

    it('should transition from expired to authenticating', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
      stateManager.dispatch({ type: 'LOGIN_START' });
      expect(stateManager.state).toBe('authenticating');
    });

    it('should transition from authenticated to authenticating (re-auth)', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      stateManager.dispatch({ type: 'LOGIN_START' });
      expect(stateManager.state).toBe('authenticating');
    });
  });

  describe('LOGIN_SUCCESS event', () => {
    it('should transition from authenticating to authenticated', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      expect(stateManager.state).toBe('authenticated');
      expect(stateManager.isAuthenticated).toBe(true);
    });

    it('should clear error on success', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_FAILURE', error: 'test error' });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      expect(stateManager.lastError).toBeUndefined();
    });
  });

  describe('LOGIN_FAILURE event', () => {
    it('should transition from authenticating to unauthenticated', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_FAILURE', error: 'Invalid credentials' });
      expect(stateManager.state).toBe('unauthenticated');
    });

    it('should store error message', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_FAILURE', error: 'Invalid credentials' });
      expect(stateManager.lastError).toBe('Invalid credentials');
    });
  });

  describe('TOKEN_EXPIRED event', () => {
    it('should transition from authenticated to expired', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
      expect(stateManager.state).toBe('expired');
      expect(stateManager.isAuthenticated).toBe(false);
    });
  });

  describe('LOGOUT event', () => {
    it('should transition from authenticated to unauthenticated', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      stateManager.dispatch({ type: 'LOGOUT' });
      expect(stateManager.state).toBe('unauthenticated');
      expect(stateManager.isAuthenticated).toBe(false);
    });

    it('should transition from expired to unauthenticated', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
      stateManager.dispatch({ type: 'LOGOUT' });
      expect(stateManager.state).toBe('unauthenticated');
    });
  });

  describe('AUTH_ERROR event', () => {
    it('should transition from authenticating to error', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'AUTH_ERROR', error: 'Network error' });
      expect(stateManager.state).toBe('error');
    });

    it('should store error message', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'AUTH_ERROR', error: 'Network error' });
      expect(stateManager.lastError).toBe('Network error');
    });

    it('should transition from initializing to error', () => {
      stateManager.dispatch({ type: 'AUTH_ERROR', error: 'Init error' });
      expect(stateManager.state).toBe('error');
    });
  });

  describe('invalid transitions', () => {
    it('should not allow direct transition from initializing to expired', () => {
      stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
      expect(stateManager.state).toBe('initializing'); // Should not change
    });

    it('should not allow direct transition from unauthenticated to expired', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
      expect(stateManager.state).toBe('unauthenticated'); // Should not change
    });

    it('should allow no-op transition (same state)', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      const initialState = stateManager.state;
      // Dispatching LOGIN_SUCCESS when already authenticated should be a no-op
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      expect(stateManager.state).toBe(initialState);
    });
  });

  describe('state change events', () => {
    it('should fire onStateChanged when state changes', () => {
      const listener = jest.fn();
      stateManager.onStateChanged(listener);

      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });

      expect(listener).toHaveBeenCalledWith('authenticated');
    });

    it('should fire for each valid state change', () => {
      const states: AuthState[] = [];
      stateManager.onStateChanged(state => states.push(state));

      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      stateManager.dispatch({ type: 'LOGOUT' });

      expect(states).toEqual([
        'unauthenticated',
        'authenticating',
        'authenticated',
        'unauthenticated',
      ]);
    });
  });

  describe('reset', () => {
    it('should reset to initializing state', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      stateManager.reset();
      expect(stateManager.state).toBe('initializing');
    });

    it('should clear error on reset', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_FAILURE', error: 'test' });
      stateManager.reset();
      expect(stateManager.lastError).toBeUndefined();
    });
  });

  describe('complete auth flow scenarios', () => {
    it('should handle successful login flow', () => {
      // Start up - no existing token
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });
      expect(stateManager.state).toBe('unauthenticated');

      // User clicks login
      stateManager.dispatch({ type: 'LOGIN_START' });
      expect(stateManager.state).toBe('authenticating');

      // Login succeeds
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      expect(stateManager.state).toBe('authenticated');
      expect(stateManager.isAuthenticated).toBe(true);
    });

    it('should handle existing token on startup', () => {
      // Start up with existing token in keyring
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      expect(stateManager.state).toBe('authenticated');
      expect(stateManager.isAuthenticated).toBe(true);
    });

    it('should handle token expiration and re-login', () => {
      // Start authenticated
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });

      // Token expires
      stateManager.dispatch({ type: 'TOKEN_EXPIRED' });
      expect(stateManager.state).toBe('expired');
      expect(stateManager.isAuthenticated).toBe(false);

      // User re-authenticates
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      expect(stateManager.state).toBe('authenticated');
    });

    it('should handle login failure and retry', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: false });

      // First login attempt fails
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_FAILURE', error: 'Invalid credentials' });
      expect(stateManager.state).toBe('unauthenticated');
      expect(stateManager.lastError).toBe('Invalid credentials');

      // Retry succeeds
      stateManager.dispatch({ type: 'LOGIN_START' });
      stateManager.dispatch({ type: 'LOGIN_SUCCESS' });
      expect(stateManager.state).toBe('authenticated');
      expect(stateManager.lastError).toBeUndefined();
    });

    it('should handle logout flow', () => {
      stateManager.dispatch({ type: 'INIT_COMPLETE', hasToken: true });
      expect(stateManager.isAuthenticated).toBe(true);

      stateManager.dispatch({ type: 'LOGOUT' });
      expect(stateManager.state).toBe('unauthenticated');
      expect(stateManager.isAuthenticated).toBe(false);
    });
  });
});
