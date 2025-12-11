/**
 * Unit tests for Boundary CLI output parser
 */

import {
  extractPort,
  parseAuthResponse,
  parseScopesResponse,
  parseTargetsResponse,
  PORT_REGEX,
} from '../../../src/boundary/parser';
import { mockBoundaryResponses } from '../../mocks/boundary';

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

    it('should not match invalid formats', () => {
      const outputs = [
        'Connected to target',
        'Port: 12345',
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

    it('should throw on invalid JSON', () => {
      expect(() => parseAuthResponse('invalid json')).toThrow();
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
});
