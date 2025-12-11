/**
 * Boundary CLI wrapper
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import {
  AuthMethod,
  AuthResult,
  BoundaryScope,
  BoundaryTarget,
  CLIExecutionResult,
  Connection,
  ConnectOptions,
  Credentials,
  IBoundaryCLI,
  PasswordCredentials,
  SessionAuthorization,
} from '../types';
import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { logger } from '../utils/logger';
import { getConfigurationService } from '../utils/config';
import {
  extractPort,
  extractVersion,
  parseAuthResponse,
  parseScopesResponse,
  parseSessionAuthResponse,
  parseTargetsResponse,
} from './parser';

const execAsync = promisify(exec);

const CONNECT_TIMEOUT_MS = 30000; // 30 seconds to capture port

export class BoundaryCLI implements IBoundaryCLI {
  private activeProcesses: Map<string, ChildProcess> = new Map();

  private get cliPath(): string {
    return getConfigurationService().get('cliPath');
  }

  /**
   * Get environment variables for CLI execution
   */
  private getCliEnv(): NodeJS.ProcessEnv {
    const config = getConfigurationService().getConfiguration();
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
    const keyringType = getConfigurationService().get('keyringType');
    return keyringType === 'none' ? ['-keyring-type', 'none'] : [];
  }

  async checkInstalled(): Promise<boolean> {
    try {
      await this.execute(['version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | undefined> {
    try {
      const result = await this.execute(['version']);
      return extractVersion(result.stdout);
    } catch {
      return undefined;
    }
  }

  async authenticate(method: AuthMethod, credentials?: Credentials): Promise<AuthResult> {
    const args = ['authenticate', method, '-format', 'json', ...this.getKeyringArgs()];

    if (method === 'password' && credentials) {
      const pwdCreds = credentials as PasswordCredentials;
      args.push('-auth-method-id', pwdCreds.authMethodId);
      args.push('-login-name', pwdCreds.loginName);
      args.push('-password', pwdCreds.password);
    } else if (method === 'oidc' && credentials) {
      args.push('-auth-method-id', credentials.authMethodId);
    }

    try {
      const result = await this.execute(args);
      return parseAuthResponse(result.stdout);
    } catch (error) {
      if (error instanceof BoundaryError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: String(error) };
    }
  }

  async getToken(): Promise<string | undefined> {
    try {
      const result = await this.execute(['config', 'get-token']);
      const token = result.stdout.trim();
      return token || undefined;
    } catch {
      return undefined;
    }
  }

  async listScopes(parentScopeId?: string): Promise<BoundaryScope[]> {
    const args = ['scopes', 'list', '-format', 'json', ...this.getKeyringArgs()];
    if (parentScopeId) {
      args.push('-scope-id', parentScopeId);
    }

    const result = await this.execute(args);
    return parseScopesResponse(result.stdout);
  }

  async listTargets(scopeId?: string, recursive = true): Promise<BoundaryTarget[]> {
    const args = ['targets', 'list', '-format', 'json', ...this.getKeyringArgs()];
    if (scopeId) {
      args.push('-scope-id', scopeId);
    }
    if (recursive) {
      args.push('-recursive');
    }

    const result = await this.execute(args);
    return parseTargetsResponse(result.stdout);
  }

  async authorizeSession(targetId: string): Promise<SessionAuthorization> {
    const args = ['targets', 'authorize-session', '-id', targetId, '-format', 'json', ...this.getKeyringArgs()];
    const result = await this.execute(args);
    return parseSessionAuthResponse(result.stdout);
  }

  async connect(targetId: string, options: ConnectOptions = {}): Promise<Connection> {
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
      const sessionId = `session-${Date.now()}`;
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
   * Execute a Boundary CLI command
   */
  private async execute(args: string[]): Promise<CLIExecutionResult> {
    const command = `"${this.cliPath}" ${args.map(a => `"${a}"`).join(' ')}`;
    logger.debug(`Executing: ${this.cliPath} ${args.join(' ')}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        env: this.getCliEnv(),
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error: unknown) {
      // exec throws on non-zero exit
      if (error && typeof error === 'object' && 'code' in error) {
        const execError = error as { code: number | string; stdout?: string; stderr?: string; message: string };

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

        throw new BoundaryError(
          execError.stderr || execError.message,
          BoundaryErrorCode.CLI_EXECUTION_FAILED,
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

      // Force kill after timeout
      setTimeout(() => {
        if (!process.killed) {
          logger.warn(`Force killing process for session ${sessionId}`);
          process.kill('SIGKILL');
        }
      }, 5000);

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
