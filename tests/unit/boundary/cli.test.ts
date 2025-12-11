/**
 * Unit tests for BoundaryCLI
 */

describe('BoundaryCLI', () => {
  describe('module exports', () => {
    it('should export BoundaryCLI class', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      expect(typeof BoundaryCLI).toBe('function');
    });

    it('should export getBoundaryCLI function', () => {
      const { getBoundaryCLI } = require('../../../src/boundary/cli');
      expect(typeof getBoundaryCLI).toBe('function');
    });

    it('should export disposeBoundaryCLI function', () => {
      const { disposeBoundaryCLI } = require('../../../src/boundary/cli');
      expect(typeof disposeBoundaryCLI).toBe('function');
    });
  });

  describe('BoundaryCLI instance', () => {
    it('should create a BoundaryCLI instance', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(cli).toBeInstanceOf(BoundaryCLI);
    });

    it('should have checkInstalled method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.checkInstalled).toBe('function');
    });

    it('should have authenticate method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.authenticate).toBe('function');
    });

    it('should have listTargets method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.listTargets).toBe('function');
    });

    it('should have connect method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.connect).toBe('function');
    });
  });
});
