/**
 * Unit tests for ConnectionManager
 */

describe('ConnectionManager', () => {
  describe('module exports', () => {
    it('should export ConnectionManager class', () => {
      const { ConnectionManager } = require('../../../src/connection/connectionManager');
      expect(typeof ConnectionManager).toBe('function');
    });

    it('should export getConnectionManager function', () => {
      const { getConnectionManager } = require('../../../src/connection/connectionManager');
      expect(typeof getConnectionManager).toBe('function');
    });

    it('should export disposeConnectionManager function', () => {
      const { disposeConnectionManager } = require('../../../src/connection/connectionManager');
      expect(typeof disposeConnectionManager).toBe('function');
    });
  });
});
