/**
 * Boundary VS Code Extension - TypeScript Interface Contracts
 * These interfaces define the contracts between components.
 */

import * as vscode from 'vscode';
import { ChildProcess } from 'child_process';

// ============================================================================
// Authentication Types
// ============================================================================

export type AuthMethod = 'oidc' | 'password';

export interface PasswordCredentials {
  authMethodId: string;
  loginName: string;
  password: string;
}

export interface OidcCredentials {
  authMethodId: string;
}

export type Credentials = PasswordCredentials | OidcCredentials;

export interface AuthResult {
  success: boolean;
  token?: string;
  accountId?: string;
  userId?: string;
  expirationTime?: Date;
  error?: string;
}

export interface IAuthManager extends vscode.Disposable {
  /**
   * Authenticate with Boundary using the specified method
   */
  login(method: AuthMethod, credentials?: Credentials): Promise<AuthResult>;

  /**
   * Clear stored authentication token
   */
  logout(): Promise<void>;

  /**
   * Get the current authentication token
   */
  getToken(): Promise<string | undefined>;

  /**
   * Check if user is currently authenticated
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Event fired when authentication state changes
   */
  readonly onAuthStateChanged: vscode.Event<boolean>;
}

// ============================================================================
// Boundary Domain Types
// ============================================================================

export interface BoundaryScope {
  id: string;
  type: 'global' | 'org' | 'project';
  name: string;
  description?: string;
  parentScopeId?: string;
}

export interface BoundaryProject {
  id: string;
  scopeId: string;
  name: string;
  description?: string;
}

export interface BoundaryTarget {
  id: string;
  scopeId: string;
  scope: BoundaryScope;
  name: string;
  description?: string;
  type: 'tcp' | 'ssh' | 'rdp';
  address?: string;
  defaultPort?: number;
  sessionMaxSeconds?: number;
  sessionConnectionLimit?: number;
  authorizedActions: string[];
  createdTime?: Date;
  updatedTime?: Date;
}

export interface BoundaryHost {
  id: string;
  hostCatalogId: string;
  name?: string;
  description?: string;
  address: string;
}

// ============================================================================
// CLI Interface Types
// ============================================================================

export interface CLIExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface IBoundaryCLI extends vscode.Disposable {
  /**
   * Check if Boundary CLI is installed and accessible
   */
  checkInstalled(): Promise<boolean>;

  /**
   * Get CLI version
   */
  getVersion(): Promise<string | undefined>;

  /**
   * Authenticate with Boundary
   */
  authenticate(method: AuthMethod, credentials?: Credentials): Promise<AuthResult>;

  /**
   * Get stored token from CLI
   */
  getToken(): Promise<string | undefined>;

  /**
   * List targets, optionally filtered by scope
   */
  listTargets(scopeId?: string, recursive?: boolean): Promise<BoundaryTarget[]>;

  /**
   * List scopes
   */
  listScopes(parentScopeId?: string): Promise<BoundaryScope[]>;

  /**
   * Authorize a session for a target (get auth token for connect)
   */
  authorizeSession(targetId: string): Promise<SessionAuthorization>;

  /**
   * Connect to a target and return the connection info
   */
  connect(targetId: string, options?: ConnectOptions): Promise<Connection>;
}

export interface ConnectOptions {
  listenPort?: number;
  listenAddr?: string;
  authzToken?: string;
}

export interface SessionAuthorization {
  sessionId: string;
  authorizationToken: string;
  endpoint: string;
  endpointPort: number;
  expiration: Date;
  credentials?: unknown[];
}

// ============================================================================
// Connection/Session Types
// ============================================================================

export interface Connection {
  sessionId: string;
  targetId: string;
  targetName: string;
  localHost: string;
  localPort: number;
  process: ChildProcess;
  startTime: Date;
}

export interface Session {
  id: string;
  targetId: string;
  targetName: string;
  targetType: 'tcp' | 'ssh' | 'rdp';
  localHost: string;
  localPort: number;
  status: SessionStatus;
  startTime: Date;
  process: ChildProcess;
}

export type SessionStatus = 'connecting' | 'active' | 'disconnecting' | 'terminated';

export interface IConnectionManager extends vscode.Disposable {
  /**
   * Connect to a target
   */
  connect(target: BoundaryTarget): Promise<Session>;

