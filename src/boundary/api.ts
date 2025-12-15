/**
 * Boundary HTTP API Client
 *
 * Direct API calls for faster query operations (scopes, targets, authorize-session).
 * CLI is still used for `boundary connect` which spawns the TCP proxy.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  BoundaryScope,
  BoundaryTarget,
  BoundaryAuthMethod,
  SessionAuthorization,
  BrokeredCredential,
  IConfigurationService,
} from '../types';
import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { logger } from '../utils/logger';
import { getConfigurationService } from '../utils/config';

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  items?: T[];
  item?: T;
  response_type?: string;
  list_token?: string;
  est_item_count?: number;
}

/**
 * Scope from API response
 */
interface ApiScope {
  id: string;
  scope_id?: string;
  name: string;
  description?: string;
  type?: string;
  scope?: {
    id: string;
    type: string;
    name?: string;
    parent_scope_id?: string;
  };
}

/**
 * Target from API response
 */
interface ApiTarget {
  id: string;
  scope_id: string;
  name: string;
  description?: string;
  type: string;
  address?: string;
  default_port?: number;
  session_max_seconds?: number;
  session_connection_limit?: number;
  authorized_actions?: string[];
  created_time?: string;
  updated_time?: string;
  scope?: {
    id: string;
    type: string;
    name?: string;
    description?: string;
    parent_scope_id?: string;
  };
}

/**
 * Auth method from API response
 */
interface ApiAuthMethod {
  id: string;
  scope_id: string;
  name: string;
  description?: string;
  type: string;
  is_primary?: boolean;
  created_time?: string;
  updated_time?: string;
}

/**
 * Session authorization response from API
 * Note: authorize-session returns the session object directly, not wrapped in "item"
 */
interface ApiSessionAuth {
  session_id: string;
  target_id: string;
  authorization_token: string;
  endpoint: string;
  endpoint_port?: number;
  expiration?: string;
  credentials?: Array<{
    credential_source?: {
      id: string;
      name?: string;
      description?: string;
      credential_store_id?: string;
      type?: string;
    };
    credential?: {
      username?: string;
      password?: string;
      private_key?: string;
      private_key_passphrase?: string;
      certificate?: string;
    };
    secret?: {
      decoded?: {
        data?: {
          username?: string;
          private_key?: string;
          certificate?: string;
          private_key_passphrase?: string;
        };
      };
    };
  }>;
}

export class BoundaryAPI {
  private readonly configService: IConfigurationService;
  private token: string | undefined;

  constructor(config?: IConfigurationService) {
    this.configService = config ?? getConfigurationService();
  }

  /**
   * Set the auth token for API requests
   */
  setToken(token: string | undefined): void {
    this.token = token;
  }

  /**
   * Get the configured Boundary address
   */
  private get boundaryAddr(): string {
    return this.configService.get('addr');
  }

  /**
   * Check if TLS verification should be skipped
   */
  private get tlsInsecure(): boolean {
    return this.configService.get('tlsInsecure');
  }

