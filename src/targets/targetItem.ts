/**
 * Target TreeItem implementations
 */

import * as vscode from 'vscode';
import { BoundaryScope, BoundaryTarget, TargetTreeItemData, TargetTreeItemType } from '../types';

export class TargetTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: TargetTreeItemData
  ) {
    super(data.label, TargetTreeItem.getCollapsibleState(data.type));

    this.id = data.id;
    this.description = data.description;
    this.tooltip = data.tooltip || data.label;
    this.contextValue = data.type;

    // Enable decorations for targets via custom URI scheme
    if (data.type === 'target' && data.target) {
      this.resourceUri = vscode.Uri.parse(`boundary-target:${data.target.id}`);
    }

    this.setIcon(data.type);
    this.setCommand(data);
  }

  private static getCollapsibleState(type: TargetTreeItemType): vscode.TreeItemCollapsibleState {
    switch (type) {
      case 'scope':
        return vscode.TreeItemCollapsibleState.Expanded;
      case 'project':
        return vscode.TreeItemCollapsibleState.Collapsed;
      case 'target':
      case 'loading':
      case 'error':
      case 'login':
        return vscode.TreeItemCollapsibleState.None;
      default:
        return vscode.TreeItemCollapsibleState.None;
    }
  }

  private setIcon(type: TargetTreeItemType): void {
    switch (type) {
      case 'scope':
        this.iconPath = new vscode.ThemeIcon('folder');
        break;
      case 'project':
        this.iconPath = new vscode.ThemeIcon('folder-library');
        break;
      case 'target':
        this.iconPath = new vscode.ThemeIcon('hubot');
        break;
      case 'loading':
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error');
        break;
      case 'login':
        this.iconPath = new vscode.ThemeIcon('sign-in');
        break;
    }
  }

  private setCommand(data: TargetTreeItemData): void {
    switch (data.type) {
      // Targets use right-click context menu only (no single-click action)
      case 'login':
        this.command = {
          command: 'boundary.login',
          title: 'Login',
        };
        break;
      case 'error':
        this.command = {
          command: 'boundary.refresh',
          title: 'Refresh',
        };
        break;
    }
  }
}

/**
 * Create a TreeItem for a scope
 */
export function createScopeItem(scope: BoundaryScope): TargetTreeItemData {
  return {
    type: 'scope',
    id: scope.id,
    label: scope.name,
    description: scope.type === 'org' ? 'Organization' : 'Scope',
    tooltip: scope.description || scope.name,
    scope,
  };
}

/**
 * Create a TreeItem for a target
 */
export function createTargetItem(target: BoundaryTarget): TargetTreeItemData {
  const portInfo = target.defaultPort ? `:${target.defaultPort}` : '';
  const typeLabel = target.type.toUpperCase();

  return {
    type: 'target',
    id: target.id,
    label: target.name,
    description: `${typeLabel}${portInfo}`,
    tooltip: createTargetTooltip(target),
    target,
  };
}

function createTargetTooltip(target: BoundaryTarget): string {
  const lines = [
    target.name,
    `Type: ${target.type.toUpperCase()}`,
  ];

  if (target.description) {
    lines.push(`Description: ${target.description}`);
  }

  if (target.defaultPort) {
    lines.push(`Port: ${target.defaultPort}`);
  }

  if (target.address) {
    lines.push(`Address: ${target.address}`);
  }

  lines.push(`Scope: ${target.scope.name}`);

  return lines.join('\n');
}

/**
 * Create a loading item
 */
export function createLoadingItem(): TargetTreeItemData {
  return {
    type: 'loading',
    id: 'loading',
    label: 'Loading targets...',
  };
}

/**
 * Create an error item (clickable to refresh)
 */
export function createErrorItem(message: string): TargetTreeItemData {
  return {
    type: 'error',
    id: 'error',
    label: message,
    description: 'Click to refresh',
    tooltip: 'Click to retry loading targets',
  };
}

/**
 * Create a login prompt item
 */
export function createLoginItem(): TargetTreeItemData {
  return {
    type: 'login',
    id: 'login',
    label: 'Click to login to Boundary',
    tooltip: 'Authentication required to view targets',
  };
}
