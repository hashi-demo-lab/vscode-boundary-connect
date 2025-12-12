/**
 * Tree Item Decoration Provider
 * Provides visual indicators for connected targets
 */

import * as vscode from 'vscode';
import { getConnectionManager } from '../connection/connectionManager';

export class TargetDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private _disposables: vscode.Disposable[] = [];
  private _connectedTargetIds = new Set<string>();

  constructor() {
    // Listen for session changes
    const connectionManager = getConnectionManager();
    this._disposables.push(
      connectionManager.onSessionsChanged((sessions) => {
        const newConnectedIds = new Set(sessions.map(s => s.targetId));

        // Find changed targets
        const changedIds = new Set<string>();

        // Newly connected
        for (const id of newConnectedIds) {
          if (!this._connectedTargetIds.has(id)) {
            changedIds.add(id);
          }
        }

        // Newly disconnected
        for (const id of this._connectedTargetIds) {
          if (!newConnectedIds.has(id)) {
            changedIds.add(id);
          }
        }

        this._connectedTargetIds = newConnectedIds;

        // Fire change event for affected URIs
        if (changedIds.size > 0) {
          const uris = Array.from(changedIds).map(id =>
            vscode.Uri.parse(`boundary-target:${id}`)
          );
          this._onDidChangeFileDecorations.fire(uris);
        }
      })
    );
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'boundary-target') {
      return undefined;
    }

    const targetId = uri.path || uri.authority;

    if (this._connectedTargetIds.has(targetId)) {
      return {
        badge: '●',
        tooltip: 'Connected - Active session',
        color: new vscode.ThemeColor('boundary.connectedBadge'),
      };
    }

    return undefined;
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
    for (const disposable of this._disposables) {
      disposable.dispose();
    }
  }
}

// Singleton
let decorationProvider: TargetDecorationProvider | undefined;

export function getTargetDecorationProvider(): TargetDecorationProvider {
  if (!decorationProvider) {
    decorationProvider = new TargetDecorationProvider();
  }
  return decorationProvider;
}

export function disposeTargetDecorationProvider(): void {
  if (decorationProvider) {
    decorationProvider.dispose();
    decorationProvider = undefined;
  }
}
