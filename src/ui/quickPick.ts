/**
 * QuickPick utilities for target selection
 */

import * as vscode from 'vscode';
import { AuthMethod, BoundaryTarget, Session } from '../types';
import { getTargetService } from '../targets/targetService';
import { getConnectionManager } from '../connection/connectionManager';
import { getSessionLabel, getSessionDescription } from '../connection/session';
import { logger } from '../utils/logger';

/**
 * Show auth method picker
 */
export async function showAuthMethodPicker(): Promise<AuthMethod | undefined> {
  const items: vscode.QuickPickItem[] = [
    {
      label: '$(key) OIDC',
      description: 'Authenticate via browser (recommended)',
      detail: 'Opens your browser to authenticate with your identity provider',
    },
    {
      label: '$(lock) Password',
      description: 'Authenticate with username and password',
      detail: 'Enter your Boundary username and password',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select authentication method',
    title: 'Boundary: Login',
  });

  if (!selected) {
    return undefined;
  }

  if (selected.label.includes('OIDC')) {
    return 'oidc';
  } else if (selected.label.includes('Password')) {
    return 'password';
  }

  return undefined;
}

/**
 * Show target picker
 */
export async function showTargetPicker(): Promise<BoundaryTarget | undefined> {
  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { target?: BoundaryTarget }>();
  quickPick.placeholder = 'Search for a target...';
  quickPick.title = 'Boundary: Connect to Target';
  quickPick.busy = true;
  quickPick.show();

  try {
    const targets = await getTargetService().getAllTargets();

    if (targets.length === 0) {
      quickPick.hide();
      void vscode.window.showInformationMessage('No targets available');
      return undefined;
    }

    // Group by scope
    const grouped = getTargetService().groupTargetsByScope(targets);
    const items: (vscode.QuickPickItem & { target?: BoundaryTarget })[] = [];

    for (const [scopeName, scopeTargets] of grouped) {
      // Add separator
      items.push({
        label: scopeName,
        kind: vscode.QuickPickItemKind.Separator,
      });

      // Add targets
      for (const target of scopeTargets) {
        items.push({
          label: `$(server) ${target.name}`,
          description: `${target.type.toUpperCase()}${target.defaultPort ? `:${target.defaultPort}` : ''}`,
          detail: target.description,
          target,
        });
      }
    }

    quickPick.items = items;
    quickPick.busy = false;

    return new Promise((resolve) => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        quickPick.hide();
        resolve(selected?.target);
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });
    });
  } catch (error) {
    quickPick.hide();
    logger.error('Failed to load targets for picker:', error);
    void vscode.window.showErrorMessage('Failed to load targets');
    return undefined;
  }
}

/**
 * Show session picker for disconnect
 */
export async function showSessionPicker(): Promise<Session | undefined> {
  const sessions = getConnectionManager().getActiveSessions();

  if (sessions.length === 0) {
    void vscode.window.showInformationMessage('No active sessions');
    return undefined;
  }

  const items: (vscode.QuickPickItem & { session: Session })[] = sessions.map(session => ({
    label: `$(plug) ${getSessionLabel(session)}`,
    description: getSessionDescription(session),
    detail: `Session ID: ${session.id}`,
    session,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a session to disconnect',
    title: 'Boundary: Sessions',
  });

  return selected?.session;
}

/**
 * Show sessions list with actions
 */
export async function showSessionsList(): Promise<void> {
  const sessions = getConnectionManager().getActiveSessions();

  if (sessions.length === 0) {
    void vscode.window.showInformationMessage('No active Boundary sessions');
    return;
  }

  const items: (vscode.QuickPickItem & { action?: string; session?: Session })[] = [];

  // Add sessions
  for (const session of sessions) {
    items.push({
      label: `$(plug) ${getSessionLabel(session)}`,
      description: getSessionDescription(session),
      detail: `localhost:${session.localPort}`,
      session,
      action: 'disconnect',
    });
  }

  // Add separator
  items.push({
    label: 'Actions',
    kind: vscode.QuickPickItemKind.Separator,
  });

  // Add disconnect all option if multiple sessions
  if (sessions.length > 1) {
    items.push({
      label: '$(debug-disconnect) Disconnect All',
      description: `Disconnect all ${sessions.length} sessions`,
      action: 'disconnectAll',
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a session to manage',
    title: `Boundary Sessions (${sessions.length})`,
  });

  if (!selected) {
    return;
  }

  if (selected.action === 'disconnectAll') {
    await getConnectionManager().disconnectAll();
    void vscode.window.showInformationMessage('All sessions disconnected');
  } else if (selected.action === 'disconnect' && selected.session) {
    await getConnectionManager().disconnect(selected.session.id);
    void vscode.window.showInformationMessage(`Disconnected from ${selected.session.targetName}`);
  }
}
