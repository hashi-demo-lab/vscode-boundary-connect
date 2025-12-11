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
  logout(): Promise<void>;
  getToken(): Promise<string | undefined>;
  isAuthenticated(): Promise<boolean>;
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

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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

export interface IBoundaryCLI extends vscode.Disposable {
  checkInstalled(): Promise<boolean>;
  getVersion(): Promise<string | undefined>;
  authenticate(method: AuthMethod, credentials?: Credentials): Promise<AuthResult>;
  getToken(): Promise<string | undefined>;
  listAuthMethods(scopeId?: string): Promise<BoundaryAuthMethod[]>;
  listTargets(scopeId?: string, recursive?: boolean): Promise<BoundaryTarget[]>;
  listScopes(parentScopeId?: string): Promise<BoundaryScope[]>;
  authorizeSession(targetId: string): Promise<SessionAuthorization>;
  connect(targetId: string, options?: ConnectOptions): Promise<Connection>;
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

export interface ITargetProvider extends vscode.TreeDataProvider<TargetTreeItemData> {
  refresh(): void;
  setAuthenticated(authenticated: boolean): void;
}

// ============================================================================
// Remote SSH Types
// ============================================================================

export interface RemoteSSHConnectionOptions {
  host: string;
  port: number;
  userName?: string;
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
