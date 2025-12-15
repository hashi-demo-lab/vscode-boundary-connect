/**
 * Boundary CLI output parser utilities
 *
 * Uses Zod for runtime validation of CLI responses to catch
 * malformed or unexpected output early.
 */

import { z } from 'zod';
import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { AuthResult, BoundaryAuthMethod, BoundaryScope, BoundaryTarget, SessionAuthorization } from '../types';
import { logger } from '../utils/logger';

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

/**
 * API error schema (appears in both 'error' and 'api_error' fields)
 */
const ApiErrorSchema = z.object({
  kind: z.string(),
  message: z.string(),
}).optional();

/**
 * Base API response schema - all Boundary CLI responses follow this pattern
 */
const BaseApiResponseSchema = z.object({
  status_code: z.number().optional(),
  status: z.string().optional(),
  context: z.string().optional(),
  error: ApiErrorSchema,
  api_error: ApiErrorSchema,
});

/**
 * Auth method response schema
 */
const AuthMethodItemSchema = z.object({
  id: z.string(),
  scope_id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['oidc', 'password', 'ldap']),
  is_primary: z.boolean().optional().default(false),
  created_time: z.string().optional(),
  updated_time: z.string().optional(),
});

const AuthMethodsResponseSchema = BaseApiResponseSchema.extend({
  items: z.array(AuthMethodItemSchema).optional().default([]),
});

/**
 * Scope response schema
 */
const ScopeItemSchema = z.object({
  id: z.string(),
  scope_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['global', 'org', 'project']),
});

const ScopesResponseSchema = BaseApiResponseSchema.extend({
  items: z.array(ScopeItemSchema).optional().default([]),
});

/**
 * Target response schema
 */
const TargetScopeSchema = z.object({
  id: z.string(),
  type: z.enum(['global', 'org', 'project']),
  name: z.string(),
  description: z.string().optional(),
  parent_scope_id: z.string().optional(),
});

const TargetItemSchema = z.object({
  id: z.string(),
  scope_id: z.string(),
  scope: TargetScopeSchema,
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['tcp', 'ssh', 'rdp']),
  attributes: z.object({
    default_port: z.number().optional(),
  }).optional(),
  session_max_seconds: z.number().optional(),
  session_connection_limit: z.number().optional(),
  authorized_actions: z.array(z.string()).optional().default([]),
  created_time: z.string().optional(),
  updated_time: z.string().optional(),
});

const TargetsResponseSchema = BaseApiResponseSchema.extend({
  items: z.array(TargetItemSchema).optional().default([]),
});

/**
 * Session authorization response schema
 */
const CredentialSourceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  credential_store_id: z.string().optional(),
  type: z.string().optional(),
});

const CredentialSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  private_key: z.string().optional(),
  private_key_passphrase: z.string().optional(),
});

// Vault-generic credentials use secret.decoded.data structure
const VaultSecretDataSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  private_key: z.string().optional(),
  private_key_passphrase: z.string().optional(),
  certificate: z.string().optional(),
  public_key: z.string().optional(),
}).passthrough(); // Allow additional fields

const VaultSecretSchema = z.object({
  raw: z.string().optional(),
  decoded: z.object({
    data: VaultSecretDataSchema.optional(),
  }).optional(),
}).optional();

const BrokeredCredentialSchema = z.object({
  credential_source: CredentialSourceSchema,
  // Static credentials
  credential: CredentialSchema.optional(),
  // Vault-generic credentials
  secret: VaultSecretSchema,
});

const SessionAuthItemSchema = z.object({
  session_id: z.string(),
  target_id: z.string().optional(),
  authorization_token: z.string(),
  endpoint: z.string(),
  endpoint_port: z.number(),
  expiration: z.string(),
  credentials: z.array(BrokeredCredentialSchema).optional(),
});

const SessionAuthResponseSchema = BaseApiResponseSchema.extend({
  item: SessionAuthItemSchema.optional(),
});

/**
 * Safely parse JSON with validation using a Zod schema
 */
