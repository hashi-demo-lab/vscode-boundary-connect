/**
 * Unit tests for Boundary CLI output parser
 */

import {
  extractPort,
  parseAuthMethodsResponse,
  parseAuthResponse,
  parseScopesResponse,
  parseTargetsResponse,
  PORT_REGEX,
} from '../../../src/boundary/parser';
import {
  mockBoundaryResponses,
  mockAuthMethodsResponse,
  mockAuthMethodsResponseSingleOidc,
  mockAuthMethodsResponseEmpty,
  mockAuthMethodsResponseError,
} from '../../mocks/boundary';

describe('Boundary Parser', () => {
  describe('PORT_REGEX', () => {
    it('should match "Proxy listening on 127.0.0.1:PORT"', () => {
      const output = 'Proxy listening on 127.0.0.1:54321';
      const match = output.match(PORT_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('54321');
    });

    it('should match "Listening on 127.0.0.1:PORT"', () => {
      const output = 'Listening on 127.0.0.1:12345';
      const match = output.match(PORT_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('12345');
    });

    it('should match "Listening on localhost:PORT"', () => {
      const output = 'Listening on localhost:9999';
      const match = output.match(PORT_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('9999');
    });

    it('should be case insensitive', () => {
      const output = 'PROXY LISTENING ON 127.0.0.1:54321';
      const match = output.match(PORT_REGEX);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('54321');
    });

    it('should match new format "Port: 12345"', () => {
      const output = `Proxy listening information:
  Address:             127.0.0.1
  Connection Limit:    -1
  Expiration:          Fri, 12 Dec 2025 17:36:29 AEDT
  Port:                59262
  Protocol:            ssh
  Session ID:          s_9i9Y0qR08T`;
      const match = output.match(PORT_REGEX);

      expect(match).not.toBeNull();
      // New format uses capture group 2
      expect(match![2]).toBe('59262');
    });

    it('should match simplified new format', () => {
      const output = '  Port:                12345';
      const match = output.match(PORT_REGEX);

      expect(match).not.toBeNull();
      // New format uses capture group 2
      expect(match![2]).toBe('12345');
    });

    it('should not match invalid formats', () => {
      const outputs = [
        'Connected to target',
        'Address: 127.0.0.1:12345',
      ];

      for (const output of outputs) {
        expect(output.match(PORT_REGEX)).toBeNull();
      }
    });
  });

  describe('extractPort', () => {
    it('should extract port from valid output', () => {
      const output = 'Proxy listening on 127.0.0.1:54321';
      expect(extractPort(output)).toBe(54321);
    });

    it('should extract port from multiline output', () => {
      const output = `
        Connecting to target...
        Session created: s_1234567890
        Proxy listening on 127.0.0.1:54321
        Connection established
      `;
      expect(extractPort(output)).toBe(54321);
    });

    it('should return undefined for output without port', () => {
      const output = 'Error: connection failed';
      expect(extractPort(output)).toBeUndefined();
    });

    it('should extract first port if multiple present', () => {
      const output = `
        Proxy listening on 127.0.0.1:11111
        Proxy listening on 127.0.0.1:22222
      `;
      expect(extractPort(output)).toBe(11111);
    });

    it('should extract port from new multiline format', () => {
      const output = `Proxy listening information:
  Address:             127.0.0.1
  Connection Limit:    -1
  Expiration:          Fri, 12 Dec 2025 17:36:29 AEDT
  Port:                59262
  Protocol:            ssh
  Session ID:          s_9i9Y0qR08T`;
      expect(extractPort(output)).toBe(59262);
    });
  });

  describe('parseAuthResponse', () => {
    it('should parse valid auth response', () => {
      // Boundary CLI returns auth response wrapped in { status_code, item: {...} }
      const authResponse = {
        status_code: 200,
        item: mockBoundaryResponses.authenticate,
      };
      const json = JSON.stringify(authResponse);
      const result = parseAuthResponse(json);

      expect(result.success).toBe(true);
      expect(result.token).toBe('at_1234567890abcdef');
    });

    it('should return error for invalid JSON', () => {
      const result = parseAuthResponse('invalid json');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('parseTargetsResponse', () => {
    it('should parse valid targets list response', () => {
      const json = JSON.stringify(mockBoundaryResponses.listTargets);
      const result = parseTargetsResponse(json);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('type');
    });

    it('should handle empty items array', () => {
      const json = JSON.stringify({ items: [] });
      const result = parseTargetsResponse(json);

      expect(result).toEqual([]);
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseTargetsResponse('not json')).toThrow();
    });
  });

  describe('parseScopesResponse', () => {
    it('should parse valid scopes list response', () => {
      const json = JSON.stringify(mockBoundaryResponses.listScopes);
      const result = parseScopesResponse(json);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
    });

    it('should handle empty items array', () => {
      const json = JSON.stringify({ items: [] });
      const result = parseScopesResponse(json);

      expect(result).toEqual([]);
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseScopesResponse('invalid')).toThrow();
    });
  });

  describe('parseAuthMethodsResponse', () => {
    it('should parse valid auth methods list response', () => {
      const json = JSON.stringify(mockAuthMethodsResponse);
      const result = parseAuthMethodsResponse(json);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty('id', 'amoidc_1234567890');
      expect(result[0]).toHaveProperty('name', 'Okta SSO');
      expect(result[0]).toHaveProperty('type', 'oidc');
      expect(result[0]).toHaveProperty('isPrimary', true);
    });

    it('should parse single OIDC method response', () => {
      const json = JSON.stringify(mockAuthMethodsResponseSingleOidc);
      const result = parseAuthMethodsResponse(json);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('amoidc_keycloak123');
      expect(result[0].name).toBe('Keycloak');
      expect(result[0].type).toBe('oidc');
    });

    it('should handle empty items array', () => {
      const json = JSON.stringify(mockAuthMethodsResponseEmpty);
      const result = parseAuthMethodsResponse(json);

      expect(result).toEqual([]);
    });

    it('should throw on error response', () => {
      const json = JSON.stringify(mockAuthMethodsResponseError);
      expect(() => parseAuthMethodsResponse(json)).toThrow();
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseAuthMethodsResponse('invalid json')).toThrow();
    });

    it('should parse auth method with all fields', () => {
      const json = JSON.stringify(mockAuthMethodsResponse);
      const result = parseAuthMethodsResponse(json);

      // Check OIDC method
      const oidcMethod = result.find(m => m.type === 'oidc');
      expect(oidcMethod).toBeDefined();
      expect(oidcMethod!.id).toBe('amoidc_1234567890');
      expect(oidcMethod!.scopeId).toBe('global');
      expect(oidcMethod!.name).toBe('Okta SSO');
      expect(oidcMethod!.description).toBe('Sign in with Okta');
      expect(oidcMethod!.isPrimary).toBe(true);
      expect(oidcMethod!.createdTime).toBeInstanceOf(Date);
      expect(oidcMethod!.updatedTime).toBeInstanceOf(Date);

      // Check password method
      const pwdMethod = result.find(m => m.type === 'password');
      expect(pwdMethod).toBeDefined();
      expect(pwdMethod!.id).toBe('ampw_1234567890');
      expect(pwdMethod!.isPrimary).toBe(false);
    });

    it('should provide default name for auth methods without names', () => {
      const response = {
        status_code: 200,
        items: [
          {
            id: 'amoidc_noname',
            scope_id: 'global',
            type: 'oidc',
            is_primary: false,
          },
        ],
      };
      const json = JSON.stringify(response);
      const result = parseAuthMethodsResponse(json);

      expect(result[0].name).toBe('Single Sign-On (OIDC)');
    });
  });
});
