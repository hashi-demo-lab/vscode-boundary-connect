/**
 * Target TreeDataProvider for the sidebar
 *
 * Design principles:
 * 1. Does NOT manage auth state - delegates to AuthManager
 * 2. Listens to auth state changes via AuthStateManager
 * 3. Handles display/UI concerns only
 */

import * as vscode from 'vscode';
import { BoundaryTarget, IAuthManager, IAuthStateManager, ITargetProvider, ITargetService, TargetTreeItemData } from '../types';
import { TargetTreeItem, createErrorItem, createLoadingItem, createTargetItem } from './targetItem';
import { getTargetService } from './targetService';
import { logger } from '../utils/logger';
import { isAuthRequired } from '../utils/errors';
import { AuthState, getAuthStateManager } from '../auth/authState';

export class TargetProvider implements ITargetProvider {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TargetTreeItemData | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private authManager: IAuthManager | undefined;
  private loading = false;
  private error: string | undefined;
  private targets: BoundaryTarget[] = [];

  // Store disposables to prevent memory leaks
  private readonly disposables: vscode.Disposable[] = [];

  // Injected dependencies (with lazy fallbacks for backward compatibility)
  private readonly targetService: ITargetService;
  private readonly authStateManager: IAuthStateManager;
  private initialized = false;

  /**
   * Create a new TargetProvider
   * @param targetService - Target service (optional for backward compatibility)
   * @param authStateManager - Auth state manager (optional for backward compatibility)
   */
  constructor(targetService?: ITargetService, authStateManager?: IAuthStateManager) {
    this.targetService = targetService ?? getTargetService();
    this.authStateManager = authStateManager ?? getAuthStateManager();
  }

  /**
   * Initialize event subscriptions
   * Called after construction to enable lazy initialization and avoid
   * circular dependencies during service container setup
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Listen for target changes - store disposable for cleanup
    this.disposables.push(
      this.targetService.onTargetsChanged(() => {
        this.refresh();
      })
    );

    // Listen for auth state changes - store disposable for cleanup
    this.disposables.push(
      this.authStateManager.onStateChanged((state) => {
        this.handleAuthStateChange(state);
      })
    );

    this.initialized = true;
  }

  /**
   * Set the auth manager reference (called during extension activation)
   */
  setAuthManager(authManager: IAuthManager): void {
    this.authManager = authManager;
  }

  /**
   * Handle auth state changes from the state manager
   */
  private handleAuthStateChange(state: AuthState): void {
    logger.debug(`TargetProvider: auth state changed to ${state}`);

    if (state === 'authenticated') {
      // Fetch targets when authenticated
      void this.fetchTargets();
    } else {
      // Clear targets when not authenticated
      this.targets = [];
      this.error = undefined;
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * Check if currently authenticated (delegates to state manager)
   */
  private get isAuthenticated(): boolean {
    return this.authStateManager.isAuthenticated;
  }

  refresh(): void {
    if (this.isAuthenticated) {
      void this.fetchTargets();
    } else {
      this._onDidChangeTreeData.fire();
    }
  }

  private async fetchTargets(): Promise<void> {
    this.loading = true;
    this.error = undefined;
    this._onDidChangeTreeData.fire();

    try {
      this.targets = await this.targetService.getAllTargets(true);
      this.error = undefined;
    } catch (err) {
      logger.error('Failed to fetch targets:', err);

      if (isAuthRequired(err)) {
        logger.info('Auth required error - delegating to authManager');

        // Delegate to authManager - DO NOT mutate state here
        if (this.authManager) {
          this.authManager.handleTokenExpired();
        }

        // Clear local display state
        this.error = undefined;
        this.targets = [];

        // Prompt user to re-login (don't await - let UI refresh)
        void vscode.window.showWarningMessage(
          'Your Boundary session has expired. Please sign in again.',
          'Sign In'
        ).then(action => {
          if (action === 'Sign In') {
            void vscode.commands.executeCommand('boundary.login');
          }
        });
      } else {
        this.error = err instanceof Error ? err.message : 'Failed to fetch targets';
      }
    } finally {
      this.loading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: TargetTreeItemData): vscode.TreeItem {
    return new TargetTreeItem(element);
  }

  getChildren(element?: TargetTreeItemData): TargetTreeItemData[] {
    // Root level
    if (!element) {
      // Not authenticated - return empty to show welcome view
      if (!this.isAuthenticated) {
        return [];
      }

      // Loading
      if (this.loading) {
        return [createLoadingItem()];
      }

      // Error
      if (this.error) {
        return [createErrorItem(this.error)];
      }

      // No targets
      if (this.targets.length === 0) {
        return [createErrorItem('No targets available')];
      }

      // Group targets by scope and show
      const grouped = this.targetService.groupTargetsByScope(this.targets);
      const items: TargetTreeItemData[] = [];

      for (const [scopeName, scopeTargets] of grouped) {
        // If only one scope, show targets directly
        if (grouped.size === 1) {
          return scopeTargets.map(createTargetItem);
        }

        // Create scope item
        items.push({
          type: 'scope',
          id: `scope-${scopeName}`,
          label: scopeName,
          description: `${scopeTargets.length} target${scopeTargets.length !== 1 ? 's' : ''}`,
        });
      }

      return items;
    }

    // Scope children (targets)
    if (element.type === 'scope') {
      const scopeName = element.label;
      const grouped = this.targetService.groupTargetsByScope(this.targets);
      const scopeTargets = grouped.get(scopeName) || [];
      return scopeTargets.map(createTargetItem);
    }

    // Other types have no children
    return [];
  }

  getParent(_element: TargetTreeItemData): vscode.ProviderResult<TargetTreeItemData> {
    // Not implementing parent navigation for now
    return undefined;
  }

  dispose(): void {
    // Dispose all event listeners to prevent memory leaks
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Factory function for backward compatibility
 * Creates and initializes the provider with singleton dependencies
 */
export function createTargetProvider(
  targetService?: ITargetService,
  authStateManager?: IAuthStateManager
): TargetProvider {
  const provider = new TargetProvider(targetService, authStateManager);
  provider.initialize();
  return provider;
}
