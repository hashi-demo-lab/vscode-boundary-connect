/**
 * Connection Manager - manages active Boundary connections
 */

import * as vscode from 'vscode';
import { BoundaryTarget, BrokeredCredential, IBoundaryCLI, IConnectionManager, Session } from '../types';
import { getBoundaryCLI } from '../boundary/cli';
import { logger } from '../utils/logger';
import { createSession, terminateSession } from './session';
import { triggerRemoteSSH, removeBoundarySSHConfigEntry } from './remoteSSH';

/** Storage key prefix for persisted usernames */
const USERNAME_STORAGE_PREFIX = 'boundary.username.';

export class ConnectionManager implements IConnectionManager {
  private readonly _onSessionsChanged = new vscode.EventEmitter<Session[]>();
  readonly onSessionsChanged = this._onSessionsChanged.event;

  private sessions: Map<string, Session> = new Map();
  private globalState: vscode.Memento | undefined;
  private readonly cli: IBoundaryCLI;

  /**
   * Create a new ConnectionManager
   * @param cli - Boundary CLI (optional for backward compatibility)
   * @param globalState - VS Code global state for persistence (optional)
   */
  constructor(cli?: IBoundaryCLI, globalState?: vscode.Memento) {
    this.cli = cli ?? getBoundaryCLI();
    this.globalState = globalState;
  }

  /**
   * Set the global state for persisting usernames across sessions
   * Called during extension activation (for backward compatibility)
   */
  setGlobalState(globalState: vscode.Memento): void {
    this.globalState = globalState;
  }

  async connect(target: BoundaryTarget): Promise<Session> {
    logger.info(`Connecting to target: ${target.name} (${target.id})`);

    // First, try to get session authorization to check for brokered credentials
    let brokeredCredentials: BrokeredCredential[] | undefined;
    let userName: string | undefined;
    let privateKey: string | undefined;
    let privateKeyPassphrase: string | undefined;
    let certificate: string | undefined;

    try {
      const authz = await this.cli.authorizeSession(target.id);
      logger.debug('authorize-session response:', {
        hasCredentials: !!authz.credentials,
        credentialCount: authz.credentials?.length
      });
      if (authz.credentials && authz.credentials.length > 0) {
        brokeredCredentials = authz.credentials;
        // Use credentials from first brokered credential
        const cred = brokeredCredentials[0];
        logger.debug('First credential:', {
          hasCredential: !!cred.credential,
          hasUsername: !!cred.credential?.username,
          hasPrivateKey: !!cred.credential?.privateKey,
          credentialKeys: cred.credential ? Object.keys(cred.credential) : []
        });
        if (cred.credential.username) {
          userName = cred.credential.username;
          logger.info(`Using brokered username: ${userName}`);
        }
        if (cred.credential.privateKey) {
          privateKey = cred.credential.privateKey;
          privateKeyPassphrase = cred.credential.privateKeyPassphrase;
          logger.info('Using brokered SSH private key');
        } else {
          logger.warn('No privateKey in brokered credential');
        }
        if (cred.credential.certificate) {
          certificate = cred.credential.certificate;
          logger.info('Using brokered SSH certificate (Vault key signing)');
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
    const connection = await this.cli.connect(target.id);

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

      // Clean up SSH config entry for this session
      void removeBoundarySSHConfigEntry(session.localPort, session.targetName);
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
          privateKey: privateKey,
          privateKeyPassphrase: privateKeyPassphrase,
          certificate: certificate,
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

  /**
   * Get saved username from persistent storage
   */
  private getSavedUsername(targetId: string): string | undefined {
    if (!this.globalState) {
      return undefined;
    }
    return this.globalState.get<string>(`${USERNAME_STORAGE_PREFIX}${targetId}`);
  }

  /**
   * Save username to persistent storage for future sessions
   */
  private saveUsername(targetId: string, userName: string): void {
    if (!this.globalState) {
      logger.warn('Cannot persist username: globalState not initialized');
      return;
    }
    void this.globalState.update(`${USERNAME_STORAGE_PREFIX}${targetId}`, userName);
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
