/**
 * Boundary CLI wrapper
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess, execFile } from 'child_process';
import { promisify } from 'util';
import {
  AuthMethod,
  AuthResult,
  BoundaryAuthMethod,
  BoundaryScope,
  BoundaryTarget,
  CLIExecutionResult,
  Connection,
  ConnectOptions,
  Credentials,
  IBoundaryCLI,
  PasswordCredentials,
  SessionAuthorization,
  TokenResult,
} from '../types';
import { generateConnectionId } from '../utils/id';
import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { logger } from '../utils/logger';
import { getConfigurationService } from '../utils/config';
import { IConfigurationService } from '../types';
import {
  extractPort,
  extractVersion,
  parseAuthMethodsResponse,
  parseAuthResponse,
  parseScopesResponse,
  parseSessionAuthResponse,
  parseTargetsResponse,
} from './parser';

const execFileAsync = promisify(execFile);

const CONNECT_TIMEOUT_MS = 30000; // 30 seconds to capture port

// Common installation paths for Boundary CLI (absolute paths first for reliability)
const COMMON_CLI_PATHS = [
  '/opt/homebrew/bin/boundary', // macOS Homebrew (Apple Silicon)
  '/usr/local/bin/boundary', // macOS Homebrew (Intel) / Linux
  '/usr/bin/boundary', // Linux system
  '/snap/bin/boundary', // Linux snap
  'boundary', // PATH lookup (last resort)
];

export class BoundaryCLI implements IBoundaryCLI {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private resolvedCliPath: string | undefined;
  private cliPathResolved = false;
  private cliPathResolutionFailed = false;
  private configChangeSubscription: vscode.Disposable | undefined;
  private readonly configService: IConfigurationService;

  /**
   * Create a new BoundaryCLI instance
   * @param config - Configuration service (optional for backward compatibility)
   */
  constructor(config?: IConfigurationService) {
    // Use provided config or fall back to singleton for backward compatibility
    this.configService = config ?? getConfigurationService();

    // Listen for config changes to reset CLI path resolution
    this.configChangeSubscription = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('boundary.cliPath')) {
        logger.info('CLI path configuration changed, resetting resolution');
        this.cliPathResolved = false;
        this.cliPathResolutionFailed = false;
        this.resolvedCliPath = undefined;
      }
    });
  }

  private get cliPath(): string {
    const configuredPath = this.configService.get('cliPath');
    // If user configured a specific non-default path, use it
    if (configuredPath && configuredPath !== 'boundary') {
      return configuredPath;
    }
    // Use resolved path if we found one, otherwise fall back to configured
    return this.resolvedCliPath || configuredPath;
  }

  /**
   * Find the Boundary CLI in common installation paths
   * Tries absolute paths first since VS Code may not have the same PATH as terminal
   */
  private async findCliPath(): Promise<string | undefined> {
    for (const cliPath of COMMON_CLI_PATHS) {
      try {
        logger.debug(`Checking for Boundary CLI at: ${cliPath}`);
        await execFileAsync(cliPath, ['version'], { timeout: 5000 });
        logger.info(`Found Boundary CLI at: ${cliPath}`);
        return cliPath;
      } catch (err) {
        logger.debug(`CLI not found at ${cliPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return undefined;
  }

  /**
   * Ensure CLI path is resolved before use
   * Always tries to verify the path works, falls back to auto-discovery
   *
   * IMPORTANT: Only marks as resolved if we actually found a working CLI path.
   * This allows retry on subsequent calls if the first attempt failed (e.g.,
   * if PATH wasn't fully loaded during extension activation).
   */
  private async ensureCliPath(): Promise<void> {
    // Only skip if we successfully resolved a path before
    // If resolution failed previously, allow retry (user may have installed CLI)
    if (this.cliPathResolved && !this.cliPathResolutionFailed) {
      return;
    }

    // Reset failure flag for retry attempt
    this.cliPathResolutionFailed = false;

    const configuredPath = this.configService.get('cliPath');
    logger.debug(`Configured CLI path: ${configuredPath}`);

    // If user set a custom path, verify it works first
    if (configuredPath && configuredPath !== 'boundary') {
      try {
        logger.debug(`Verifying configured path: ${configuredPath}`);
        await execFileAsync(configuredPath, ['version'], { timeout: 5000 });
        logger.info(`Using configured CLI path: ${configuredPath}`);
        this.cliPathResolved = true;
        this.cliPathResolutionFailed = false;
        return;
      } catch (err) {
        logger.warn(`Configured CLI path '${configuredPath}' not found, trying auto-discovery...`);
      }
    }

    // Try to find CLI in common paths (auto-discovery)
    const foundPath = await this.findCliPath();
    if (foundPath) {
      this.resolvedCliPath = foundPath;
      this.cliPathResolved = true;
      this.cliPathResolutionFailed = false;
      logger.info(`Auto-discovered CLI at: ${foundPath}`);
    } else {
      logger.warn('CLI not found in any common paths');
      // Mark as resolved but failed - allows retry on next call
      this.cliPathResolved = true;
      this.cliPathResolutionFailed = true;
    }
  }

  /**
   * Get environment variables for CLI execution
   */
  private getCliEnv(): NodeJS.ProcessEnv {
    const config = this.configService.getConfiguration();
    const env = { ...process.env };

    // Set BOUNDARY_ADDR if configured
    if (config.addr) {
      env.BOUNDARY_ADDR = config.addr;
    }

    // Set TLS insecure mode if configured
    if (config.tlsInsecure) {
      env.BOUNDARY_TLS_INSECURE = 'true';
    }

    return env;
  }

  /**
   * Get keyring type args
   */
  private getKeyringArgs(): string[] {
    const keyringType = this.configService.get('keyringType');
    return keyringType === 'none' ? ['-keyring-type', 'none'] : [];
  }

  async checkInstalled(): Promise<boolean> {
    // Ensure we've resolved the CLI path first
    logger.info('Resolving CLI path...');
    await this.ensureCliPath();
    logger.info(`CLI path resolved to: ${this.cliPath}`);

    // Now try to execute with the resolved path
    try {
      const result = await this.execute(['version'], 10000); // 10s timeout for version check
      logger.info(`CLI version check succeeded: ${result.stdout.substring(0, 100)}`);
      return true;
    } catch (err) {
      logger.error('CLI check failed:', err);
      return false;
    }
  }

  async getVersion(): Promise<string | undefined> {
    try {
      const result = await this.execute(['version']);
      return extractVersion(result.stdout);
    } catch (error) {
      logger.debug('Failed to get CLI version:', error);
      return undefined;
    }
  }

  async authenticate(method: AuthMethod, credentials?: Credentials): Promise<AuthResult> {
    // Note: OIDC auth doesn't support -format json well - it outputs text
    // Only use -format json for password auth where we need to parse the response
    const useJsonFormat = method === 'password';
    const args = ['authenticate', method, ...(useJsonFormat ? ['-format', 'json'] : []), ...this.getKeyringArgs()];

    if (method === 'password' && credentials) {
      const pwdCreds = credentials as PasswordCredentials;
      args.push('-auth-method-id', pwdCreds.authMethodId);
      args.push('-login-name', pwdCreds.loginName);
      // Password is passed via environment variable to avoid exposure in process listings
      // Boundary CLI supports BOUNDARY_AUTHENTICATE_PASSWORD_PASSWORD env var
      try {
        const result = await this.executeWithPassword(args, pwdCreds.password);
        return parseAuthResponse(result.stdout);
      } catch (error) {
        if (error instanceof BoundaryError) {
          return { success: false, error: error.message };
        }
        return { success: false, error: String(error) };
      }
    } else if (method === 'oidc') {
      // Only add auth method ID if provided (some servers auto-select primary)
      const oidcCreds = credentials as { authMethodId?: string } | undefined;
      if (oidcCreds?.authMethodId) {
        args.push('-auth-method-id', oidcCreds.authMethodId);
      }
    }

    // OIDC auth needs longer timeout (5 min) since it waits for browser interaction
    const timeout = method === 'oidc' ? 300000 : 30000;

    const env = this.getCliEnv();
    logger.info(`Executing authenticate: ${method}`);
    logger.info(`CLI args: ${args.join(' ')}`);
    logger.info(`BOUNDARY_ADDR: ${env.BOUNDARY_ADDR || '(not set)'}`);
    logger.info(`BOUNDARY_TLS_INSECURE: ${env.BOUNDARY_TLS_INSECURE || '(not set)'}`);

    try {
      const result = await this.execute(args, timeout);
      logger.info('Auth command completed successfully');
      logger.debug('Auth result stdout:', result.stdout.substring(0, 500));
      return parseAuthResponse(result.stdout);
    } catch (error) {
      logger.error('Auth error:', error);
      if (error instanceof BoundaryError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execute a Boundary CLI command with password passed securely via env var
   * This prevents password exposure in process listings (ps aux, etc.)
   */
  private async executeWithPassword(args: string[], password: string, timeoutMs = 30000): Promise<CLIExecutionResult> {
    const cliPath = this.cliPath;
    const baseEnv = this.getCliEnv();
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      BOUNDARY_AUTHENTICATE_PASSWORD_PASSWORD: password,
    };

    // Add the password flag to args
    const fullArgs = [...args, '-password', 'env://BOUNDARY_AUTHENTICATE_PASSWORD_PASSWORD'];

    logger.debug(`Executing (with password via env): ${cliPath} ${args.join(' ')} -password env://...`);
    logger.debug(`Environment: BOUNDARY_ADDR=${baseEnv.BOUNDARY_ADDR || ''}, BOUNDARY_TLS_INSECURE=${baseEnv.BOUNDARY_TLS_INSECURE || ''}`);

    try {
      const { stdout, stderr } = await execFileAsync(cliPath, fullArgs, {
        env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error) {
        const execError = error as { code: number | string; stdout?: string; stderr?: string; message: string };

        if (execError.code === 127 || execError.code === 'ENOENT' ||
            (execError.stderr && execError.stderr.includes('not found'))) {
          throw new BoundaryError(
            'Boundary CLI not found',
            BoundaryErrorCode.CLI_NOT_FOUND
          );
        }

        if (execError.stdout) {
          return {
            stdout: execError.stdout,
            stderr: execError.stderr || '',
            exitCode: typeof execError.code === 'number' ? execError.code : 1,
          };
        }

        // Try to parse JSON error from stderr and classify appropriately
        const errorSource = execError.stderr || execError.message;
        const errorInfo = this.extractErrorInfo(errorSource);

        throw new BoundaryError(
          errorInfo.message,
          errorInfo.code,
          error
        );
      }

      throw new BoundaryError(
        String(error),
        BoundaryErrorCode.CLI_EXECUTION_FAILED,
        error
      );
    }
  }

  async getToken(): Promise<TokenResult> {
    try {
      const result = await this.execute(['config', 'get-token', ...this.getKeyringArgs()]);
      const token = result.stdout.trim();
      if (token) {
        return { status: 'found', token };
      }
      return { status: 'not_found' };
    } catch (error) {
      // Distinguish CLI errors from "no token" - critical for first-install UX
      if (error instanceof BoundaryError && error.code === BoundaryErrorCode.CLI_NOT_FOUND) {
        logger.warn('Cannot check token: Boundary CLI not found');
        return { status: 'cli_error', error: 'Boundary CLI not found. Please install it.' };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to retrieve token from CLI keyring:', error);
      return { status: 'cli_error', error: errorMessage };
    }
  }

  /**
   * List auth methods from a specific scope
   */
  private async listAuthMethodsFromScope(scopeId: string): Promise<BoundaryAuthMethod[]> {
    const args = ['auth-methods', 'list', '-format', 'json', '-scope-id', scopeId, ...this.getKeyringArgs()];
    logger.debug(`listAuthMethodsFromScope: scopeId=${scopeId}`);

    try {
      const result = await this.execute(args, 10000);
      return parseAuthMethodsResponse(result.stdout);
    } catch (err) {
      logger.debug(`No auth methods in scope ${scopeId}:`, err);
      return [];
    }
  }

  /**
   * Discover all auth methods from global and all org scopes
   * If scopeId is provided, lists from that scope only (for testing/advanced use)
   * Otherwise, auto-discovers from all available scopes
   */
  async listAuthMethods(scopeId?: string): Promise<BoundaryAuthMethod[]> {
    // If specific scope provided, use it directly (for backward compatibility and testing)
    if (scopeId) {
      return this.listAuthMethodsFromScope(scopeId);
    }

    const env = this.getCliEnv();
    logger.info(`Discovering auth methods from BOUNDARY_ADDR=${env.BOUNDARY_ADDR || '(not set)'}`);

    const allAuthMethods: BoundaryAuthMethod[] = [];

    // First, get auth methods from global scope
    const globalMethods = await this.listAuthMethodsFromScope('global');
    allAuthMethods.push(...globalMethods);
    logger.info(`Found ${globalMethods.length} auth methods in global scope`);

    // Then, discover org scopes and get their auth methods
    try {
      const orgScopes = await this.listScopes('global');
      logger.info(`Found ${orgScopes.length} org scopes to search`);

      for (const org of orgScopes) {
        const orgMethods = await this.listAuthMethodsFromScope(org.id);
        allAuthMethods.push(...orgMethods);
        if (orgMethods.length > 0) {
          logger.info(`Found ${orgMethods.length} auth methods in org "${org.name}" (${org.id})`);
        }
      }
    } catch (err) {
      logger.warn('Failed to list org scopes:', err);
    }

    logger.info(`Total auth methods discovered: ${allAuthMethods.length}`);
    return allAuthMethods;
  }

  async listScopes(parentScopeId?: string): Promise<BoundaryScope[]> {
    const args = ['scopes', 'list', '-format', 'json', ...this.getKeyringArgs()];
    if (parentScopeId) {
      args.push('-scope-id', parentScopeId);
    }

    const result = await this.execute(args);
    return parseScopesResponse(result.stdout);
  }

  /**
   * List targets from a specific scope
   */
  private async listTargetsFromScope(scopeId: string, recursive = true): Promise<BoundaryTarget[]> {
    const args = ['targets', 'list', '-format', 'json', ...this.getKeyringArgs()];
    args.push('-scope-id', scopeId);
    if (recursive) {
      args.push('-recursive');
    }

    try {
      const result = await this.execute(args);
      return parseTargetsResponse(result.stdout);
    } catch (err) {
      logger.debug(`No targets accessible from scope ${scopeId}:`, err);
      return [];
    }
  }

  /**
   * Discover all targets the user has access to
   * If scopeId is provided, lists from that scope only (for testing/advanced use)
   * Otherwise, searches global, orgs, and projects for accessible targets
   */
  async listTargets(scopeId?: string): Promise<BoundaryTarget[]> {
    // If specific scope provided, use it directly (for backward compatibility and testing)
    if (scopeId) {
      return this.listTargetsFromScope(scopeId, true);
    }

    logger.info('Discovering all accessible targets...');
    const allTargets: BoundaryTarget[] = [];
    const seenIds = new Set<string>();

    // Helper to add targets without duplicates
    const addTargets = (targets: BoundaryTarget[]) => {
      for (const target of targets) {
        if (!seenIds.has(target.id)) {
          seenIds.add(target.id);
          allTargets.push(target);
        }
      }
    };

    // Try global scope first (works if user has broad permissions)
    const globalTargets = await this.listTargetsFromScope('global', true);
    addTargets(globalTargets);
    if (globalTargets.length > 0) {
      logger.info(`Found ${globalTargets.length} targets from global scope`);
    }

    // Discover org and project scopes and try each
    try {
      const orgScopes = await this.listScopes('global');
      logger.info(`Searching ${orgScopes.length} org scopes for targets...`);

      for (const org of orgScopes) {
        // Try org scope
        const orgTargets = await this.listTargetsFromScope(org.id, true);
        addTargets(orgTargets);
        if (orgTargets.length > 0) {
          logger.info(`Found ${orgTargets.length} targets in org "${org.name}"`);
        }

        // Try project scopes within org
        try {
          const projectScopes = await this.listScopes(org.id);
          for (const project of projectScopes) {
            const projectTargets = await this.listTargetsFromScope(project.id, false);
            addTargets(projectTargets);
            if (projectTargets.length > 0) {
              logger.info(`Found ${projectTargets.length} targets in project "${project.name}"`);
            }
          }
        } catch {
          // Skip if can't list projects
        }
      }
    } catch (err) {
      logger.warn('Failed to discover scopes:', err);
    }

    logger.info(`Total targets discovered: ${allTargets.length}`);
    return allTargets;
  }

  async authorizeSession(targetId: string): Promise<SessionAuthorization> {
    const args = ['targets', 'authorize-session', '-id', targetId, '-format', 'json', ...this.getKeyringArgs()];
    const result = await this.execute(args);
    return parseSessionAuthResponse(result.stdout);
  }

  async connect(targetId: string, options: ConnectOptions = {}): Promise<Connection> {
    // Ensure CLI path is resolved before spawning process
    await this.ensureCliPath();

    // Always use 'boundary connect' (TCP proxy mode) for all target types
    // This creates a persistent local proxy that VS Code Remote SSH can connect to
    // The 'boundary connect ssh' subcommand auto-launches SSH which we don't want
    const args = ['connect', '-target-id', targetId];

    if (options.listenPort !== undefined) {
      args.push('-listen-port', String(options.listenPort));
    } else {
      args.push('-listen-port', '0'); // Auto-assign port
    }

    if (options.listenAddr) {
      args.push('-listen-addr', options.listenAddr);
    }

    if (options.authzToken) {
      args.push('-authz-token', options.authzToken);
    }

    return new Promise((resolve, reject) => {
      const sessionId = generateConnectionId();
      logger.info(`Starting boundary connect for target ${targetId}`);

      const child = spawn(this.cliPath, args, {
        env: this.getCliEnv(),
      });

      this.activeProcesses.set(sessionId, child);

      let stdout = '';
      let stderr = '';
      let port: number | undefined;
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          this.activeProcesses.delete(sessionId);
          reject(new BoundaryError(
            'Timeout waiting for proxy port',
            BoundaryErrorCode.PORT_CAPTURE_FAILED
          ));
        }
      }, CONNECT_TIMEOUT_MS);

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        logger.debug('boundary connect stdout:', chunk);

        // Try to capture port
        if (!port) {
          port = extractPort(stdout);
          if (port && !resolved) {
            resolved = true;
            clearTimeout(timeout);

            const connection: Connection = {
              sessionId,
              targetId,
              targetName: targetId, // Will be updated by caller
              localHost: '127.0.0.1',
              localPort: port,
              process: child,
              startTime: new Date(),
            };

            logger.info(`Connection established on port ${port}`);
            resolve(connection);
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        logger.debug('boundary connect stderr:', chunk);
      });

      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.activeProcesses.delete(sessionId);
          reject(new BoundaryError(
            `Failed to start boundary connect: ${error.message}`,
            BoundaryErrorCode.CONNECTION_FAILED,
            error
          ));
        }
      });

      child.on('exit', (code, signal) => {
        logger.debug(`boundary connect exited with code ${code}, signal ${signal}`);
        this.activeProcesses.delete(sessionId);

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);

          if (code !== 0) {
            reject(new BoundaryError(
              stderr || `Connection failed with exit code ${code}`,
              BoundaryErrorCode.CONNECTION_FAILED,
              { code, stderr }
            ));
          } else {
            reject(new BoundaryError(
              'Connection closed unexpectedly',
              BoundaryErrorCode.PROCESS_TERMINATED
            ));
          }
        }
      });
    });
  }

  /**
   * Extract error info from CLI output, including appropriate error code
   * Handles JSON API error responses from Boundary
   */
  private extractErrorInfo(errorOutput: string): { message: string; code: BoundaryErrorCode } {
    if (!errorOutput) {
      return { message: 'Unknown error', code: BoundaryErrorCode.CLI_EXECUTION_FAILED };
    }

    const trimmed = errorOutput.trim();
    let message = trimmed;
    let code = BoundaryErrorCode.CLI_EXECUTION_FAILED;

    // Check for "no token found" in stderr - this means user needs to authenticate
    // The CLI outputs this before making API calls when there's no saved token
    if (trimmed.includes('no token found') || trimmed.includes('No saved credential found')) {
      return {
        message: 'Not authenticated. Please log in to Boundary.',
        code: BoundaryErrorCode.AUTH_FAILED
      };
    }

    // Check if it's JSON (Boundary API error response)
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as {
          api_error?: { message?: string };
          error?: { message?: string; context?: string } | string;
          context?: string;
          status_code?: number;
        };

        // Extract meaningful message from API error structure
        if (parsed.api_error?.message) {
          message = parsed.api_error.message;
        } else if (typeof parsed.error === 'object' && parsed.error?.message) {
          message = parsed.error.message;
        } else if (parsed.context) {
          message = parsed.context;
        } else if (typeof parsed.error === 'string') {
          message = parsed.error;
        }

        // Classify the error code based on the parsed response
        code = this.classifyErrorMessage(message, parsed.status_code);
      } catch {
        // Not valid JSON, fall through
      }
    } else {
      // Plain text error - classify based on message
      code = this.classifyErrorMessage(message);
    }

    // Truncate if too long
    if (message.length > 200) {
      message = message.substring(0, 197) + '...';
    }

    return { message, code };
  }

  /**
   * Classify error message into appropriate BoundaryErrorCode
   */
  private classifyErrorMessage(message: string, statusCode?: number): BoundaryErrorCode {
    const lowerMessage = message.toLowerCase();

    // Check for auth-related errors (only 401 - authentication issues)
    // Note: 403/PermissionDenied means authenticated but not authorized - re-auth won't help
    if (statusCode === 401 ||
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('unauthenticated')) {
      return BoundaryErrorCode.AUTH_FAILED;
    }

    // Check for token expiration
    if (lowerMessage.includes('expired') ||
        lowerMessage.includes('session has ended') ||
        lowerMessage.includes('token')) {
      return BoundaryErrorCode.TOKEN_EXPIRED;
    }

    // Check for not found
    if (statusCode === 404 || lowerMessage.includes('not found')) {
      return BoundaryErrorCode.TARGET_NOT_FOUND;
    }

    return BoundaryErrorCode.CLI_EXECUTION_FAILED;
  }

  /**
   * Execute a Boundary CLI command
   */
  private async execute(args: string[], timeoutMs = 30000): Promise<CLIExecutionResult> {
    const cliPath = this.cliPath;
    const env = this.getCliEnv();

    logger.debug(`Executing: ${cliPath} ${args.join(' ')}`);
    logger.debug(`Environment: BOUNDARY_ADDR=${env.BOUNDARY_ADDR}, BOUNDARY_TLS_INSECURE=${env.BOUNDARY_TLS_INSECURE}`);

    try {
      const { stdout, stderr } = await execFileAsync(cliPath, args, {
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: timeoutMs,
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error: unknown) {
      // execFile throws on non-zero exit
      logger.error('CLI execution error:', error);

      if (error && typeof error === 'object' && 'code' in error) {
        const execError = error as { code: number | string; stdout?: string; stderr?: string; message: string };
        logger.error(`CLI exit code: ${execError.code}`);
        logger.error(`CLI stdout: ${execError.stdout?.substring(0, 500) || '(empty)'}`);
        logger.error(`CLI stderr: ${execError.stderr?.substring(0, 500) || '(empty)'}`);

        // Check if it's a "command not found" error
        if (execError.code === 127 || execError.code === 'ENOENT' ||
            (execError.stderr && execError.stderr.includes('not found'))) {
          throw new BoundaryError(
            'Boundary CLI not found',
            BoundaryErrorCode.CLI_NOT_FOUND
          );
        }

        // Return the result for parsing (may contain error JSON)
        if (execError.stdout) {
          return {
            stdout: execError.stdout,
            stderr: execError.stderr || '',
            exitCode: typeof execError.code === 'number' ? execError.code : 1,
          };
        }

        // Try to parse JSON error from stderr and classify appropriately
        const errorSource = execError.stderr || execError.message;
        const errorInfo = this.extractErrorInfo(errorSource);

        throw new BoundaryError(
          errorInfo.message,
          errorInfo.code,
          error
        );
      }

      throw new BoundaryError(
        String(error),
        BoundaryErrorCode.CLI_EXECUTION_FAILED,
        error
      );
    }
  }

  /**
   * Kill a specific connection process
   */
  killProcess(sessionId: string): boolean {
    const process = this.activeProcesses.get(sessionId);
    if (process) {
      logger.info(`Killing process for session ${sessionId}`);
      process.kill('SIGTERM');

      // Force kill after timeout if process doesn't exit
      const forceKillTimeout = setTimeout(() => {
        if (!process.killed) {
          logger.warn(`Force killing process for session ${sessionId}`);
          process.kill('SIGKILL');
        }
      }, 5000);

      // Clear timeout when process exits to prevent memory leak
      process.once('exit', () => {
        clearTimeout(forceKillTimeout);
      });

      this.activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Kill all active processes
   */
  killAllProcesses(): void {
    logger.info(`Killing all ${this.activeProcesses.size} active processes`);
    for (const [_sessionId, process] of this.activeProcesses) {
      process.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }

  dispose(): void {
    this.killAllProcesses();
    if (this.configChangeSubscription) {
      this.configChangeSubscription.dispose();
      this.configChangeSubscription = undefined;
    }
  }
}

// Singleton instance
let cliInstance: BoundaryCLI | undefined;

export function getBoundaryCLI(): BoundaryCLI {
  if (!cliInstance) {
    cliInstance = new BoundaryCLI();
  }
  return cliInstance;
}

export function disposeBoundaryCLI(): void {
  if (cliInstance) {
    cliInstance.dispose();
    cliInstance = undefined;
  }
}
