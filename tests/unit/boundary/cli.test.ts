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

    it('should have listAuthMethods method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.listAuthMethods).toBe('function');
    });

    it('should have connect method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.connect).toBe('function');
    });

    it('should have getVersion method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.getVersion).toBe('function');
    });

    it('should have getToken method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.getToken).toBe('function');
    });

    it('should have listScopes method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.listScopes).toBe('function');
    });

    it('should have authorizeSession method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.authorizeSession).toBe('function');
    });

    it('should have killProcess method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.killProcess).toBe('function');
    });

    it('should have killAllProcesses method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.killAllProcesses).toBe('function');
    });

    it('should have dispose method', () => {
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      const cli = new BoundaryCLI();
      expect(typeof cli.dispose).toBe('function');
    });
  });

  describe('singleton behavior', () => {
    beforeEach(() => {
      // Reset the singleton between tests
      const { disposeBoundaryCLI } = require('../../../src/boundary/cli');
      disposeBoundaryCLI();
    });

    it('should return same instance from getBoundaryCLI', () => {
      const { getBoundaryCLI } = require('../../../src/boundary/cli');
      const cli1 = getBoundaryCLI();
      const cli2 = getBoundaryCLI();
      expect(cli1).toBe(cli2);
    });

    it('should create new instance after dispose', () => {
      const { getBoundaryCLI, disposeBoundaryCLI } = require('../../../src/boundary/cli');
      const cli1 = getBoundaryCLI();
      disposeBoundaryCLI();
      const cli2 = getBoundaryCLI();
      expect(cli1).not.toBe(cli2);
    });
  });
});
