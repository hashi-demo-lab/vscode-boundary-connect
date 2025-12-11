/**
 * Status Bar Manager
 */

import * as vscode from 'vscode';
import { IStatusBarManager } from '../types';

export class StatusBarManager implements IStatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private sessionCount = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'boundary.showSessions';
    this.reset();
  }

  updateSessionCount(count: number): void {
    this.sessionCount = count;

    if (count === 0) {
      this.reset();
    } else {
      this.statusBarItem.text = `$(plug) Boundary: ${count} session${count !== 1 ? 's' : ''}`;
      this.statusBarItem.tooltip = 'Click to manage Boundary sessions';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
    }
  }

  showConnecting(targetName: string): void {
    this.statusBarItem.text = `$(loading~spin) Connecting to ${targetName}...`;
    this.statusBarItem.tooltip = 'Establishing connection';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  showError(message: string): void {
    this.statusBarItem.text = `$(error) Boundary: ${message}`;
    this.statusBarItem.tooltip = message;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBarItem.show();

    // Reset after 5 seconds
    setTimeout(() => {
      this.updateSessionCount(this.sessionCount);
    }, 5000);
  }

  reset(): void {
    if (this.sessionCount === 0) {
      this.statusBarItem.hide();
    } else {
      this.updateSessionCount(this.sessionCount);
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}

// Singleton
let statusBarInstance: StatusBarManager | undefined;

export function getStatusBarManager(): StatusBarManager {
  if (!statusBarInstance) {
    statusBarInstance = new StatusBarManager();
  }
  return statusBarInstance;
}

export function disposeStatusBarManager(): void {
  if (statusBarInstance) {
    statusBarInstance.dispose();
    statusBarInstance = undefined;
  }
}
