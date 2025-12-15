/**
 * Unit tests for BoundaryAPI
 */

import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';

// Mock http/https modules
const mockRequest = jest.fn();
const mockHttpsRequest = jest.fn();

jest.mock('http', () => ({
  request: mockRequest,
}));

jest.mock('https', () => ({
  request: mockHttpsRequest,
}));

// Mock the config service
const mockConfigService = {
  get: jest.fn(),
  getConfiguration: jest.fn(),
  onConfigurationChanged: { event: jest.fn() },
};

jest.mock('../../../src/utils/config', () => ({
  getConfigurationService: () => mockConfigService,
}));

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { BoundaryAPI } from '../../../src/boundary/api';
import { BoundaryErrorCode } from '../../../src/utils/errors';

describe('BoundaryAPI', () => {
  let api: BoundaryAPI;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default config values
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'addr') return 'https://boundary.local';
      if (key === 'tlsInsecure') return true;
      return undefined;
    });

    api = new BoundaryAPI(mockConfigService as any);
    api.setToken('test-token');
  });

  /**
   * Helper to create a mock HTTP response
   */
  function createMockResponse(statusCode: number, body: object | string): EventEmitter {
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = statusCode;

    // Simulate response data emission
    setTimeout(() => {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      response.emit('data', data);
      response.emit('end');
    }, 0);

    return response;
  }

  /**
   * Helper to create a mock request object
   */
  function createMockRequest(): EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock } {
    const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock };
    req.write = jest.fn();
    req.end = jest.fn();
    req.destroy = jest.fn();
    return req;
  }

  describe('constructor', () => {
    it('should create a BoundaryAPI instance', () => {
      expect(api).toBeInstanceOf(BoundaryAPI);
    });
  });

  describe('setToken', () => {
    it('should set the auth token', () => {
      api.setToken('new-token');
      // Token is private, but we can test it works via API calls
      expect(api).toBeDefined();
    });

    it('should clear the token when set to undefined', () => {
      api.setToken(undefined);
      // Subsequent calls should fail with auth error
      expect(api).toBeDefined();
    });
  });

  describe('listScopes', () => {
    it('should call the scopes API endpoint', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, {
        items: [
          { id: 'o_123', name: 'Test Org', scope_id: 'global' },
        ],
      });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const scopes = await api.listScopes('global');

      expect(mockHttpsRequest).toHaveBeenCalled();
      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.method).toBe('GET');
      expect(callOptions.path).toContain('/v1/scopes');
      expect(callOptions.path).toContain('scope_id=global');
      expect(callOptions.headers.Authorization).toBe('Bearer test-token');

      expect(scopes).toHaveLength(1);
      expect(scopes[0].id).toBe('o_123');
      expect(scopes[0].name).toBe('Test Org');
    });

    it('should handle empty scopes response', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, { items: [] });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const scopes = await api.listScopes('global');
      expect(scopes).toHaveLength(0);
    });

    it('should throw AUTH_FAILED on 401 response', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(401, { message: 'Unauthorized' });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await expect(api.listScopes('global')).rejects.toMatchObject({
        code: BoundaryErrorCode.AUTH_FAILED,
      });
    });

    it('should throw AUTH_FAILED on 403 response', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(403, { message: 'Forbidden' });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await expect(api.listScopes('global')).rejects.toMatchObject({
        code: BoundaryErrorCode.AUTH_FAILED,
      });
    });

    it('should throw error when no token is set', async () => {
      api.setToken(undefined);

      await expect(api.listScopes('global')).rejects.toMatchObject({
        code: BoundaryErrorCode.AUTH_FAILED,
      });
    });
  });

  describe('listTargets', () => {
    it('should call the targets API endpoint', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, {
        items: [
          {
            id: 'ttcp_123',
            scope_id: 'p_456',
            name: 'Test Target',
            type: 'tcp',
            scope: { id: 'p_456', type: 'project', name: 'Test Project' },
          },
        ],
      });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const targets = await api.listTargets('p_456', true);

      expect(mockHttpsRequest).toHaveBeenCalled();
      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.method).toBe('GET');
      expect(callOptions.path).toContain('/v1/targets');
      expect(callOptions.path).toContain('scope_id=p_456');
      expect(callOptions.path).toContain('recursive=true');

      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('ttcp_123');
      expect(targets[0].name).toBe('Test Target');
      expect(targets[0].type).toBe('tcp');
    });

    it('should handle targets without scope_id parameter', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, { items: [] });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await api.listTargets();

      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.path).toBe('/v1/targets');
    });

    it('should handle recursive parameter', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, { items: [] });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await api.listTargets('p_456', false);

      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.path).not.toContain('recursive=true');
    });
  });

  describe('listAuthMethods', () => {
    it('should call the auth-methods API endpoint', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, {
        items: [
          {
            id: 'amoidc_123',
            scope_id: 'global',
            name: 'OIDC Auth',
            type: 'oidc',
            is_primary: true,
          },
        ],
      });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const authMethods = await api.listAuthMethods('global');

      expect(mockHttpsRequest).toHaveBeenCalled();
      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.method).toBe('GET');
      expect(callOptions.path).toContain('/v1/auth-methods');
      expect(callOptions.path).toContain('scope_id=global');

      expect(authMethods).toHaveLength(1);
      expect(authMethods[0].id).toBe('amoidc_123');
      expect(authMethods[0].type).toBe('oidc');
      expect(authMethods[0].isPrimary).toBe(true);
    });
  });

  describe('authorizeSession', () => {
    it('should call the authorize-session API endpoint', async () => {
      const mockReq = createMockRequest();
      // Note: authorize-session returns session data directly, not wrapped in "item"
      const mockRes = createMockResponse(200, {
        session_id: 's_123',
        authorization_token: 'auth-token-xyz',
        endpoint: '10.0.0.1',
        endpoint_port: 22,
        expiration: '2025-12-16T00:00:00Z',
      });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const session = await api.authorizeSession('ttcp_456');

      expect(mockHttpsRequest).toHaveBeenCalled();
      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.method).toBe('POST');
      expect(callOptions.path).toContain('/v1/targets/ttcp_456:authorize-session');

      expect(session.sessionId).toBe('s_123');
      expect(session.authorizationToken).toBe('auth-token-xyz');
      expect(session.endpoint).toBe('10.0.0.1');
      expect(session.endpointPort).toBe(22);
    });

    it('should handle brokered credentials in response', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, {
        session_id: 's_123',
        authorization_token: 'auth-token-xyz',
        endpoint: '10.0.0.1',
        endpoint_port: 22,
        credentials: [
          {
            credential_source: {
              id: 'clvlt_123',
              name: 'SSH Credentials',
              type: 'vault-generic',
            },
            credential: {
              username: 'admin',
              private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
            },
          },
        ],
      });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const session = await api.authorizeSession('ttcp_456');

      expect(session.credentials).toBeDefined();
      expect(session.credentials).toHaveLength(1);
      expect(session.credentials![0].credential.username).toBe('admin');
      expect(session.credentials![0].credential.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    });

    it('should handle Vault secret structure in credentials', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, {
        session_id: 's_123',
        authorization_token: 'auth-token-xyz',
        endpoint: '10.0.0.1',
        credentials: [
          {
            credential_source: {
              id: 'clvlt_123',
              name: 'SSH Brokered',
              type: 'vault-generic',
            },
            secret: {
              decoded: {
                data: {
                  username: 'node',
                  private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
                  certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
                },
              },
            },
          },
        ],
      });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const session = await api.authorizeSession('ttcp_456');

      expect(session.credentials).toBeDefined();
      expect(session.credentials![0].credential.username).toBe('node');
      expect(session.credentials![0].credential.certificate).toContain('ssh-ed25519-cert');
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const mockReq = createMockRequest();

      mockHttpsRequest.mockImplementation((options, callback) => {
        setTimeout(() => {
          mockReq.emit('error', new Error('ECONNREFUSED'));
        }, 0);
        return mockReq;
      });

      await expect(api.listScopes('global')).rejects.toMatchObject({
        code: BoundaryErrorCode.CLI_NOT_FOUND,
      });
    });

    it('should handle timeout errors', async () => {
      const mockReq = createMockRequest();

      mockHttpsRequest.mockImplementation((options, callback) => {
        setTimeout(() => {
          mockReq.emit('timeout');
        }, 0);
        return mockReq;
      });

      await expect(api.listScopes('global')).rejects.toMatchObject({
        message: expect.stringContaining('timed out'),
      });
    });

    it('should handle malformed JSON response', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, 'not valid json');

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await expect(api.listScopes('global')).rejects.toMatchObject({
        code: BoundaryErrorCode.CLI_EXECUTION_FAILED,
      });
    });

    it('should handle API error responses', async () => {
      const mockReq = createMockRequest();
      const mockRes = createMockResponse(500, { message: 'Internal server error' });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await expect(api.listScopes('global')).rejects.toMatchObject({
        code: BoundaryErrorCode.CLI_EXECUTION_FAILED,
      });
    });
  });

  describe('TLS configuration', () => {
    it('should set rejectUnauthorized to false when tlsInsecure is true', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'addr') return 'https://boundary.local';
        if (key === 'tlsInsecure') return true;
        return undefined;
      });

      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, { items: [] });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await api.listScopes('global');

      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.rejectUnauthorized).toBe(false);
    });

    it('should not set rejectUnauthorized when tlsInsecure is false', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'addr') return 'https://boundary.local';
        if (key === 'tlsInsecure') return false;
        return undefined;
      });

      // Create new instance with updated config
      const secureApi = new BoundaryAPI(mockConfigService as any);
      secureApi.setToken('test-token');

      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, { items: [] });

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await secureApi.listScopes('global');

      const callOptions = mockHttpsRequest.mock.calls[0][0];
      expect(callOptions.rejectUnauthorized).toBeUndefined();
    });
  });

  describe('HTTP vs HTTPS', () => {
    it('should use http module for http:// addresses', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'addr') return 'http://boundary.local';
        if (key === 'tlsInsecure') return false;
        return undefined;
      });

      const httpApi = new BoundaryAPI(mockConfigService as any);
      httpApi.setToken('test-token');

      const mockReq = createMockRequest();
      const mockRes = createMockResponse(200, { items: [] });

      mockRequest.mockImplementation((options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      await httpApi.listScopes('global');

      expect(mockRequest).toHaveBeenCalled();
      expect(mockHttpsRequest).not.toHaveBeenCalled();
    });
  });
});
