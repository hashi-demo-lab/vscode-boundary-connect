/**
 * Unit tests for StatusBarManager
 */

describe('StatusBarManager', () => {
  describe('module exports', () => {
    it('should export StatusBarManager class', () => {
      const { StatusBarManager } = require('../../../src/ui/statusBar');
      expect(typeof StatusBarManager).toBe('function');
    });

    it('should export getStatusBarManager function', () => {
      const { getStatusBarManager } = require('../../../src/ui/statusBar');
      expect(typeof getStatusBarManager).toBe('function');
    });

    it('should export disposeStatusBarManager function', () => {
      const { disposeStatusBarManager } = require('../../../src/ui/statusBar');
      expect(typeof disposeStatusBarManager).toBe('function');
    });
  });
});
