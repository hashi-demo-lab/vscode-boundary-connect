/**
 * Boundary VS Code Extension - TypeScript Type Definitions
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

// ============================================================================
// Auth Method Discovery Types
// ============================================================================

export interface BoundaryAuthMethod {
  id: string;
  scopeId: string;
  name: string;
  description?: string;
  type: 'oidc' | 'password' | 'ldap';
  isPrimary: boolean;
  createdTime?: Date;
  updatedTime?: Date;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  accountId?: string;
  userId?: string;
  expirationTime?: Date;
  error?: string;
}

export interface IAuthManager extends vscode.Disposable {
  login(method: AuthMethod, credentials?: Credentials): Promise<AuthResult>;
  logout(): void;
  getToken(): Promise<string | undefined>;
  isAuthenticated(): Promise<boolean>;
  handleTokenExpired(): void;
  readonly onAuthStateChanged: vscode.Event<boolean>;
}

// ============================================================================
// Auth State Types
// ============================================================================

/**
 * Authentication state enum - explicit state machine
 */
export type AuthState =
  | 'initializing'      // Extension starting up, checking auth
  | 'unauthenticated'   // No valid token
  | 'authenticating'    // Login in progress
  | 'authenticated'     // Valid token available
  | 'expired'           // Token expired, needs re-auth
  | 'error';            // Auth system error

/**
 * State transition events
 */
export type AuthEvent =
  | { type: 'INIT_COMPLETE'; hasToken: boolean }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS' }
  | { type: 'LOGIN_FAILURE'; error: string }
  | { type: 'TOKEN_EXPIRED' }
  | { type: 'LOGOUT' }
  | { type: 'AUTH_ERROR'; error: string };

/**
 * Auth State Manager interface for dependency injection and testing
 */