  /**
   * Make an HTTP request to the Boundary API
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    if (!this.token) {
      throw new BoundaryError(
        'Not authenticated. Please log in to Boundary.',
        BoundaryErrorCode.AUTH_FAILED
      );
    }

    const url = new URL(path, this.boundaryAddr);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    };

    if (isHttps && this.tlsInsecure) {
      options.rejectUnauthorized = false;
    }

    return new Promise<T>((resolve, reject) => {
      const req = httpModule.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new BoundaryError(
                'Authentication failed. Please log in again.',
                BoundaryErrorCode.AUTH_FAILED
              ));
              return;
            }

            if (res.statusCode && res.statusCode >= 400) {
              const errorBody = data ? JSON.parse(data) as { message?: string; error?: string } : {};
              const message = errorBody.message ?? errorBody.error ?? `API error: ${res.statusCode}`;
              reject(new BoundaryError(message, BoundaryErrorCode.CLI_EXECUTION_FAILED));
              return;
            }

            const parsed = data ? JSON.parse(data) as T : {} as T;
            resolve(parsed);
          } catch (err) {
            reject(new BoundaryError(
              `Failed to parse API response: ${err instanceof Error ? err.message : String(err)}`,
              BoundaryErrorCode.CLI_EXECUTION_FAILED
            ));
          }
        });
      });

      req.on('error', (err) => {
        logger.error('API request error:', err);
        reject(new BoundaryError(
          `API request failed: ${err.message}`,
          BoundaryErrorCode.CLI_NOT_FOUND
        ));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new BoundaryError('API request timed out', BoundaryErrorCode.CLI_EXECUTION_FAILED));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * List scopes from a parent scope
   */
  async listScopes(parentScopeId: string = 'global'): Promise<BoundaryScope[]> {
    logger.debug(`API: Listing scopes from ${parentScopeId}`);
    const startTime = Date.now();

    try {
      const response = await this.request<ApiResponse<ApiScope>>(
        'GET',
        `/v1/scopes?scope_id=${encodeURIComponent(parentScopeId)}`
      );

      const scopes = (response.items || []).map(this.mapApiScope);
      logger.debug(`API: Listed ${scopes.length} scopes in ${Date.now() - startTime}ms`);
      return scopes;
    } catch (err) {
      logger.error(`API: Failed to list scopes from ${parentScopeId}:`, err);
      throw err;
    }
  }

  /**
   * List targets, optionally filtered by scope
   */
  async listTargets(scopeId?: string, recursive: boolean = false): Promise<BoundaryTarget[]> {
    logger.debug(`API: Listing targets from scope=${scopeId || 'all'}, recursive=${recursive}`);
    const startTime = Date.now();

    try {
      let path = '/v1/targets';
      const params: string[] = [];

      if (scopeId) {
        params.push(`scope_id=${encodeURIComponent(scopeId)}`);
      }
      if (recursive) {
        params.push('recursive=true');
      }

      if (params.length > 0) {
        path += '?' + params.join('&');
      }

      const response = await this.request<ApiResponse<ApiTarget>>('GET', path);

      const targets = (response.items || []).map(this.mapApiTarget);
      logger.debug(`API: Listed ${targets.length} targets in ${Date.now() - startTime}ms`);
      return targets;
    } catch (err) {
      logger.error(`API: Failed to list targets:`, err);
      throw err;
    }
  }

  /**
   * List auth methods for a scope
   */
  async listAuthMethods(scopeId: string = 'global'): Promise<BoundaryAuthMethod[]> {
    logger.debug(`API: Listing auth methods from ${scopeId}`);
    const startTime = Date.now();

    try {
      const response = await this.request<ApiResponse<ApiAuthMethod>>(
        'GET',
        `/v1/auth-methods?scope_id=${encodeURIComponent(scopeId)}`
      );

      const authMethods = (response.items || []).map(this.mapApiAuthMethod);
      logger.debug(`API: Listed ${authMethods.length} auth methods in ${Date.now() - startTime}ms`);
      return authMethods;
    } catch (err) {
      logger.error(`API: Failed to list auth methods:`, err);
      throw err;
    }
  }

  /**
   * Authorize a session for a target
   */
  async authorizeSession(targetId: string): Promise<SessionAuthorization> {
    logger.debug(`API: Authorizing session for target ${targetId}`);
    const startTime = Date.now();

    try {
      // authorize-session returns session data directly, not wrapped in "item"
      const response = await this.request<ApiSessionAuth>(
        'POST',
        `/v1/targets/${encodeURIComponent(targetId)}:authorize-session`,
        {} // Empty body - target ID is in URL
      );

      if (!response.session_id) {
        throw new BoundaryError('Invalid authorize-session response: missing session_id', BoundaryErrorCode.CLI_EXECUTION_FAILED);
      }

      const sessionAuth: SessionAuthorization = {
        sessionId: response.session_id,
        authorizationToken: response.authorization_token,
        endpoint: response.endpoint,
        endpointPort: response.endpoint_port || 0,
        expiration: response.expiration ? new Date(response.expiration) : new Date(),
        credentials: this.mapCredentials(response.credentials),
      };

      logger.debug(`API: Authorized session ${response.session_id} in ${Date.now() - startTime}ms`);
      return sessionAuth;
    } catch (err) {
      logger.error(`API: Failed to authorize session:`, err);
      throw err;
    }
  }

