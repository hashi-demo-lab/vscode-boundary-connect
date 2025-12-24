/**
 * Recording TreeDataProvider for the sidebar
 *
 * Design principles:
 * 1. Does NOT manage auth state - delegates to AuthManager
 * 2. Listens to auth state changes via AuthStateManager
 * 3. Handles display/UI concerns only
 */

import * as vscode from 'vscode';
import { SessionRecording, IAuthManager, IAuthStateManager, IRecordingProvider, IRecordingService, RecordingTreeItemData, IBoundaryCLI } from '../types';
import { RecordingTreeItem, createErrorItem, createLoadingItem, createRecordingItem, createTargetGroupItem } from './recordingItem';
import { getRecordingService } from './recordingService';
import { logger } from '../utils/logger';
import { isAuthRequired } from '../utils/errors';
import { AuthState, getAuthStateManager } from '../auth/authState';
import { getConfigurationService } from '../utils/config';
import { getBoundaryCLI } from '../boundary/cli';

export class RecordingProvider implements IRecordingProvider {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RecordingTreeItemData | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private authManager: IAuthManager | undefined;
  private loading = false;
  private error: string | undefined;
  private recordings: SessionRecording[] = [];

  // Store disposables to prevent memory leaks
  private readonly disposables: vscode.Disposable[] = [];

  // Injected dependencies (with lazy fallbacks for backward compatibility)
  private readonly recordingService: IRecordingService;
  private readonly authStateManager: IAuthStateManager;
  private readonly cli: IBoundaryCLI;
  private initialized = false;

  /**
   * Create a new RecordingProvider
   * @param recordingService - Recording service (optional for backward compatibility)
   * @param authStateManager - Auth state manager (optional for backward compatibility)
   * @param cli - Boundary CLI (optional for backward compatibility)
   */
  constructor(
    recordingService?: IRecordingService,
    authStateManager?: IAuthStateManager,
    cli?: IBoundaryCLI
  ) {
    this.recordingService = recordingService ?? getRecordingService();
    this.authStateManager = authStateManager ?? getAuthStateManager();
    this.cli = cli ?? getBoundaryCLI();
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

    // Listen for recording changes - store disposable for cleanup
    this.disposables.push(
      this.recordingService.onRecordingsChanged(() => {
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

    return 'Failed to fetch recordings';
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
    logger.debug(`RecordingProvider: auth state changed to ${state}`);

    if (state === 'authenticated') {
      // Only fetch recordings if address is configured
      if (this.isAddressConfigured()) {
        void this.fetchRecordings();
      } else {
        logger.warn('RecordingProvider: skipping recording fetch - address not configured');
        // Clear and show welcome view
        this.recordings = [];
        this.error = undefined;
        this._onDidChangeTreeData.fire();
      }
    } else {
      // Clear recordings when not authenticated
      this.recordings = [];
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
    logger.info('RecordingProvider.refresh() called');
    logger.info(`RecordingProvider: isAddressConfigured=${this.isAddressConfigured()}, isAuthenticated=${this.isAuthenticated}`);

    // Only fetch if address is configured and authenticated
    if (this.isAddressConfigured() && this.isAuthenticated) {
      logger.info('RecordingProvider: Starting fetch...');
      void this.fetchRecordings();
    } else {
      logger.warn('RecordingProvider: Skipping fetch - not configured or not authenticated');
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * Fetch recordings from all org scopes
   * Session recordings are listed at the org scope level
   */
  private async fetchRecordings(): Promise<void> {
    logger.info('RecordingProvider.fetchRecordings() START');
    this.loading = true;
    this.error = undefined;
    this._onDidChangeTreeData.fire();

    try {
      // Fetch recordings from global scope
      // Session recordings are stored at global scope level in Boundary
      logger.info('RecordingProvider: Fetching recordings from global scope');
      const globalRecordings = await this.recordingService.getRecordings('global', true);
      logger.info(`RecordingProvider: Found ${globalRecordings.length} recordings in global scope`);

      this.recordings = globalRecordings;
      this.error = undefined;
    } catch (err) {
      logger.error('Failed to fetch recordings:', err);

      if (isAuthRequired(err)) {
        logger.info('Auth required error - delegating to authManager');

        // Delegate to authManager - DO NOT mutate state here
        if (this.authManager) {
          this.authManager.handleTokenExpired();
        }

        // Clear local display state
        this.error = undefined;
        this.recordings = [];

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

  getTreeItem(element: RecordingTreeItemData): vscode.TreeItem {
    return new RecordingTreeItem(element);
  }

  getChildren(element?: RecordingTreeItemData): RecordingTreeItemData[] {
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

      // No recordings
      if (this.recordings.length === 0) {
        return [createErrorItem('No recordings available')];
      }

      // Group recordings by target
      const grouped = this.recordingService.groupRecordingsByTarget(this.recordings);
      const items: RecordingTreeItemData[] = [];

      for (const [targetId, targetRecordings] of grouped) {
        // Use target name from first recording if available
        const targetName = targetRecordings[0]?.targetName;

        items.push(createTargetGroupItem(targetId, targetName, targetRecordings.length));
      }

      return items;
    }

    // Target group children (recordings)
    if (element.type === 'target-group' && element.targetId) {
      const grouped = this.recordingService.groupRecordingsByTarget(this.recordings);
      const groupRecordings = grouped.get(element.targetId) || [];

      // Sort by created time (newest first)
      const sorted = [...groupRecordings].sort((a, b) => {
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
      });

      return sorted.map(createRecordingItem);
    }

    // Other types have no children
    return [];
  }

  getParent(_element: RecordingTreeItemData): vscode.ProviderResult<RecordingTreeItemData> {
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
export function createRecordingProvider(
  recordingService?: IRecordingService,
  authStateManager?: IAuthStateManager,
  cli?: IBoundaryCLI
): RecordingProvider {
  const provider = new RecordingProvider(recordingService, authStateManager, cli);
  provider.initialize();
  return provider;
}
