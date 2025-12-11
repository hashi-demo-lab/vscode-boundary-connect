/**
 * Unit tests for AuthManager
 */

// Simple smoke tests for AuthManager
describe('AuthManager', () => {
  describe('module exports', () => {
    it('should export createAuthManager function', () => {
      // This verifies the module can be imported
      const { createAuthManager } = require('../../../src/auth/authManager');
      expect(typeof createAuthManager).toBe('function');
    });
  });
});
