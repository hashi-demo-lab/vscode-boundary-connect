/**
 * Boundary CLI output parser utilities
 */

import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { AuthResult, BoundaryScope, BoundaryTarget, SessionAuthorization } from '../types';

// Regex patterns for parsing CLI output
export const PORT_REGEX = /(?:Proxy listening|Listening) on (?:127\.0\.0\.1|localhost):(\d+)/i;
export const VERSION_REGEX = /Boundary v?(\d+\.\d+\.\d+)/i;

/**
 * Parse JSON response from Boundary CLI
 */
export function parseJsonResponse<T>(output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new BoundaryError(
      `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
      BoundaryErrorCode.PARSE_ERROR,
      { output }
    );
  }
}

/**
 * Check if response indicates an error
 */
export interface BoundaryApiResponse<T = unknown> {
  status_code: number;
  status?: string;
  item?: T;
  items?: T[];
  error?: {
    kind: string;
    message: string;
  };
}

export function isErrorResponse(response: BoundaryApiResponse): boolean {
  return response.status_code >= 400 || response.error !== undefined;
}

export function getErrorMessage(response: BoundaryApiResponse): string {
  if (response.error?.message) {
    return response.error.message;
  }
  if (response.status) {
    return response.status;
  }
  return `Request failed with status ${response.status_code}`;
}

/**
 * Parse authentication response
 */
interface AuthResponseItem {
  id: string;
  token: string;
  user_id: string;
  account_id: string;
  auth_method_id: string;
  expiration_time: string;
}

export function parseAuthResponse(output: string): AuthResult {
  const response = parseJsonResponse<BoundaryApiResponse<AuthResponseItem>>(output);

  if (isErrorResponse(response)) {
    return {
      success: false,
      error: getErrorMessage(response),
    };
  }

  const item = response.item;
  if (!item) {
    return {
      success: false,
      error: 'No authentication data in response',
    };
  }

  return {
    success: true,
    token: item.token,
    accountId: item.account_id,
    userId: item.user_id,
    expirationTime: item.expiration_time ? new Date(item.expiration_time) : undefined,
  };
}

/**
 * Parse scope list response
 */
interface ScopeResponseItem {
  id: string;
  scope_id: string;
  name: string;
  description?: string;
  type: 'global' | 'org' | 'project';
}

export function parseScopesResponse(output: string): BoundaryScope[] {
  const response = parseJsonResponse<BoundaryApiResponse<ScopeResponseItem>>(output);

  if (isErrorResponse(response)) {
    throw new BoundaryError(
      getErrorMessage(response),
      BoundaryErrorCode.CLI_EXECUTION_FAILED,
      response
    );
  }

  const items = response.items || [];
  return items.map(item => ({
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description,
    parentScopeId: item.scope_id,
  }));
}

/**
 * Parse target list response
 */
interface TargetResponseItem {
  id: string;
  scope_id: string;
  scope: {
    id: string;
    type: 'global' | 'org' | 'project';
    name: string;
    description?: string;
    parent_scope_id?: string;
  };
  name: string;
  description?: string;
  type: 'tcp' | 'ssh' | 'rdp';
  attributes?: {
    default_port?: number;
  };
  session_max_seconds?: number;
  session_connection_limit?: number;
  authorized_actions: string[];
  created_time?: string;
  updated_time?: string;
}

export function parseTargetsResponse(output: string): BoundaryTarget[] {
  const response = parseJsonResponse<BoundaryApiResponse<TargetResponseItem>>(output);

  if (isErrorResponse(response)) {
    throw new BoundaryError(
      getErrorMessage(response),
      BoundaryErrorCode.CLI_EXECUTION_FAILED,
      response
    );
  }

  const items = response.items || [];
  return items.map(item => ({
    id: item.id,
    scopeId: item.scope_id,
    scope: {
      id: item.scope.id,
      type: item.scope.type,
      name: item.scope.name,
      description: item.scope.description,
      parentScopeId: item.scope.parent_scope_id,
    },
    name: item.name,
    description: item.description,
    type: item.type,
    defaultPort: item.attributes?.default_port,
    sessionMaxSeconds: item.session_max_seconds,
    sessionConnectionLimit: item.session_connection_limit,
    authorizedActions: item.authorized_actions || [],
    createdTime: item.created_time ? new Date(item.created_time) : undefined,
    updatedTime: item.updated_time ? new Date(item.updated_time) : undefined,
  }));
}

/**
 * Parse session authorization response
 */
interface SessionAuthResponseItem {
  session_id: string;
  target_id: string;
  authorization_token: string;
  endpoint: string;
  endpoint_port: number;
  expiration_time: string;
  credentials?: unknown[];
}

export function parseSessionAuthResponse(output: string): SessionAuthorization {
  const response = parseJsonResponse<BoundaryApiResponse<SessionAuthResponseItem>>(output);

  if (isErrorResponse(response)) {
    throw new BoundaryError(
      getErrorMessage(response),
      BoundaryErrorCode.CLI_EXECUTION_FAILED,
      response
    );
  }

  const item = response.item;
  if (!item) {
    throw new BoundaryError(
      'No session authorization data in response',
      BoundaryErrorCode.PARSE_ERROR
    );
  }

  return {
    sessionId: item.session_id,
    authorizationToken: item.authorization_token,
    endpoint: item.endpoint,
    endpointPort: item.endpoint_port,
    expiration: new Date(item.expiration_time),
    credentials: item.credentials,
  };
}

/**
 * Extract local port from boundary connect output
 */
export function extractPort(output: string): number | undefined {
  const match = PORT_REGEX.exec(output);
  if (match && match[1]) {
    const port = parseInt(match[1], 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return port;
    }
  }
  return undefined;
}

/**
 * Extract version from boundary version output
 */
export function extractVersion(output: string): string | undefined {
  const match = VERSION_REGEX.exec(output);
  return match?.[1];
}

/**
 * Check if response indicates authentication is required
 */
export function isAuthRequired(response: BoundaryApiResponse): boolean {
  return response.status_code === 401 ||
         response.error?.kind === 'Unauthorized';
}

/**
 * Check if response indicates permission denied
 */
export function isPermissionDenied(response: BoundaryApiResponse): boolean {
  return response.status_code === 403 ||
         response.error?.kind === 'Forbidden';
}
