/**
 * Connection Manager - manages active Boundary connections
 */

import * as vscode from 'vscode';
import { BoundaryTarget, BrokeredCredential, IConnectionManager, Session } from '../types';
import { getBoundaryCLI } from '../boundary/cli';
import { logger } from '../utils/logger';
import { createSession, terminateSession } from './session';
import { triggerRemoteSSH } from './remoteSSH';

export class ConnectionManager implements IConnectionManager {
  private readonly _onSessionsChanged = new vscode.EventEmitter<Session[]>();
  readonly onSessionsChanged = this._onSessionsChanged.event;

  private sessions: Map<string, Session> = new Map();

  constructor() {}

  async connect(target: BoundaryTarget): Promise<Session> {
    logger.info(`Connecting to target: ${target.name} (${target.id})`);

    const cli = getBoundaryCLI();

    // First, try to get session authorization to check for brokered credentials
    let brokeredCredentials: BrokeredCredential[] | undefined;
    let userName: string | undefined;

    try {
      const authz = await cli.authorizeSession(target.id);
      if (authz.credentials && authz.credentials.length > 0) {
        brokeredCredentials = authz.credentials;
        // Use username from brokered credentials if available
        const cred = brokeredCredentials[0];
        if (cred.credential.username) {
          userName = cred.credential.username;
          logger.info(`Using brokered username: ${userName}`);
        }
      }
    } catch (error) {
      // authorize-session is optional - continue without it
      logger.debug('Could not get session authorization for credentials:', error);
    }

    // For SSH/TCP targets without brokered credentials, prompt for username
    if (!userName && (target.type === 'ssh' || target.type === 'tcp')) {
      userName = await this.promptForUsername(target);
      if (userName === undefined) {
        // User cancelled
        throw new Error('Connection cancelled');
      }
    }

    // Spawn boundary connect (TCP proxy mode)
    const connection = await cli.connect(target.id);

    // Create session
    const session = createSession(target, connection.process, connection.localPort);

    // Store session
    this.sessions.set(session.id, session);

    // Set up process exit handler
    connection.process.on('exit', (code, signal) => {
      logger.info(`Session ${session.id} process exited: code=${code}, signal=${signal}`);
      session.status = 'terminated';
      this.sessions.delete(session.id);
      this._onSessionsChanged.fire(this.getActiveSessions());
    });

    // Notify listeners
    this._onSessionsChanged.fire(this.getActiveSessions());

    // Trigger Remote SSH connection for SSH-type targets
    if (target.type === 'ssh' || target.type === 'tcp') {
      try {
        await triggerRemoteSSH({
          host: session.localHost,
          port: session.localPort,
          userName: userName || undefined,
          targetName: target.name,
        });
      } catch (error) {
        logger.error('Failed to trigger Remote SSH:', error);
        // Don't fail the connection, user can manually connect
        void vscode.window.showInformationMessage(
          `Connected to ${target.name} on localhost:${session.localPort}. ` +
          `Use SSH: ssh ${userName ? userName + '@' : ''}localhost -p ${session.localPort}`,
          'Copy Command'
        ).then(action => {
          if (action === 'Copy Command') {
            const cmd = `ssh ${userName ? userName + '@' : ''}localhost -p ${session.localPort}`;
            void vscode.env.clipboard.writeText(cmd);
          }
        });
      }
    } else {
      // For non-SSH targets (like databases), show connection info
      void vscode.window.showInformationMessage(
        `Connected to ${target.name} on localhost:${session.localPort}`
      );
    }

    return session;
  }

  /**
   * Prompt user for SSH username
   */
  private async promptForUsername(target: BoundaryTarget): Promise<string | undefined> {
    // Check if we have a saved username for this target
    const savedUserName = this.getSavedUsername(target.id);

    const userName = await vscode.window.showInputBox({
      prompt: `Enter SSH username for ${target.name}`,
      placeHolder: 'e.g., ubuntu, ec2-user, admin',
      value: savedUserName,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Username is required for SSH connection';
        }
        if (value.includes(' ')) {
          return 'Username cannot contain spaces';
        }
        return undefined;
      },
    });

    if (userName) {
      // Save for next time
      this.saveUsername(target.id, userName);
    }

    return userName;
  }

  // Simple in-memory username cache (could be persisted later)
  private usernameCache: Map<string, string> = new Map();

  private getSavedUsername(targetId: string): string | undefined {
    return this.usernameCache.get(targetId);
  }

  private saveUsername(targetId: string, userName: string): void {
    this.usernameCache.set(targetId, userName);
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`Session ${sessionId} not found`);
      return;
    }

    await terminateSession(session);
    this.sessions.delete(sessionId);
    this._onSessionsChanged.fire(this.getActiveSessions());
  }

  async disconnectAll(): Promise<void> {
    logger.info(`Disconnecting all ${this.sessions.size} sessions`);

    const promises = Array.from(this.sessions.values()).map(session =>
      terminateSession(session)
    );

    await Promise.all(promises);
    this.sessions.clear();
    this._onSessionsChanged.fire([]);
  }

  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  getSessionCount(): number {
    return this.getActiveSessions().length;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get sessions for a specific target
   */
  getSessionsForTarget(targetId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.targetId === targetId);
  }

  dispose(): void {
    // Disconnect all sessions on dispose
    void this.disconnectAll();
    // Clear username cache to prevent memory leak
    this.usernameCache.clear();
    this._onSessionsChanged.dispose();
  }
}

// Singleton instance
let connectionManagerInstance: ConnectionManager | undefined;

export function getConnectionManager(): ConnectionManager {
  if (!connectionManagerInstance) {
    connectionManagerInstance = new ConnectionManager();
  }
  return connectionManagerInstance;
}

export function disposeConnectionManager(): void {
  if (connectionManagerInstance) {
    connectionManagerInstance.dispose();
    connectionManagerInstance = undefined;
  }
}
