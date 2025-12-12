/**
 * Unit tests for TargetService
 */

describe('TargetService', () => {
  describe('module exports', () => {
    it('should export TargetService class', () => {
      const { TargetService } = require('../../../src/targets/targetService');
      expect(typeof TargetService).toBe('function');
    });

    it('should export getTargetService function', () => {
      const { getTargetService } = require('../../../src/targets/targetService');
      expect(typeof getTargetService).toBe('function');
    });

    it('should export disposeTargetService function', () => {
      const { disposeTargetService } = require('../../../src/targets/targetService');
      expect(typeof disposeTargetService).toBe('function');
    });
  });
});
