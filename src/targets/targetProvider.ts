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
import { getConfigurationService } from '../utils/config';

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
   * Extract a user-friendly error message from an error
   * Handles BoundaryError with getUserMessage() and parses JSON error responses
   */
  private extractUserFriendlyError(err: unknown): string {
    // Import BoundaryError dynamically to avoid circular deps at module level
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { BoundaryError } = require('../utils/errors') as { BoundaryError: typeof import('../utils/errors').BoundaryError };

    // Use BoundaryError's getUserMessage() if available
    if (err instanceof BoundaryError) {
      return err.getUserMessage();
    }

    if (err instanceof Error) {
      const message = err.message;

      // Check if message is JSON (raw API error response)
      if (message.startsWith('{')) {
        try {
          const parsed = JSON.parse(message) as {
            api_error?: { message?: string };
            error?: { message?: string };
            context?: string;
          };
          // Extract meaningful parts from API error response
          if (parsed.api_error?.message) {
            return parsed.api_error.message;
          }
          if (parsed.error?.message) {
            return parsed.error.message;
          }
          if (parsed.context) {
            return parsed.context;
          }
        } catch {
          // Not valid JSON, use message as-is but truncate if too long
        }
      }

      // Truncate very long messages for display
      if (message.length > 100) {
        return message.substring(0, 97) + '...';
      }

      return message;
    }

    return 'Failed to fetch targets';
  }

  /**
   * Check if Boundary address is configured (setting or env var)
   */
  private isAddressConfigured(): boolean {
    const config = getConfigurationService();
    const addrSetting = config.get('addr');
    const addrEnvVar = process.env.BOUNDARY_ADDR;
    return !!(addrSetting || addrEnvVar);
  }

  /**
   * Handle auth state changes from the state manager
   */
  private handleAuthStateChange(state: AuthState): void {
    logger.debug(`TargetProvider: auth state changed to ${state}`);

    if (state === 'authenticated') {
      // Only fetch targets if address is configured
      if (this.isAddressConfigured()) {
        void this.fetchTargets();
      } else {
        logger.warn('TargetProvider: skipping target fetch - address not configured');
        // Clear and show welcome view
        this.targets = [];
        this.error = undefined;
        this._onDidChangeTreeData.fire();
      }
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
    // Only fetch if address is configured and authenticated
    if (this.isAddressConfigured() && this.isAuthenticated) {
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
        // Use user-friendly message from BoundaryError if available
        this.error = this.extractUserFriendlyError(err);
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
      // Address not configured - return empty to show welcome view
      if (!this.isAddressConfigured()) {
        return [];
      }

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
