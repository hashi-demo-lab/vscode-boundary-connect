/**
 * Unit tests for error utilities
 * Tests error classification and handling
 */

import {
  BoundaryError,
  BoundaryErrorCode,
  isAuthRequired,
  isErrorCode,
  wrapError,
} from '../../../src/utils/errors';

describe('Error Utilities', () => {
  describe('BoundaryError', () => {
    it('should create error with code and message', () => {
      const error = new BoundaryError('Test error', BoundaryErrorCode.AUTH_FAILED);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(BoundaryErrorCode.AUTH_FAILED);
      expect(error.name).toBe('BoundaryError');
    });

    it('should store details', () => {
      const details = { status_code: 401, api_error: { kind: 'Unauthorized' } };
      const error = new BoundaryError('Auth failed', BoundaryErrorCode.AUTH_FAILED, details);
      expect(error.details).toEqual(details);
    });

    describe('getUserMessage', () => {
      it('should return friendly message for CLI_NOT_FOUND', () => {
        const error = new BoundaryError('not found', BoundaryErrorCode.CLI_NOT_FOUND);
        expect(error.getUserMessage()).toContain('Boundary CLI not found');
      });

      it('should return friendly message for TOKEN_EXPIRED', () => {
        const error = new BoundaryError('expired', BoundaryErrorCode.TOKEN_EXPIRED);
        expect(error.getUserMessage()).toContain('session has expired');
      });

      it('should return friendly message for AUTH_FAILED', () => {
        const error = new BoundaryError('bad creds', BoundaryErrorCode.AUTH_FAILED);
        expect(error.getUserMessage()).toContain('Authentication failed');
      });
    });

    describe('isRecoverable', () => {
      it('should return false for CLI_NOT_FOUND', () => {
        const error = new BoundaryError('not found', BoundaryErrorCode.CLI_NOT_FOUND);
        expect(error.isRecoverable()).toBe(false);
      });

      it('should return true for TOKEN_EXPIRED', () => {
        const error = new BoundaryError('expired', BoundaryErrorCode.TOKEN_EXPIRED);
        expect(error.isRecoverable()).toBe(true);
      });

      it('should return true for CONNECTION_FAILED', () => {
        const error = new BoundaryError('failed', BoundaryErrorCode.CONNECTION_FAILED);
        expect(error.isRecoverable()).toBe(true);
      });
    });

    describe('getSuggestedAction', () => {
      it('should suggest Install for CLI_NOT_FOUND', () => {
        const error = new BoundaryError('not found', BoundaryErrorCode.CLI_NOT_FOUND);
        expect(error.getSuggestedAction()).toBe('Install Boundary CLI');
      });

      it('should suggest Login for TOKEN_EXPIRED', () => {
        const error = new BoundaryError('expired', BoundaryErrorCode.TOKEN_EXPIRED);
        expect(error.getSuggestedAction()).toBe('Login');
      });

      it('should suggest Retry for CONNECTION_FAILED', () => {
        const error = new BoundaryError('failed', BoundaryErrorCode.CONNECTION_FAILED);
        expect(error.getSuggestedAction()).toBe('Retry');
      });
    });
  });

  describe('isErrorCode', () => {
    it('should return true for matching code', () => {
      const error = new BoundaryError('test', BoundaryErrorCode.AUTH_FAILED);
      expect(isErrorCode(error, BoundaryErrorCode.AUTH_FAILED)).toBe(true);
    });

    it('should return false for non-matching code', () => {
      const error = new BoundaryError('test', BoundaryErrorCode.AUTH_FAILED);
      expect(isErrorCode(error, BoundaryErrorCode.CLI_NOT_FOUND)).toBe(false);
    });

    it('should return false for non-BoundaryError', () => {
      const error = new Error('test');
      expect(isErrorCode(error, BoundaryErrorCode.AUTH_FAILED)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isErrorCode(null, BoundaryErrorCode.AUTH_FAILED)).toBe(false);
      expect(isErrorCode(undefined, BoundaryErrorCode.AUTH_FAILED)).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('should return existing BoundaryError unchanged', () => {
      const original = new BoundaryError('test', BoundaryErrorCode.AUTH_FAILED);
      const wrapped = wrapError(original, BoundaryErrorCode.UNKNOWN);
      expect(wrapped).toBe(original);
    });

    it('should wrap Error with specified code', () => {
      const original = new Error('test error');
      const wrapped = wrapError(original, BoundaryErrorCode.CONNECTION_FAILED);
      expect(wrapped).toBeInstanceOf(BoundaryError);
      expect(wrapped.code).toBe(BoundaryErrorCode.CONNECTION_FAILED);
      expect(wrapped.message).toBe('test error');
    });

    it('should wrap string with UNKNOWN code by default', () => {
      const wrapped = wrapError('test string');
      expect(wrapped).toBeInstanceOf(BoundaryError);
      expect(wrapped.code).toBe(BoundaryErrorCode.UNKNOWN);
      expect(wrapped.message).toBe('test string');
    });
  });

  describe('isAuthRequired', () => {
    describe('by error code', () => {
      it('should return true for AUTH_FAILED code', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.AUTH_FAILED);
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for TOKEN_EXPIRED code', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.TOKEN_EXPIRED);
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return false for other codes', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CONNECTION_FAILED);
        expect(isAuthRequired(error)).toBe(false);
      });
    });

    describe('by status code in details', () => {
      it('should return true for 401 status', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          status_code: 401,
        });
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for 403 status', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          status_code: 403,
        });
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return false for 500 status', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          status_code: 500,
        });
        expect(isAuthRequired(error)).toBe(false);
      });
    });

    describe('by api_error kind in details', () => {
      it('should return true for PermissionDenied kind', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          status_code: 403,
          api_error: { kind: 'PermissionDenied', message: 'No permission' },
        });
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for Unauthorized kind', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          status_code: 401,
          api_error: { kind: 'Unauthorized', message: 'Not logged in' },
        });
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for Unauthenticated kind', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          api_error: { kind: 'Unauthenticated', message: 'No token' },
        });
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for SessionExpired kind', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          api_error: { kind: 'SessionExpired', message: 'Session expired' },
        });
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for TokenExpired kind', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          api_error: { kind: 'TokenExpired', message: 'Token expired' },
        });
        expect(isAuthRequired(error)).toBe(true);
      });
    });

    describe('by error kind in details (legacy format)', () => {
      it('should return true for PermissionDenied in error field', () => {
        const error = new BoundaryError('test', BoundaryErrorCode.CLI_EXECUTION_FAILED, {
          status_code: 403,
          error: { kind: 'PermissionDenied', message: 'No permission' },
        });
        expect(isAuthRequired(error)).toBe(true);
      });
    });

    describe('by message string (fallback)', () => {
      it('should return true for "unauthenticated" in message', () => {
        const error = new Error('User is unauthenticated');
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for "unauthorized" in message', () => {
        const error = new Error('Unauthorized access');
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for "permission denied" in message', () => {
        const error = new Error('Permission denied for this resource');
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for "session expired" in message', () => {
        const error = new Error('Your session expired');
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return true for "token expired" in message', () => {
        const error = new Error('Token expired, please login again');
        expect(isAuthRequired(error)).toBe(true);
      });

      it('should return false for unrelated error message', () => {
        const error = new Error('Network timeout');
        expect(isAuthRequired(error)).toBe(false);
      });

      it('should be case insensitive', () => {
        const error = new Error('UNAUTHORIZED ACCESS');
        expect(isAuthRequired(error)).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should return false for null', () => {
        expect(isAuthRequired(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(isAuthRequired(undefined)).toBe(false);
      });

      it('should return false for plain object', () => {
        expect(isAuthRequired({ message: 'unauthorized' })).toBe(false);
      });

      it('should return false for string', () => {
        expect(isAuthRequired('unauthorized')).toBe(false);
      });
    });
  });
});
