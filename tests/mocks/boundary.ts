/**
 * Boundary CLI mocks for testing
 */

import { EventEmitter } from 'events';
import type {
  AuthResult,
  BoundaryScope,
  BoundaryTarget,
  Connection,
  SessionAuthorization,
} from '../../src/types';

// Mock CLI responses
export const mockAuthSuccessResponse = {
  status_code: 200,
  item: {
    id: 'at_mock123',
    token: 'at_mocktoken_abc123',
    user_id: 'u_mock123',
    account_id: 'acctpw_mock123',
    auth_method_id: 'ampw_mock123',
    expiration_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
};

export const mockAuthFailedResponse = {
  status_code: 401,
  status: 'Unauthorized',
  error: {
    kind: 'Unauthorized',
    message: 'Invalid login name or password',
  },
};

export const mockScopesResponse = {
  status_code: 200,
  items: [
    {
      id: 'o_mock123',
      scope_id: 'global',
      name: 'Mock Organization',
      description: 'A mock organization for testing',
      type: 'org' as const,
    },
    {
      id: 'p_mock456',
      scope_id: 'o_mock123',
      name: 'Mock Project',
      description: 'A mock project for testing',
      type: 'project' as const,
    },
  ],
};

export const mockTargetsResponse = {
  status_code: 200,
  items: [
    {
      id: 'ttcp_mock123',
      scope_id: 'p_mock456',
      scope: {
        id: 'p_mock456',
        type: 'project' as const,
        name: 'Mock Project',
        parent_scope_id: 'o_mock123',
      },
      name: 'mock-web-server',
      description: 'Mock web server for testing',
      type: 'tcp' as const,
      attributes: {
        default_port: 22,
      },
      session_max_seconds: 28800,
      session_connection_limit: -1,
      authorized_actions: ['read', 'authorize-session'],
    },
    {
      id: 'ttcp_mock456',
      scope_id: 'p_mock456',
      scope: {
        id: 'p_mock456',
        type: 'project' as const,
        name: 'Mock Project',
        parent_scope_id: 'o_mock123',
      },
      name: 'mock-database',
      description: 'Mock database for testing',
      type: 'tcp' as const,
      attributes: {
        default_port: 5432,
      },
      session_max_seconds: 28800,
      session_connection_limit: 5,
      authorized_actions: ['read', 'authorize-session'],
    },
  ],
};

export const mockSessionAuthResponse = {
  status_code: 200,
  item: {
    session_id: 's_mock123',
    target_id: 'ttcp_mock123',
    authorization_token: 'at_session_mock123',
    endpoint: 'boundary-worker.mock.local',
    endpoint_port: 9202,
    expiration_time: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    credentials: [],
  },
};

// Mock scopes
export const mockScopes: BoundaryScope[] = [
  {
    id: 'o_mock123',
    type: 'org',
    name: 'Mock Organization',
    description: 'A mock organization for testing',
    parentScopeId: 'global',
  },
  {
    id: 'p_mock456',
    type: 'project',
    name: 'Mock Project',
    description: 'A mock project for testing',
    parentScopeId: 'o_mock123',
  },
];

// Mock targets
export const mockTargets: BoundaryTarget[] = [
  {
    id: 'ttcp_mock123',
    scopeId: 'p_mock456',
    scope: {
      id: 'p_mock456',
      type: 'project',
      name: 'Mock Project',
      parentScopeId: 'o_mock123',
    },
    name: 'mock-web-server',
    description: 'Mock web server for testing',
    type: 'tcp',
    defaultPort: 22,
    sessionMaxSeconds: 28800,
    sessionConnectionLimit: -1,
    authorizedActions: ['read', 'authorize-session'],
  },
  {
    id: 'ttcp_mock456',
    scopeId: 'p_mock456',
    scope: {
      id: 'p_mock456',
      type: 'project',
      name: 'Mock Project',
      parentScopeId: 'o_mock123',
    },
    name: 'mock-database',
    description: 'Mock database for testing',
    type: 'tcp',
    defaultPort: 5432,
    sessionMaxSeconds: 28800,
    sessionConnectionLimit: 5,
    authorizedActions: ['read', 'authorize-session'],
  },
];

// Mock successful auth result
export const mockSuccessAuthResult: AuthResult = {
  success: true,
  token: 'at_mocktoken_abc123',
  accountId: 'acctpw_mock123',
  userId: 'u_mock123',
  expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
};

// Mock failed auth result
export const mockFailedAuthResult: AuthResult = {
  success: false,
  error: 'Invalid login name or password',
};

// Mock session authorization
export const mockSessionAuth: SessionAuthorization = {
  sessionId: 's_mock123',
  authorizationToken: 'at_session_mock123',
  endpoint: 'boundary-worker.mock.local',
  endpointPort: 9202,
  expiration: new Date(Date.now() + 8 * 60 * 60 * 1000),
  credentials: [],
};

// Mock child process for connection
export function createMockChildProcess(port = 52847): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: jest.Mock;
  killed: boolean;
  pid: number;
} {
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.kill = jest.fn(() => {
    process.killed = true;
    process.emit('exit', 0, null);
  });
  process.killed = false;
  process.pid = 12345;

  // Simulate port output after a short delay
  setTimeout(() => {
    process.stdout.emit('data', Buffer.from(`Proxy listening on 127.0.0.1:${port}\n`));
  }, 100);

  return process;
}

