/**
 * Service Container - Dependency Injection for the Extension
 *
 * Provides a centralized place to create and access services with proper
 * dependency injection. This enables:
 * - Easy unit testing (inject mocks)
 * - Clear dependency graph
 * - Proper initialization order
 * - Clean disposal
 */

import * as vscode from 'vscode';
import {
  IAuthManager,
  IAuthStateManager,
  IBoundaryCLI,
  IConfigurationService,
  IConnectionManager,
  IStatusBarManager,
  ITargetService,
} from '../types';

/**
 * Service container interface - all services available in the extension
 */
export interface IServiceContainer {
  readonly context: vscode.ExtensionContext;
  readonly config: IConfigurationService;
  readonly cli: IBoundaryCLI;
  readonly authState: IAuthStateManager;
  readonly auth: IAuthManager;
  readonly targets: ITargetService;
  readonly connections: IConnectionManager;
  readonly statusBar: IStatusBarManager;
}

/**
 * Service factory functions - create services with their dependencies
 */
export interface ServiceFactories {
  config: () => IConfigurationService;
  cli: (config: IConfigurationService) => IBoundaryCLI;
  authState: () => IAuthStateManager;
  auth: (context: vscode.ExtensionContext, cli: IBoundaryCLI, authState: IAuthStateManager) => IAuthManager;
  targets: (cli: IBoundaryCLI) => ITargetService;
  connections: (cli: IBoundaryCLI, context: vscode.ExtensionContext) => IConnectionManager;
  statusBar: () => IStatusBarManager;
}

/**
 * Create a service container with all services initialized
 *
 * Services are created lazily on first access to avoid unnecessary
 * initialization and to support proper dependency ordering.
 */
export function createServiceContainer(
  context: vscode.ExtensionContext,
  factories: ServiceFactories
): IServiceContainer {
  // Lazy initialization cache
  let _config: IConfigurationService | undefined;
  let _cli: IBoundaryCLI | undefined;
  let _authState: IAuthStateManager | undefined;
  let _auth: IAuthManager | undefined;
  let _targets: ITargetService | undefined;
  let _connections: IConnectionManager | undefined;
  let _statusBar: IStatusBarManager | undefined;

  return {
    context,

    get config(): IConfigurationService {
      if (!_config) {
        _config = factories.config();
      }
      return _config;
    },

    get cli(): IBoundaryCLI {
      if (!_cli) {
        _cli = factories.cli(this.config);
      }
      return _cli;
    },

    get authState(): IAuthStateManager {
      if (!_authState) {
        _authState = factories.authState();
      }
      return _authState;
    },

    get auth(): IAuthManager {
      if (!_auth) {
        _auth = factories.auth(context, this.cli, this.authState);
      }
      return _auth;
    },

    get targets(): ITargetService {
      if (!_targets) {
        _targets = factories.targets(this.cli);
      }
      return _targets;
    },

    get connections(): IConnectionManager {
      if (!_connections) {
        _connections = factories.connections(this.cli, context);
      }
      return _connections;
    },

    get statusBar(): IStatusBarManager {
      if (!_statusBar) {
        _statusBar = factories.statusBar();
      }
      return _statusBar;
    },
  };
}

/**
 * Dispose all services in the container
 */
export function disposeServiceContainer(container: IServiceContainer): void {
  // Dispose in reverse dependency order
  const disposables = [
    container.connections,
    container.statusBar,
    container.targets,
    container.auth,
    container.authState,
    container.cli,
    container.config,
  ];

  for (const service of disposables) {
    if (service && 'dispose' in service) {
      try {
        (service as vscode.Disposable).dispose();
      } catch (error) {
        // Log but don't throw during disposal
        console.error('Error disposing service:', error);
      }
    }
  }
}

// ============================================================================
// Global Container (for backward compatibility during migration)
// ============================================================================

let globalContainer: IServiceContainer | undefined;

/**
 * Set the global service container (called during activation)
 */
export function setGlobalContainer(container: IServiceContainer): void {
  globalContainer = container;
}

/**
 * Get the global service container
 * @throws Error if container not initialized
 */
export function getContainer(): IServiceContainer {
  if (!globalContainer) {
    throw new Error('Service container not initialized. Call setGlobalContainer() first.');
  }
  return globalContainer;
}

/**
 * Check if the global container is initialized
 */
export function hasContainer(): boolean {
  return globalContainer !== undefined;
}

/**
 * Clear the global container (for testing)
 */
export function clearGlobalContainer(): void {
  globalContainer = undefined;
}
