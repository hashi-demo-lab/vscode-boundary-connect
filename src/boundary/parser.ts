/**
 * Boundary CLI output parser utilities
 */

import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { AuthResult, BoundaryAuthMethod, BoundaryScope, BoundaryTarget, SessionAuthorization } from '../types';

// Regex patterns for parsing CLI output
// Matches both old format: "Proxy listening on 127.0.0.1:PORT"
// and new format: "  Port:                PORT"
export const PORT_REGEX = /(?:(?:Proxy listening|Listening) on (?:127\.0\.0\.1|localhost):(\d+)|Port:\s+(\d+))/i;
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
  context?: string;
  item?: T;
  items?: T[];
  error?: {
    kind: string;
    message: string;
  };
  // Some API responses use api_error instead of error
  api_error?: {
    kind: string;
    message: string;
  };
}

export function isErrorResponse(response: BoundaryApiResponse): boolean {
  return response.status_code >= 400 || response.error !== undefined || response.api_error !== undefined;
}

export function getErrorMessage(response: BoundaryApiResponse): string {
  const apiError = response.api_error || response.error;
  if (apiError?.message) {
    return apiError.message;
  }
  if (response.context) {
    return response.context;
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
  // OIDC auth may have non-JSON output before the JSON response
  // Try to find JSON in the output
  let jsonOutput = output.trim();

  // Look for JSON object start
  const jsonStart = output.indexOf('{');
  if (jsonStart > 0) {
    jsonOutput = output.substring(jsonStart);
  }

  // If output is empty or doesn't contain JSON, check for success indicators
  if (!jsonOutput || !jsonOutput.startsWith('{')) {
    // Check if OIDC auth succeeded by looking for success indicators
    if (output.includes('Authentication information') ||
        output.includes('token') ||
        output.includes('successfully')) {
      return { success: true };
    }
    return {
      success: false,
      error: 'No authentication data in response',
    };
  }

  const response = parseJsonResponse<BoundaryApiResponse<AuthResponseItem>>(jsonOutput);

  if (isErrorResponse(response)) {
    return {
      success: false,
      error: getErrorMessage(response),
    };
  }

  const item = response.item;
  if (!item) {
    // Response was OK but no item - might be OK for some auth methods
    if (response.status_code === 200 || response.status_code === undefined) {
      return { success: true };
    }
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
 * Parse auth methods list response
 */
interface AuthMethodResponseItem {
  id: string;
  scope_id: string;
  name: string;
  description?: string;
  type: 'oidc' | 'password' | 'ldap';
  is_primary: boolean;
  created_time?: string;
  updated_time?: string;
}

export function parseAuthMethodsResponse(output: string): BoundaryAuthMethod[] {
  const response = parseJsonResponse<BoundaryApiResponse<AuthMethodResponseItem>>(output);

  if (isErrorResponse(response)) {
    throw createErrorFromResponse(response);
  }

  const items = response.items || [];
  return items.map(item => ({
    id: item.id,
    scopeId: item.scope_id,
    name: item.name || getDefaultAuthMethodName(item.type),
    description: item.description,
    type: item.type,
    isPrimary: item.is_primary || false,
    createdTime: item.created_time ? new Date(item.created_time) : undefined,
    updatedTime: item.updated_time ? new Date(item.updated_time) : undefined,
  }));
}

/**
 * Get a friendly default name for auth methods without names
 */
function getDefaultAuthMethodName(type: string): string {
  switch (type) {
    case 'oidc':
      return 'Single Sign-On (OIDC)';
    case 'password':
      return 'Username & Password';
    case 'ldap':
      return 'LDAP';
    default:
      return type.toUpperCase();
  }
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
    throw createErrorFromResponse(response);
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
    throw createErrorFromResponse(response);
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
interface CredentialSourceItem {
  id: string;
  name?: string;
  description?: string;
  credential_store_id?: string;
  type?: string;
}

interface CredentialItem {
  username?: string;
  password?: string;
  private_key?: string;
  private_key_passphrase?: string;
}

interface BrokeredCredentialItem {
  credential_source: CredentialSourceItem;
  credential: CredentialItem;
}

interface SessionAuthResponseItem {
  session_id: string;
  target_id: string;
  authorization_token: string;
  endpoint: string;
  endpoint_port: number;
  expiration_time: string;
  credentials?: BrokeredCredentialItem[];
}

export function parseSessionAuthResponse(output: string): SessionAuthorization {
  const response = parseJsonResponse<BoundaryApiResponse<SessionAuthResponseItem>>(output);

  if (isErrorResponse(response)) {
    throw createErrorFromResponse(response);
  }

  const item = response.item;
  if (!item) {
    throw new BoundaryError(
      'No session authorization data in response',
      BoundaryErrorCode.PARSE_ERROR
    );
  }

  // Parse brokered credentials if present
  const credentials = item.credentials?.map(cred => ({
    credentialSource: {
      id: cred.credential_source.id,
      name: cred.credential_source.name,
      description: cred.credential_source.description,
      credentialStoreId: cred.credential_source.credential_store_id,
      type: cred.credential_source.type,
    },
    credential: {
      username: cred.credential.username,
      password: cred.credential.password,
      privateKey: cred.credential.private_key,
      privateKeyPassphrase: cred.credential.private_key_passphrase,
    },
  }));

  return {
    sessionId: item.session_id,
    authorizationToken: item.authorization_token,
    endpoint: item.endpoint,
    endpointPort: item.endpoint_port,
    expiration: new Date(item.expiration_time),
    credentials,
  };
}

/**
 * Extract local port from boundary connect output
 */
export function extractPort(output: string): number | undefined {
  const match = PORT_REGEX.exec(output);
  if (match) {
    // Try both capture groups (old format uses group 1, new format uses group 2)
    const portStr = match[1] || match[2];
    if (portStr) {
      const port = parseInt(portStr, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        return port;
      }
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
 * Check if response indicates authentication is required (401 Unauthorized)
 */
export function isAuthRequired(response: BoundaryApiResponse): boolean {
  const apiError = response.api_error || response.error;
  return response.status_code === 401 ||
         apiError?.kind === 'Unauthorized' ||
         apiError?.kind === 'Unauthenticated';
}

/**
 * Check if response indicates permission denied (403 Forbidden)
 */
export function isPermissionDenied(response: BoundaryApiResponse): boolean {
  const apiError = response.api_error || response.error;
  return response.status_code === 403 ||
         apiError?.kind === 'Forbidden' ||
         apiError?.kind === 'PermissionDenied';
}

/**
 * Check if response indicates token expired
 */
export function isTokenExpired(response: BoundaryApiResponse): boolean {
  const apiError = response.api_error || response.error;
  // Token expired can be indicated by:
  // - 401 with specific message about expiration
  // - SessionExpired kind
  if (apiError?.kind === 'SessionExpired' || apiError?.kind === 'TokenExpired') {
    return true;
  }
  // Check message for expiration indicators (only as fallback for structured data)
  const message = apiError?.message?.toLowerCase() || '';
  return message.includes('expired') || message.includes('expir');
}

/**
 * Classify API error response into BoundaryErrorCode
 * This is the authoritative source for error classification based on API response structure
 */
export function classifyApiError(response: BoundaryApiResponse): BoundaryErrorCode {
  // Check for auth-related errors first (most specific)
  if (isTokenExpired(response)) {
    return BoundaryErrorCode.TOKEN_EXPIRED;
  }
  if (isAuthRequired(response) || isPermissionDenied(response)) {
    return BoundaryErrorCode.AUTH_FAILED;
  }

  // Other error types based on status code
  if (response.status_code === 404) {
    return BoundaryErrorCode.TARGET_NOT_FOUND;
  }
  if (response.status_code >= 500) {
    return BoundaryErrorCode.CLI_EXECUTION_FAILED;
  }

  // Default
  return BoundaryErrorCode.CLI_EXECUTION_FAILED;
}

/**
 * Create a BoundaryError from an API error response
 * This ensures consistent error creation throughout the codebase
 */
export function createErrorFromResponse(response: BoundaryApiResponse): BoundaryError {
  const errorCode = classifyApiError(response);
  const message = getErrorMessage(response);

  return new BoundaryError(message, errorCode, response);
}
