/**
 * Unit tests for AuthManager
 */

// Simple smoke tests for AuthManager
describe('AuthManager', () => {
  describe('module exports', () => {
    it('should export createAuthManager function', () => {
      // This verifies the module can be imported
      try {
        const { createAuthManager } = require('../../../src/auth/authManager');
        expect(typeof createAuthManager).toBe('function');
      } catch (e) {
        console.error('Import error:', e);
        throw e;
      }
    });

    it('should export AuthManager class', () => {
      try {
        const { AuthManager } = require('../../../src/auth/authManager');
        expect(typeof AuthManager).toBe('function');
      } catch (e) {
        console.error('Import error:', e);
        throw e;
      }
    });
  });
});
