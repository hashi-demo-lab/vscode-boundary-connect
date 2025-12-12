/**
 * Unit tests for Logger credential redaction
 * Tests that sensitive fields are properly redacted from logs
 */

import { Logger, LogLevel } from '../../../src/utils/logger';
import { BrokeredCredential } from '../../../src/types';

// Mock vscode
jest.mock('vscode');

describe('Logger', () => {
  let logger: Logger;
  let mockOutputChannel: {
    appendLine: jest.Mock;
    append: jest.Mock;
    clear: jest.Mock;
    show: jest.Mock;
    hide: jest.Mock;
    dispose: jest.Mock;
  };

  beforeEach(() => {
    // Create a fresh mock output channel for each test
    mockOutputChannel = {
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    };

    // Mock vscode.window.createOutputChannel to return our mock
    const vscode = require('vscode');
    vscode.window.createOutputChannel = jest.fn(() => mockOutputChannel);

    // Get a fresh logger instance
    logger = Logger.getInstance();
    logger.setLogLevel('debug'); // Enable all log levels
  });

  afterEach(() => {
    // Clean up logger instance
    logger.dispose();
    jest.clearAllMocks();
  });

  describe('credential redaction', () => {
    describe('password field redaction', () => {
      it('should redact password fields in logged objects', () => {
        const objWithPassword = {
          username: 'admin',
          password: 'secret123',
        };

        logger.info('Credentials:', objWithPassword);

        expect(mockOutputChannel.appendLine).toHaveBeenCalled();
        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

        // Password should be redacted
        expect(loggedContent).not.toContain('secret123');
        expect(loggedContent).toContain('[REDACTED]');

        // Username should NOT be redacted
        expect(loggedContent).toContain('admin');
      });

      it('should redact password in nested objects', () => {
        const nestedObj = {
          user: {
            username: 'testuser',
            password: 'mysecretpassword',
          },
          timestamp: '2023-01-01',
        };

        logger.debug('User data:', nestedObj);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('mysecretpassword');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('testuser');
        expect(loggedContent).toContain('2023-01-01');
      });

      it('should redact multiple password fields in same object', () => {
        const multiplePasswords = {
          oldPassword: 'old123',
          password: 'new456',
          confirmPassword: 'new456',
        };

        logger.warn('Password update:', multiplePasswords);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('old123');
        expect(loggedContent).not.toContain('new456');

        // Should have multiple redactions
        const redactedCount = (loggedContent.match(/\[REDACTED\]/g) || []).length;
        expect(redactedCount).toBeGreaterThanOrEqual(2);
      });
    });

    describe('privateKey field redaction', () => {
      it('should redact privateKey fields', () => {
        const objWithPrivateKey = {
          username: 'ubuntu',
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...',
        };

        logger.debug('SSH credentials:', objWithPrivateKey);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('BEGIN RSA PRIVATE KEY');
        expect(loggedContent).not.toContain('MIIEpAIBAAKCAQEA');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('ubuntu');
      });

      it('should redact privateKey in nested credential objects', () => {
        const credentialData = {
          credential: {
            username: 'ec2-user',
            privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUA...',
          },
        };

        logger.info('Got credentials:', credentialData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('BEGIN OPENSSH PRIVATE KEY');
        expect(loggedContent).not.toContain('b3BlbnNzaC1rZXktdjEA');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('ec2-user');
      });
    });

    describe('privateKeyPassphrase field redaction', () => {
      it('should redact privateKeyPassphrase fields', () => {
        const objWithPassphrase = {
          username: 'root',
          privateKeyPassphrase: 'my-key-password-123',
        };

        logger.debug('SSH key config:', objWithPassphrase);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('my-key-password-123');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('root');
      });

      it('should redact both privateKey and privateKeyPassphrase', () => {
        const sshConfig = {
          username: 'deploy',
          privateKey: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIIGN...',
          privateKeyPassphrase: 'passphrase123',
        };

        logger.info('SSH config:', sshConfig);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('BEGIN EC PRIVATE KEY');
        expect(loggedContent).not.toContain('passphrase123');

        // Should have at least 2 redactions (privateKey and passphrase)
        const redactedCount = (loggedContent.match(/\[REDACTED\]/g) || []).length;
        expect(redactedCount).toBeGreaterThanOrEqual(2);
      });
    });

    describe('token field redaction', () => {
      it('should redact token fields', () => {
        const authData = {
          username: 'admin',
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        };

        logger.debug('Auth data:', authData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('admin');
      });

      it('should redact authorizationToken fields', () => {
        const sessionData = {
          sessionId: 'sess_123',
          authorizationToken: 's_abc123def456',
        };

        logger.info('Session:', sessionData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('s_abc123def456');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('sess_123');
      });
    });

    describe('BrokeredCredential redaction', () => {
      it('should redact password in BrokeredCredential objects', () => {
        const brokeredCred: BrokeredCredential = {
          credentialSource: {
            id: 'cred_123',
            name: 'Database Password',
            description: 'Production DB',
            credentialStoreId: 'store_456',
            type: 'username_password',
          },
          credential: {
            username: 'dbuser',
            password: 'SuperSecret123!',
          },
        };

        logger.debug('Got brokered credentials:', brokeredCred);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

        // Sensitive data should be redacted
        expect(loggedContent).not.toContain('SuperSecret123!');
        expect(loggedContent).toContain('[REDACTED]');

        // Non-sensitive data should be visible
        expect(loggedContent).toContain('cred_123');
        expect(loggedContent).toContain('Database Password');
        expect(loggedContent).toContain('dbuser');
      });

      it('should redact privateKey in BrokeredCredential objects', () => {
        const brokeredCred: BrokeredCredential = {
          credentialSource: {
            id: 'cred_ssh_789',
            name: 'SSH Key',
            type: 'ssh_private_key',
          },
          credential: {
            username: 'ubuntu',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAuser...',
            privateKeyPassphrase: 'key-password-xyz',
          },
        };

        logger.info('SSH credentials from Boundary:', brokeredCred);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

        // Sensitive data should be redacted
        expect(loggedContent).not.toContain('BEGIN RSA PRIVATE KEY');
        expect(loggedContent).not.toContain('key-password-xyz');

        // Should have at least 2 redactions
        const redactedCount = (loggedContent.match(/\[REDACTED\]/g) || []).length;
        expect(redactedCount).toBeGreaterThanOrEqual(2);

        // Non-sensitive data should be visible
        expect(loggedContent).toContain('cred_ssh_789');
        expect(loggedContent).toContain('SSH Key');
        expect(loggedContent).toContain('ubuntu');
      });

      it('should handle array of BrokeredCredentials', () => {
        const credentials: BrokeredCredential[] = [
          {
            credentialSource: { id: 'cred_1', name: 'Cred 1' },
            credential: {
              username: 'user1',
              password: 'pass1',
            },
          },
          {
            credentialSource: { id: 'cred_2', name: 'Cred 2' },
            credential: {
              username: 'user2',
              privateKey: '-----BEGIN KEY-----\ndata...',
            },
          },
        ];

        logger.debug('Multiple credentials:', credentials);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

        // All sensitive data should be redacted
        expect(loggedContent).not.toContain('pass1');
        expect(loggedContent).not.toContain('BEGIN KEY');

        // Non-sensitive data should be visible
        expect(loggedContent).toContain('user1');
        expect(loggedContent).toContain('user2');
        expect(loggedContent).toContain('cred_1');
        expect(loggedContent).toContain('cred_2');
      });
    });

    describe('non-sensitive field preservation', () => {
      it('should NOT redact username fields', () => {
        const data = {
          username: 'myusername',
          password: 'mypassword',
        };

        logger.info('Login:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('myusername');
        expect(loggedContent).not.toContain('mypassword');
      });

      it('should NOT redact id fields', () => {
        const data = {
          id: 'user_12345',
          password: 'secret',
        };

        logger.debug('User:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('user_12345');
        expect(loggedContent).not.toContain('secret');
      });

      it('should NOT redact name fields', () => {
        const data = {
          name: 'Production Database',
          password: 'dbpass123',
        };

        logger.info('Database:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('Production Database');
        expect(loggedContent).not.toContain('dbpass123');
      });

      it('should NOT redact description fields', () => {
        const data = {
          description: 'SSH key for production servers',
          privateKey: '-----BEGIN KEY-----',
        };

        logger.debug('Key info:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('SSH key for production servers');
        expect(loggedContent).not.toContain('BEGIN KEY');
      });
    });

    describe('redaction at all log levels', () => {
      const sensitiveData = {
        username: 'testuser',
        password: 'testpass',
        privateKey: 'test-key',
        token: 'test-token',
      };

      it('should redact at debug level', () => {
        logger.debug('Debug message:', sensitiveData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('[DEBUG]');
        expect(loggedContent).not.toContain('testpass');
        expect(loggedContent).not.toContain('test-key');
        expect(loggedContent).not.toContain('test-token');
        expect(loggedContent).toContain('testuser');
      });

      it('should redact at info level', () => {
        logger.info('Info message:', sensitiveData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('[INFO '); // INFO is padded to 5 chars
        expect(loggedContent).not.toContain('testpass');
        expect(loggedContent).not.toContain('test-key');
        expect(loggedContent).not.toContain('test-token');
        expect(loggedContent).toContain('testuser');
      });

      it('should redact at warn level', () => {
        logger.warn('Warn message:', sensitiveData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('[WARN '); // WARN is padded to 5 chars
        expect(loggedContent).not.toContain('testpass');
        expect(loggedContent).not.toContain('test-key');
        expect(loggedContent).not.toContain('test-token');
        expect(loggedContent).toContain('testuser');
      });

      it('should redact at error level', () => {
        logger.error('Error message:', sensitiveData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('[ERROR]');
        expect(loggedContent).not.toContain('testpass');
        expect(loggedContent).not.toContain('test-key');
        expect(loggedContent).not.toContain('test-token');
        expect(loggedContent).toContain('testuser');
      });
    });

    describe('edge cases', () => {
      it('should handle objects with null values', () => {
        const data = {
          username: 'user',
          password: null,
        };

        logger.info('Null password:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('user');
        // null should still be redacted or shown as null, not crash
        expect(mockOutputChannel.appendLine).toHaveBeenCalled();
      });

      it('should handle objects with undefined values', () => {
        const data = {
          username: 'user',
          password: undefined,
        };

        logger.info('Undefined password:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('user');
        expect(mockOutputChannel.appendLine).toHaveBeenCalled();
      });

      it('should handle empty string passwords', () => {
        const data = {
          username: 'user',
          password: '',
        };

        logger.info('Empty password:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).toContain('user');
        expect(mockOutputChannel.appendLine).toHaveBeenCalled();
      });

      it('should handle deeply nested sensitive fields', () => {
        const deeplyNested = {
          level1: {
            level2: {
              level3: {
                username: 'deepuser',
                password: 'deeppass',
              },
            },
          },
        };

        logger.debug('Deep nesting:', deeplyNested);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('deeppass');
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).toContain('deepuser');
      });

      it('should handle arrays containing objects with sensitive fields', () => {
        const arrayData = [
          { id: 1, password: 'pass1' },
          { id: 2, password: 'pass2' },
        ];

        logger.info('Array of credentials:', arrayData);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('pass1');
        expect(loggedContent).not.toContain('pass2');
        expect(loggedContent).toContain('[REDACTED]');
      });

      it('should handle circular references gracefully', () => {
        const circular: any = { username: 'user', password: 'pass' };
        circular.self = circular;

        // Should not throw, even if JSON.stringify would fail
        expect(() => {
          logger.info('Circular ref:', circular);
        }).not.toThrow();

        expect(mockOutputChannel.appendLine).toHaveBeenCalled();
      });

      it('should handle non-object arguments', () => {
        logger.info('String message');
        logger.debug('Number:', 123);
        logger.warn('Boolean:', true);
        logger.error('Null:', null);

        expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(4);
      });
    });

    describe('case sensitivity', () => {
      it('should redact password field regardless of case', () => {
        const data = {
          Password: 'test1',
          PASSWORD: 'test2',
          pAsSwOrD: 'test3',
        };

        logger.info('Mixed case:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

        // All variations should be redacted
        expect(loggedContent).not.toContain('test1');
        expect(loggedContent).not.toContain('test2');
        expect(loggedContent).not.toContain('test3');
      });

      it('should redact token field regardless of case', () => {
        const data = {
          Token: 'token1',
          TOKEN: 'token2',
        };

        logger.debug('Token case:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        expect(loggedContent).not.toContain('token1');
        expect(loggedContent).not.toContain('token2');
      });
    });

    describe('partial field name matches', () => {
      it('should NOT redact fields that only contain "password" as substring', () => {
        const data = {
          passwordPolicy: 'min-8-chars',
          usePasswordAuth: true,
          password: 'secret123',
        };

        logger.info('Password policy:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

        // Only exact "password" field should be redacted
        expect(loggedContent).not.toContain('secret123');
        expect(loggedContent).toContain('min-8-chars');
        expect(loggedContent).toContain('true');
      });

      it('should redact compound password fields', () => {
        const data = {
          oldPassword: 'oldSecretPass123',
          newPassword: 'newSecretPass456',
          confirmPassword: 'newSecretPass456',
        };

        logger.debug('Password change:', data);

        const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
        // Field names are preserved, but values are redacted
        expect(loggedContent).toContain('oldPassword');
        expect(loggedContent).toContain('newPassword');
        expect(loggedContent).toContain('confirmPassword');
        // Values should be redacted
        expect(loggedContent).not.toContain('oldSecretPass123');
        expect(loggedContent).not.toContain('newSecretPass456');
        expect(loggedContent).toContain('[REDACTED]');
      });
    });

    describe('log level filtering', () => {
      it('should not log debug messages when log level is info', () => {
        logger.setLogLevel('info');

        logger.debug('Debug message:', { password: 'secret' });

        expect(mockOutputChannel.appendLine).not.toHaveBeenCalled();
      });

      it('should not log info messages when log level is warn', () => {
        logger.setLogLevel('warn');

        logger.info('Info message:', { password: 'secret' });
        logger.debug('Debug message:', { password: 'secret' });

        expect(mockOutputChannel.appendLine).not.toHaveBeenCalled();
      });

      it('should log all levels when log level is debug', () => {
        logger.setLogLevel('debug');

        logger.debug('Debug');
        logger.info('Info');
        logger.warn('Warn');
        logger.error('Error');

        expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(4);
      });
    });
  });

  describe('Logger singleton', () => {
    it('should return same instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after dispose', () => {
      const instance1 = Logger.getInstance();
      instance1.dispose();

      const instance2 = Logger.getInstance();

      expect(instance2).toBeDefined();
      // Clean up
      instance2.dispose();
    });
  });

  describe('Error handling', () => {
    it('should format Error objects correctly', () => {
      const error = new Error('Test error');

      logger.error('An error occurred:', error);

      const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
      expect(loggedContent).toContain('Test error');
      expect(loggedContent).toContain('[ERROR]');
    });

    it('should include stack trace for errors', () => {
      const error = new Error('Test error with stack');

      logger.error('Error:', error);

      const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
      expect(loggedContent).toContain('Test error with stack');
      // Stack trace should be present if available
      if (error.stack) {
        expect(loggedContent).toContain(error.stack);
      }
    });
  });

  describe('Message formatting', () => {
    it('should include timestamp in log messages', () => {
      logger.info('Test message');

      const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];

      // Should match ISO timestamp format [YYYY-MM-DDTHH:mm:ss.sssZ]
      expect(loggedContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should include log level in messages', () => {
      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      // Log levels are padded to 5 characters, so they include trailing spaces
      expect(mockOutputChannel.appendLine.mock.calls[0][0]).toContain('DEBUG');
      expect(mockOutputChannel.appendLine.mock.calls[1][0]).toContain('INFO');
      expect(mockOutputChannel.appendLine.mock.calls[2][0]).toContain('WARN');
      expect(mockOutputChannel.appendLine.mock.calls[3][0]).toContain('ERROR');
    });

    it('should handle multiple arguments', () => {
      logger.info('Message:', 'arg1', { key: 'value' }, 123);

      const loggedContent = mockOutputChannel.appendLine.mock.calls[0][0];
      expect(loggedContent).toContain('Message:');
      expect(loggedContent).toContain('arg1');
      expect(loggedContent).toContain('value');
      expect(loggedContent).toContain('123');
    });
  });

  describe('Output channel management', () => {
    it('should show output channel when show() is called', () => {
      logger.show();

      expect(mockOutputChannel.show).toHaveBeenCalled();
    });

    it('should dispose output channel when disposed', () => {
      logger.dispose();

      expect(mockOutputChannel.dispose).toHaveBeenCalled();
    });
  });
});