  /**
   * Disconnect a specific session
   */
  disconnect(sessionId: string): Promise<void>;

  /**
   * Disconnect all active sessions
   */
  disconnectAll(): Promise<void>;

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[];

  /**
   * Get session count
   */
  getSessionCount(): number;

  /**
   * Event fired when sessions change
   */
  readonly onSessionsChanged: vscode.Event<Session[]>;
}

// ============================================================================
// Target Provider Types
// ============================================================================

export type TargetTreeItemType = 'scope' | 'project' | 'target' | 'loading' | 'error' | 'login';

export interface TargetTreeItem {
  type: TargetTreeItemType;
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  iconPath?: vscode.ThemeIcon;
  collapsibleState: vscode.TreeItemCollapsibleState;
  contextValue?: string;
  command?: vscode.Command;

  // Type-specific data
  scope?: BoundaryScope;
  target?: BoundaryTarget;
}

export interface ITargetProvider extends vscode.TreeDataProvider<TargetTreeItem> {
  /**
   * Refresh the target tree
   */
  refresh(): void;

  /**
   * Set authentication state
   */
  setAuthenticated(authenticated: boolean): void;
}

// ============================================================================
// Remote SSH Integration Types
// ============================================================================

export interface RemoteSSHConnectionOptions {
  host: string;
  port: number;
  userName?: string;
}

export interface IRemoteSSHIntegration {
  /**
   * Check if Remote SSH extension is installed
   */
  isInstalled(): boolean;

  /**
   * Prompt user to install Remote SSH extension
   */
  promptInstall(): Promise<boolean>;

  /**
   * Open Remote SSH connection
   */
  connect(options: RemoteSSHConnectionOptions): Promise<void>;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ExtensionConfiguration {
  cliPath: string;
  defaultAuthMethod: AuthMethod;
  boundaryAddr?: string;
  autoConnect: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface IConfigurationService {
  /**
   * Get current configuration
   */
  getConfiguration(): ExtensionConfiguration;

  /**
   * Get specific configuration value
   */
  get<K extends keyof ExtensionConfiguration>(key: K): ExtensionConfiguration[K];

  /**
   * Event fired when configuration changes
   */
  readonly onConfigurationChanged: vscode.Event<ExtensionConfiguration>;
}

// ============================================================================
// UI Types
// ============================================================================

export interface IStatusBarManager extends vscode.Disposable {
  /**
   * Update status bar with session count
   */
  updateSessionCount(count: number): void;

  /**
   * Show connecting status
   */
  showConnecting(targetName: string): void;

  /**
   * Show error status
   */
  showError(message: string): void;

  /**
   * Reset to default state
   */
  reset(): void;
}

export interface INotificationService {
  /**
   * Show information message
   */
  info(message: string, ...actions: string[]): Promise<string | undefined>;

  /**
   * Show warning message
   */
  warn(message: string, ...actions: string[]): Promise<string | undefined>;

  /**
   * Show error message
   */
  error(message: string, ...actions: string[]): Promise<string | undefined>;

  /**
   * Show progress notification
   */
  withProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T>;
}

// ============================================================================
// Error Types
// ============================================================================

export class BoundaryError extends Error {
  constructor(
    message: string,
    public readonly code: BoundaryErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'BoundaryError';
  }
}

export enum BoundaryErrorCode {
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  CLI_EXECUTION_FAILED = 'CLI_EXECUTION_FAILED',
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TARGET_NOT_FOUND = 'TARGET_NOT_FOUND',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  PORT_CAPTURE_FAILED = 'PORT_CAPTURE_FAILED',
  REMOTE_SSH_NOT_INSTALLED = 'REMOTE_SSH_NOT_INSTALLED',
  REMOTE_SSH_FAILED = 'REMOTE_SSH_FAILED',
  PROCESS_TERMINATED = 'PROCESS_TERMINATED',
  UNKNOWN = 'UNKNOWN',
}

// ============================================================================
// Event Types
// ============================================================================

export interface AuthStateChangedEvent {
  authenticated: boolean;
  userId?: string;
}

export interface SessionChangedEvent {
  type: 'added' | 'removed' | 'updated';
  session: Session;
  allSessions: Session[];
}

export interface TargetSelectedEvent {
  target: BoundaryTarget;
}
