/**
 * Unit tests for QuickPick utilities
 */

describe('QuickPick Utilities', () => {
  describe('module exports', () => {
    it('should export showAuthMethodPicker function', () => {
      const { showAuthMethodPicker } = require('../../../src/ui/quickPick');
      expect(typeof showAuthMethodPicker).toBe('function');
    });

    it('should export showTargetPicker function', () => {
      const { showTargetPicker } = require('../../../src/ui/quickPick');
      expect(typeof showTargetPicker).toBe('function');
    });

    it('should export showSessionPicker function', () => {
      const { showSessionPicker } = require('../../../src/ui/quickPick');
      expect(typeof showSessionPicker).toBe('function');
    });

    it('should export showSessionsList function', () => {
      const { showSessionsList } = require('../../../src/ui/quickPick');
      expect(typeof showSessionsList).toBe('function');
    });
  });
});