function safeParseJson<T extends z.ZodTypeAny>(
  output: string,
  schema: T,
  context: string
): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch (error) {
    throw new BoundaryError(
      `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
      BoundaryErrorCode.PARSE_ERROR,
      { output: output.substring(0, 500) } // Truncate for logging
    );
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    logger.warn(`Zod validation failed for ${context}:`, result.error.format());
    // Log but don't fail - fall back to loose parsing for backwards compatibility
    // This allows the extension to work with newer CLI versions that add fields
    return json as z.infer<T>;
  }

  return result.data;
}

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
  status_code?: number;
  status?: string;
  context?: string;
  item?: T;
  items?: T[];
  // Error can be structured object or simple string
  error?: {
    kind: string;
    message: string;
  } | string;
  // Some API responses use api_error instead of error
  api_error?: {
    kind: string;
    message: string;
  };
}

export function isErrorResponse(response: BoundaryApiResponse): boolean {
  const statusCode = response.status_code ?? 200;
  return statusCode >= 400 || response.error !== undefined || response.api_error !== undefined;
}

export function getErrorMessage(response: BoundaryApiResponse): string {
  const apiError = response.api_error || response.error;

  // Handle structured error object: { kind: string, message: string }
  if (apiError && typeof apiError === 'object' && 'message' in apiError) {
    return apiError.message;
  }

  // Handle string error (e.g., {"error": "Error trying to list targets: ..."})
  if (typeof apiError === 'string') {
    return apiError;
  }

  // Handle context field
  if (response.context) {
    return response.context;
  }

  // Handle status field
  if (response.status) {
    return response.status;
  }

  return `Request failed with status ${response.status_code ?? 'unknown'}`;
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
  expiration: string;
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
    expirationTime: item.expiration ? new Date(item.expiration) : undefined,
  };
}

/**
 * Parse auth methods list response
 *
 * Note: Legacy interface kept for documentation. CLI responses are now validated by Zod schemas.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _AuthMethodResponseItem {
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
  const response = safeParseJson(output, AuthMethodsResponseSchema, 'authMethods');

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
 *
 * Note: Legacy interface kept for documentation. CLI responses are now validated by Zod schemas.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _ScopeResponseItem {
  id: string;
  scope_id: string;
  name: string;
  description?: string;
  type: 'global' | 'org' | 'project';
}

export function parseScopesResponse(output: string): BoundaryScope[] {
  const response = safeParseJson(output, ScopesResponseSchema, 'scopes');

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
 *
 * Note: Legacy interface kept for documentation. CLI responses are now validated by Zod schemas.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _TargetResponseItem {
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
  const response = safeParseJson(output, TargetsResponseSchema, 'targets');

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

/**
 * Note: Legacy interface kept for documentation. CLI responses are now validated by Zod schemas.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _SessionAuthResponseItem {
  session_id: string;
  target_id: string;
  authorization_token: string;
  endpoint: string;
  endpoint_port: number;
  expiration: string;
  credentials?: BrokeredCredentialItem[];
}

export function parseSessionAuthResponse(output: string): SessionAuthorization {
  const response = safeParseJson(output, SessionAuthResponseSchema, 'sessionAuth');

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
  // Handle both static credentials (credential field) and Vault-generic credentials (secret.decoded.data)
  const credentials = item.credentials?.map(cred => {
    // Try to get credentials from either source
    const staticCred = cred.credential;
    const vaultCred = cred.secret?.decoded?.data;

    // Prefer Vault credentials if available, fall back to static
    const username = vaultCred?.username || staticCred?.username;
    const password = vaultCred?.password || staticCred?.password;
    const privateKey = vaultCred?.private_key || staticCred?.private_key;
    const privateKeyPassphrase = vaultCred?.private_key_passphrase || staticCred?.private_key_passphrase;

    return {
      credentialSource: {
        id: cred.credential_source.id,
        name: cred.credential_source.name,
        description: cred.credential_source.description,
        credentialStoreId: cred.credential_source.credential_store_id,
        type: cred.credential_source.type,
      },
      credential: {
        username,
        password,
        privateKey,
        privateKeyPassphrase,
      },
    };
  });

  return {
    sessionId: item.session_id,
    authorizationToken: item.authorization_token,
    endpoint: item.endpoint,
    endpointPort: item.endpoint_port,
    expiration: new Date(item.expiration),
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
 * Helper to get error kind from potentially string or object error
 */
function getErrorKind(apiError: BoundaryApiResponse['error'] | BoundaryApiResponse['api_error']): string | undefined {
  if (apiError && typeof apiError === 'object' && 'kind' in apiError) {
    return apiError.kind;
  }
  return undefined;
}

/**
 * Helper to get error message text from potentially string or object error
 */
function getErrorText(apiError: BoundaryApiResponse['error'] | BoundaryApiResponse['api_error']): string {
  if (typeof apiError === 'string') {
    return apiError.toLowerCase();
  }
  if (apiError && typeof apiError === 'object' && 'message' in apiError) {
    return apiError.message.toLowerCase();
  }
  return '';
}

/**
 * Check if response indicates authentication is required (401 Unauthorized)
 */
export function isAuthRequired(response: BoundaryApiResponse): boolean {
  const apiError = response.api_error || response.error;
  const kind = getErrorKind(apiError);
  const text = getErrorText(apiError);

  return response.status_code === 401 ||
         kind === 'Unauthorized' ||
         kind === 'Unauthenticated' ||
         text.includes('unauthorized') ||
         text.includes('unauthenticated');
}

/**
 * Check if response indicates permission denied (403 Forbidden)
 */
export function isPermissionDenied(response: BoundaryApiResponse): boolean {
  const apiError = response.api_error || response.error;
  const kind = getErrorKind(apiError);
  const text = getErrorText(apiError);

  return response.status_code === 403 ||
         kind === 'Forbidden' ||
         kind === 'PermissionDenied' ||
         text.includes('permission denied') ||
         text.includes('forbidden');
}

/**
 * Check if response indicates token expired
 */
export function isTokenExpired(response: BoundaryApiResponse): boolean {
  const apiError = response.api_error || response.error;
  const kind = getErrorKind(apiError);
  const text = getErrorText(apiError);

  // Token expired can be indicated by:
  // - SessionExpired/TokenExpired kind
  // - Message containing "expired"
  return kind === 'SessionExpired' ||
         kind === 'TokenExpired' ||
         text.includes('expired') ||
         text.includes('session has ended');
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
  // Note: Only authentication errors (401) require re-auth
  // Permission denied (403) means authenticated but not authorized - re-auth won't help
  if (isAuthRequired(response)) {
    return BoundaryErrorCode.AUTH_FAILED;
  }

  // Other error types based on status code
  const statusCode = response.status_code ?? 200;
  if (statusCode === 404) {
    return BoundaryErrorCode.TARGET_NOT_FOUND;
  }
  if (statusCode === 403) {
    // Permission denied - user is authenticated but lacks permission
    return BoundaryErrorCode.CLI_EXECUTION_FAILED;
  }
  if (statusCode >= 500) {
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
