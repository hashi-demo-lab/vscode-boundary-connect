/**
 * Unit tests for TargetProvider (TreeDataProvider)
 */

describe('TargetProvider', () => {
  // Reset modules before each test to ensure clean state
  beforeEach(() => {
    jest.resetModules();
  });

  describe('module exports', () => {
    it('should export TargetProvider class', () => {
      const { TargetProvider } = require('../../../src/targets/targetProvider');
      expect(typeof TargetProvider).toBe('function');
    });

    it('should export createTargetProvider function', () => {
      const { createTargetProvider } = require('../../../src/targets/targetProvider');
      expect(typeof createTargetProvider).toBe('function');
    });
  });
});