  /**
   * Map API scope to internal type
   */
  private mapApiScope = (apiScope: ApiScope): BoundaryScope => {
    // Determine scope type from parent or nested scope info
    let scopeType: 'global' | 'org' | 'project' = 'project';
    if (apiScope.scope?.type === 'global') {
      scopeType = 'org';
    } else if (apiScope.id === 'global') {
      scopeType = 'global';
    }

    return {
      id: apiScope.id,
      type: scopeType,
      name: apiScope.name || apiScope.id,
      description: apiScope.description,
      parentScopeId: apiScope.scope_id || apiScope.scope?.id,
    };
  };

  /**
   * Map API target to internal type
   */
  private mapApiTarget = (apiTarget: ApiTarget): BoundaryTarget => {
    return {
      id: apiTarget.id,
      scopeId: apiTarget.scope_id,
      name: apiTarget.name || apiTarget.id,
      description: apiTarget.description,
      type: (apiTarget.type as 'tcp' | 'ssh' | 'rdp') || 'tcp',
      address: apiTarget.address,
      defaultPort: apiTarget.default_port,
      sessionMaxSeconds: apiTarget.session_max_seconds,
      sessionConnectionLimit: apiTarget.session_connection_limit,
      authorizedActions: apiTarget.authorized_actions || [],
      createdTime: apiTarget.created_time ? new Date(apiTarget.created_time) : undefined,
      updatedTime: apiTarget.updated_time ? new Date(apiTarget.updated_time) : undefined,
      scope: {
        id: apiTarget.scope?.id || apiTarget.scope_id,
        type: (apiTarget.scope?.type as 'global' | 'org' | 'project') || 'project',
        name: apiTarget.scope?.name || '',
        description: apiTarget.scope?.description,
        parentScopeId: apiTarget.scope?.parent_scope_id,
      },
    };
  };

  /**
   * Map API auth method to internal type
   */
  private mapApiAuthMethod = (apiMethod: ApiAuthMethod): BoundaryAuthMethod => {
    return {
      id: apiMethod.id,
      scopeId: apiMethod.scope_id,
      name: apiMethod.name || apiMethod.id,
      description: apiMethod.description,
      type: apiMethod.type as 'oidc' | 'password' | 'ldap',
      isPrimary: apiMethod.is_primary || false,
      createdTime: apiMethod.created_time ? new Date(apiMethod.created_time) : undefined,
      updatedTime: apiMethod.updated_time ? new Date(apiMethod.updated_time) : undefined,
    };
  };

  /**
   * Map API credentials to internal type
   */
  private mapCredentials(apiCredentials?: ApiSessionAuth['credentials']): BrokeredCredential[] | undefined {
    if (!apiCredentials || apiCredentials.length === 0) {
      return undefined;
    }

    return apiCredentials.map(cred => {
      // Handle both direct credential and vault secret structures
      const credentialData = cred.credential || cred.secret?.decoded?.data;

      return {
        credentialSource: {
          id: cred.credential_source?.id || '',
          name: cred.credential_source?.name,
          description: cred.credential_source?.description,
          credentialStoreId: cred.credential_source?.credential_store_id,
          type: cred.credential_source?.type,
        },
        credential: {
          username: credentialData?.username,
          password: (cred.credential as { password?: string })?.password,
          privateKey: credentialData?.private_key,
          privateKeyPassphrase: credentialData?.private_key_passphrase,
          certificate: credentialData?.certificate,
        },
      };
    });
  }
}
