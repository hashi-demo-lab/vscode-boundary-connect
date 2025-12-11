/**
 * Target TreeDataProvider for the sidebar
 */

import * as vscode from 'vscode';
import { BoundaryTarget, ITargetProvider, TargetTreeItemData } from '../types';
import { TargetTreeItem, createErrorItem, createLoadingItem, createLoginItem, createTargetItem } from './targetItem';
import { getTargetService } from './targetService';
import { logger } from '../utils/logger';
import { isAuthRequired } from '../utils/errors';

export class TargetProvider implements ITargetProvider {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TargetTreeItemData | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private authenticated = false;
  private loading = false;
  private error: string | undefined;
  private targets: BoundaryTarget[] = [];

  constructor() {
    // Listen for target changes
    getTargetService().onTargetsChanged(() => {
      this.refresh();
    });
  }

  setAuthenticated(authenticated: boolean): void {
    if (this.authenticated !== authenticated) {
      this.authenticated = authenticated;
      if (authenticated) {
        // Fetch targets when authenticated
        void this.fetchTargets();
      } else {
        this.targets = [];
        this.error = undefined;
      }
      this._onDidChangeTreeData.fire();
    }
  }

  refresh(): void {
    if (this.authenticated) {
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
      this.targets = await getTargetService().getAllTargets(true);
      this.error = undefined;
    } catch (err) {
      logger.error('Failed to fetch targets:', err);

      if (isAuthRequired(err)) {
        logger.info('Auth required - clearing auth state and prompting re-login');
        this.authenticated = false;
        this.error = undefined;
        this.targets = [];
        await vscode.commands.executeCommand('setContext', 'boundary.authenticated', false);

        // Prompt user to re-login
        const action = await vscode.window.showWarningMessage(
          'Your Boundary session has expired. Please sign in again.',
          'Sign In'
        );
        if (action === 'Sign In') {
          void vscode.commands.executeCommand('boundary.login');
        }
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
      if (!this.authenticated) {
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
      const grouped = getTargetService().groupTargetsByScope(this.targets);
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
      const grouped = getTargetService().groupTargetsByScope(this.targets);
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
    this._onDidChangeTreeData.dispose();
  }
}

// Factory function
export function createTargetProvider(): TargetProvider {
  return new TargetProvider();
}
