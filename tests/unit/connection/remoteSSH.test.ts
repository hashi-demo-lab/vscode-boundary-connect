/**
 * Unit tests for Remote SSH integration
 */

describe('Remote SSH Integration', () => {
  describe('module exports', () => {
    it('should export triggerRemoteSSH function', () => {
      const { triggerRemoteSSH } = require('../../../src/connection/remoteSSH');
      expect(typeof triggerRemoteSSH).toBe('function');
    });

    it('should export isRemoteSSHInstalled function', () => {
      const { isRemoteSSHInstalled } = require('../../../src/connection/remoteSSH');
      expect(typeof isRemoteSSHInstalled).toBe('function');
    });
  });
});
