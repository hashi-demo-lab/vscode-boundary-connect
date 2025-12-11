/**
 * Connection Manager - manages active Boundary connections
 */

import * as vscode from 'vscode';
import { BoundaryTarget, IConnectionManager, Session } from '../types';
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

    // Spawn boundary connect
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

    // Trigger Remote SSH connection
    try {
      await triggerRemoteSSH({
        host: session.localHost,
        port: session.localPort,
      });
    } catch (error) {
      logger.error('Failed to trigger Remote SSH:', error);
      // Don't fail the connection, user can manually connect
      void vscode.window.showWarningMessage(
        `Connected to ${target.name} on port ${session.localPort}. ` +
        'Failed to open Remote SSH automatically. You can connect manually using Remote SSH.'
      );
    }

    return session;
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