// Mock connection
export function createMockConnection(targetId = 'ttcp_mock123', port = 52847): Connection {
  return {
    sessionId: `session-${Date.now()}`,
    targetId,
    targetName: 'mock-web-server',
    localHost: '127.0.0.1',
    localPort: port,
    process: createMockChildProcess(port) as unknown as import('child_process').ChildProcess,
    startTime: new Date(),
  };
}

// Mock child process factory for testing
export const mockChildProcess = {
  spawn: jest.fn(),
  exec: jest.fn(),
};

// Create mock spawn instance
export function createMockSpawn(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: jest.Mock; end: jest.Mock };
  kill: jest.Mock;
  killed: boolean;
  pid: number;
} {
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: jest.Mock; end: jest.Mock };
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdin = {
    write: jest.fn(),
    end: jest.fn(),
  };
  process.kill = jest.fn(() => {
    process.killed = true;
    return true;
  });
  process.killed = false;
  process.pid = 12345;

  return process;
}

// Mock auth methods response
export const mockAuthMethodsResponse = {
  status_code: 200,
  items: [
    {
      id: 'amoidc_1234567890',
      scope_id: 'global',
      name: 'Okta SSO',
      description: 'Sign in with Okta',
      type: 'oidc' as const,
      is_primary: true,
      created_time: '2024-01-01T00:00:00Z',
      updated_time: '2024-01-01T00:00:00Z',
    },
    {
      id: 'ampw_1234567890',
      scope_id: 'global',
      name: 'Password',
      description: 'Username and password authentication',
      type: 'password' as const,
      is_primary: false,
      created_time: '2024-01-01T00:00:00Z',
      updated_time: '2024-01-01T00:00:00Z',
    },
  ],
};

export const mockAuthMethodsResponseSingleOidc = {
  status_code: 200,
  items: [
    {
      id: 'amoidc_keycloak123',
      scope_id: 'global',
      name: 'Keycloak',
      description: 'Keycloak OIDC authentication',
      type: 'oidc' as const,
      is_primary: true,
      created_time: '2024-01-01T00:00:00Z',
      updated_time: '2024-01-01T00:00:00Z',
    },
  ],
};

export const mockAuthMethodsResponseEmpty = {
  status_code: 200,
  items: [],
};

export const mockAuthMethodsResponseError = {
  status_code: 401,
  error: {
    kind: 'Unauthorized',
    message: 'Not authenticated',
  },
};

// Mock boundary CLI responses for JSON parsing
export const mockBoundaryResponses = {
  authenticate: {
    token: 'at_1234567890abcdef',
    user_id: 'u_1234567890',
    account_id: 'acctpw_1234567890',
    auth_method_id: 'ampw_1234567890',
  },
  listAuthMethods: mockAuthMethodsResponse,
  listTargets: {
    items: [
      {
        id: 'ttcp_1234567890',
        scope_id: 'p_1234567890',
        name: 'web-server',
        description: 'Production web server',
        type: 'tcp',
        attributes: {
          default_port: 22,
        },
        scope: {
          id: 'p_1234567890',
          type: 'project',
          name: 'Production',
        },
      },
      {
        id: 'ttcp_0987654321',
        scope_id: 'p_1234567890',
        name: 'database',
        description: 'Production database',
        type: 'tcp',
        attributes: {
          default_port: 5432,
        },
        scope: {
          id: 'p_1234567890',
          type: 'project',
          name: 'Production',
        },
      },
    ],
  },
  listScopes: {
    items: [
      {
        id: 'o_1234567890',
        name: 'My Organization',
        description: 'Main organization',
        type: 'org',
      },
      {
        id: 'p_1234567890',
        name: 'Production',
        description: 'Production project',
        type: 'project',
        parent_scope_id: 'o_1234567890',
      },
    ],
  },
};