export interface IAuthStateManager extends vscode.Disposable {
  readonly state: AuthState;
  readonly isAuthenticated: boolean;
  readonly lastError: string | undefined;
  dispatch(event: AuthEvent): void;
  reset(): void;
  readonly onStateChanged: vscode.Event<AuthState>;
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

export interface SessionRecording {
  id: string;
  scopeId: string;
  scope?: BoundaryScope;
  /** ID of the storage bucket containing this recording */
  storageBucketId?: string;
  /** Target ID this recording is associated with */
  targetId?: string;
  /** Target name (resolved from target ID) */
  targetName?: string;
  /** User ID who created this session */
  userId?: string;
  /** Username (resolved from user ID) */
  userName?: string;
  /** Session ID this recording is associated with */
  sessionId?: string;
  /** ISO 8601 timestamp when recording was created */
  createdTime: string;
  /** ISO 8601 timestamp when recording was last updated */
  updatedTime?: string;
  /** Duration of the recording (e.g., "2m45s") */
  duration?: string;
  /** State of the recording (available, unknown, etc.) */
  state?: string;
  /** Size in bytes */
  byteCount?: number;
  /** MIME type (e.g., "application/x-asciicast") */
  mimeType?: string;
  /** Authorized actions user can perform on this recording */
  authorizedActions?: string[];
}

// ============================================================================
// CLI Types
// ============================================================================

/**
 * Result type for token retrieval - distinguishes between
 * "no token", "token found", and "CLI error"
 */
export type TokenResult =
  | { status: 'found'; token: string }
  | { status: 'not_found' }
  | { status: 'cli_error'; error: string };

export interface CLIExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ConnectOptions {
  listenPort?: number;
  listenAddr?: string;
  authzToken?: string;
  /** Target type for specialized connect commands (ssh vs tcp) */
  targetType?: 'tcp' | 'ssh';
  /** Username for SSH connections */
  username?: string;
}

export interface SessionAuthorization {
  sessionId: string;
  authorizationToken: string;
  endpoint: string;
  endpointPort: number;
  expiration: Date;
  /** Brokered credentials (if credential brokering enabled on target) */
  credentials?: BrokeredCredential[];
}

export interface IBoundaryCLI extends vscode.Disposable {
  checkInstalled(): Promise<boolean>;
  getVersion(): Promise<string | undefined>;
  authenticate(method: AuthMethod, credentials?: Credentials): Promise<AuthResult>;
  getToken(): Promise<TokenResult>;
  listAuthMethods(scopeId?: string): Promise<BoundaryAuthMethod[]>;
  listTargets(scopeId?: string, recursive?: boolean): Promise<BoundaryTarget[]>;
  listScopes(parentScopeId?: string): Promise<BoundaryScope[]>;
  listSessionRecordings(scopeId: string): Promise<SessionRecording[]>;
  downloadRecording(recordingId: string): Promise<string>;
  authorizeSession(targetId: string): Promise<SessionAuthorization>;
  connect(targetId: string, options?: ConnectOptions): Promise<Connection>;
}

// ============================================================================
// Credential Brokering Types
// ============================================================================

export interface BrokeredCredential {
  credentialSource: {
    id: string;
    name?: string;
    description?: string;
    credentialStoreId?: string;
    type?: string;
  };
  credential: {
    username?: string;
    password?: string;
    privateKey?: string;
    privateKeyPassphrase?: string;
    certificate?: string;
  };
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
  /** Brokered credentials returned by Boundary (if credential brokering enabled) */
  credentials?: BrokeredCredential[];
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
  connect(target: BoundaryTarget): Promise<Session>;
  disconnect(sessionId: string): Promise<void>;
  disconnectAll(): Promise<void>;
  getActiveSessions(): Session[];
  getSessionCount(): number;
  readonly onSessionsChanged: vscode.Event<Session[]>;
}

// ============================================================================
// Target Provider Types
// ============================================================================

export type TargetTreeItemType = 'scope' | 'project' | 'target' | 'loading' | 'error' | 'login';

export interface TargetTreeItemData {
  type: TargetTreeItemType;
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  scope?: BoundaryScope;
  target?: BoundaryTarget;
}

export interface ITargetProvider extends vscode.TreeDataProvider<TargetTreeItemData>, vscode.Disposable {
  refresh(): void;
  setAuthManager(authManager: IAuthManager): void;
  /**
   * Initialize event subscriptions (for lazy initialization)
   * Should be called after construction when all dependencies are ready
   */
  initialize(): void;
}

/**
 * Target Service interface for dependency injection and testing
 */
export interface ITargetService extends vscode.Disposable {
  getAllTargets(forceRefresh?: boolean): Promise<BoundaryTarget[]>;
  getTargetsForScope(scopeId: string, forceRefresh?: boolean): Promise<BoundaryTarget[]>;
  getTarget(targetId: string): Promise<BoundaryTarget | undefined>;
  getScopes(forceRefresh?: boolean): Promise<BoundaryScope[]>;
  groupTargetsByScope(targets: BoundaryTarget[]): Map<string, BoundaryTarget[]>;
  refresh(): Promise<void>;
  clearCache(): void;
  readonly onTargetsChanged: vscode.Event<void>;
}

// ============================================================================
// Recording Provider Types
// ============================================================================

export type RecordingTreeItemType = 'target-group' | 'recording' | 'loading' | 'error';

export interface RecordingTreeItemData {
  type: RecordingTreeItemType;
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  targetId?: string;
  targetName?: string;
  recording?: SessionRecording;
}

export interface IRecordingProvider extends vscode.TreeDataProvider<RecordingTreeItemData>, vscode.Disposable {
  refresh(): void;
  /**
   * Initialize event subscriptions (for lazy initialization)
   * Should be called after construction when all dependencies are ready
   */
  initialize(): void;
}

/**
 * Recording Service interface for dependency injection and testing
 */
export interface IRecordingService extends vscode.Disposable {
  getRecordings(scopeId: string, forceRefresh?: boolean): Promise<SessionRecording[]>;
  getRecordingById(id: string): Promise<SessionRecording | undefined>;
  groupRecordingsByTarget(recordings: SessionRecording[]): Map<string, SessionRecording[]>;
  refresh(): Promise<void>;
  clearCache(): void;
  readonly onRecordingsChanged: vscode.Event<void>;
}

// ============================================================================
// Remote SSH Types
// ============================================================================

export interface RemoteSSHConnectionOptions {
  host: string;
  port: number;
  userName?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
  certificate?: string;
}

export interface IRemoteSSHIntegration {
  isInstalled(): boolean;
  promptInstall(): Promise<boolean>;
  connect(options: RemoteSSHConnectionOptions): Promise<void>;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ExtensionConfiguration {
  cliPath: string;
  addr: string;
  tlsInsecure: boolean;
  keyringType: 'auto' | 'none';
  defaultAuthMethod: AuthMethod;
  boundaryAddr?: string;
  autoConnect: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface IConfigurationService {
  getConfiguration(): ExtensionConfiguration;
  get<K extends keyof ExtensionConfiguration>(key: K): ExtensionConfiguration[K];
  readonly onConfigurationChanged: vscode.Event<ExtensionConfiguration>;
}

// ============================================================================
// UI Types
// ============================================================================

export interface IStatusBarManager extends vscode.Disposable {
  updateSessionCount(count: number): void;
  showConnecting(targetName: string): void;
  showError(message: string): void;
  reset(): void;
}

export interface INotificationService {
  info(message: string, ...actions: string[]): Promise<string | undefined>;
  warn(message: string, ...actions: string[]): Promise<string | undefined>;
  error(message: string, ...actions: string[]): Promise<string | undefined>;
  withProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T>;
}
