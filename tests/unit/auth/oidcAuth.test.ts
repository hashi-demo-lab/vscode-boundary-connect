/**
 * Unit tests for OIDC authentication flow
 */

describe('OIDC Auth Flow', () => {
  describe('module exports', () => {
    it('should export executeOidcAuth function', () => {
      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      expect(typeof executeOidcAuth).toBe('function');
    });
  });
});
