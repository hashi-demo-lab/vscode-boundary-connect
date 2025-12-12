/**
 * Sessions Webview Panel
 * Rich UI for managing Boundary sessions with distinctive design
 */

import * as vscode from 'vscode';
import { Session } from '../types';
import { getConnectionManager } from '../connection/connectionManager';
import { logger } from '../utils/logger';

interface WebviewMessage {
  command: 'disconnect' | 'disconnectAll' | 'copyPort';
  sessionId?: string;
  port?: string;
}

export class SessionsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'boundary.sessionsPanel';
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this._updateView();

    // Listen for session changes
    const connectionManager = getConnectionManager();
    this._disposables.push(
      connectionManager.onSessionsChanged(() => this._updateView())
    );

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        logger.info(`Sessions panel received message: ${JSON.stringify(message)}`);
        switch (message.command) {
          case 'disconnect':
            if (message.sessionId) {
              logger.info(`Disconnecting session: ${message.sessionId}`);
              try {
                await connectionManager.disconnect(message.sessionId);
                logger.info(`Session ${message.sessionId} disconnected successfully`);
              } catch (err) {
                logger.error(`Failed to disconnect session ${message.sessionId}:`, err);
              }
            } else {
              logger.warn('Disconnect message received but no sessionId provided');
            }
            break;
          case 'disconnectAll':
            logger.info('Disconnecting all sessions');
            await connectionManager.disconnectAll();
            break;
          case 'copyPort':
            if (message.port) {
              await vscode.env.clipboard.writeText(message.port);
              void vscode.window.showInformationMessage(`Port ${message.port} copied to clipboard`);
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private _updateView(): void {
    if (!this._view) {
      return;
    }

    const sessions = getConnectionManager().getActiveSessions();
    this._view.webview.html = this._getHtmlContent(sessions);
  }

  public refresh(): void {
    this._updateView();
  }

  private _getHtmlContent(sessions: Session[]): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Boundary Sessions</title>
  <style>
    /* CSS Custom Properties - Boundary Brand (Coral/Salmon Theme) */
    :root {
      --boundary-primary: #E76F51;
      --boundary-primary-hover: #D4644A;
      --boundary-accent: #F4A261;
      --boundary-success: #10B981;
      --boundary-warning: #F59E0B;
      --boundary-danger: #EF4444;
      --surface-elevated: var(--vscode-editor-background);
      --surface-card: var(--vscode-sideBar-background);
      --text-primary: var(--vscode-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --border-subtle: var(--vscode-widget-border);
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
      --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
      --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--text-primary);
      background: transparent;
      padding: 12px;
      line-height: 1.5;
    }

    /* Header Stats */
    .stats-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(135deg, #F4A261 0%, #E9967A 50%, #E76F51 100%);
      border-radius: var(--radius-md);
      margin-bottom: 16px;
      color: white;
      box-shadow: var(--shadow-md);
    }

    .stats-count {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .stats-number {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }

    .stats-label {
      font-size: 12px;
      opacity: 0.9;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .pulse-indicator {
      width: 10px;
      height: 10px;
      background: var(--boundary-success);
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
      box-shadow: 0 0 8px var(--boundary-success);
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.7; }
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-secondary);
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      opacity: 0.3;
    }

    .empty-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text-primary);
    }

    .empty-desc {
      font-size: 12px;
      line-height: 1.6;
    }

    /* Session Cards */
    .sessions-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .session-card {
      background: var(--surface-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 14px;
      transition: all var(--transition-fast);
      position: relative;
      overflow: hidden;
    }

    .session-card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--boundary-success);
      transition: width var(--transition-fast);
    }

    .session-card:hover {
      border-color: var(--boundary-primary);
      box-shadow: var(--shadow-sm);
    }

    .session-card:hover::before {
      width: 4px;
      background: var(--boundary-primary);
    }

    .session-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .session-target {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .session-target svg {
      width: 16px;
      height: 16px;
      color: var(--boundary-primary);
    }

    .session-type {
      font-size: 10px;
      padding: 2px 8px;
      background: var(--boundary-primary);
      color: white;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }

    .session-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      font-size: 11px;
      margin-bottom: 12px;
    }

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .detail-label {
      color: var(--text-secondary);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .detail-value {
      font-family: var(--vscode-editor-font-family), monospace;
      color: var(--text-primary);
      font-weight: 500;
    }

    .detail-value.port {
      color: var(--boundary-accent);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .detail-value.port:hover {
      text-decoration: underline;
    }

    .detail-value.port svg {
      width: 12px;
      height: 12px;
      opacity: 0;
      transition: opacity var(--transition-fast);
    }

    .detail-value.port:hover svg {
      opacity: 1;
    }

    /* Actions */
    .session-actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 500;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
      flex: 1;
    }

    .btn svg {
      width: 14px;
      height: 14px;
    }

    .btn-disconnect {
      background: transparent;
      border: 1px solid var(--boundary-danger);
      color: var(--boundary-danger);
    }

    .btn-disconnect:hover {
      background: var(--boundary-danger);
      color: white;
    }

    .btn-primary {
      background: var(--boundary-primary);
      color: white;
    }

    .btn-primary:hover {
      background: var(--boundary-primary-hover);
    }

    /* Disconnect All */
    .disconnect-all-wrapper {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-subtle);
    }

    .btn-danger-outline {
      background: transparent;
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      width: 100%;
    }

    .btn-danger-outline:hover {
      border-color: var(--boundary-danger);
      color: var(--boundary-danger);
      background: rgba(239, 68, 68, 0.1);
    }

    /* Animation for new sessions */
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .session-card {
      animation: slideIn var(--transition-smooth) ease-out;
    }
  </style>
</head>
<body>
  ${sessions.length > 0 ? this._renderSessions(sessions) : this._renderEmptyState()}

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // Expose functions globally for onclick handlers
      window.disconnect = function(sessionId) {
        vscode.postMessage({ command: 'disconnect', sessionId: sessionId });
      };

      window.disconnectAll = function() {
        vscode.postMessage({ command: 'disconnectAll' });
      };

      window.copyPort = function(port) {
        vscode.postMessage({ command: 'copyPort', port: port });
      };

      // Also attach event listeners as backup (delegated to body)
      document.body.addEventListener('click', function(event) {
        const target = event.target;
        const button = target.closest('.btn-disconnect');
        if (button) {
          const card = button.closest('.session-card');
          if (card) {
            const sessionId = card.dataset.sessionId;
            if (sessionId) {
              window.disconnect(sessionId);
            }
          }
        }

        const disconnectAllBtn = target.closest('.btn-danger-outline');
        if (disconnectAllBtn) {
          window.disconnectAll();
        }

        const portEl = target.closest('.detail-value.port');
        if (portEl) {
          const port = portEl.textContent.replace(':', '').trim();
          if (port) {
            window.copyPort(port);
          }
        }
      });
    })();
  </script>
</body>
</html>`;
  }

  private _renderSessions(sessions: Session[]): string {
    const sessionCards = sessions.map(session => {
      // Escape values for safe use in JavaScript onclick handlers
      const safeSessionId = this._escapeJsString(session.id);
      const safePort = this._escapeJsString(String(session.localPort));

      return `
      <div class="session-card" data-session-id="${this._escapeHtml(session.id)}">
        <div class="session-header">
          <span class="session-target">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            ${this._escapeHtml(session.targetName)}
          </span>
          <span class="session-type">${this._escapeHtml(session.targetType.toUpperCase())}</span>
        </div>
        <div class="session-details">
          <div class="detail-item">
            <span class="detail-label">Local Port</span>
            <span class="detail-value port" onclick="copyPort('${safePort}')" title="Click to copy">
              :${this._escapeHtml(String(session.localPort))}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Session ID</span>
            <span class="detail-value">${this._escapeHtml(session.id.slice(0, 8))}...</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="btn btn-disconnect" onclick="disconnect('${safeSessionId}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
              <line x1="12" y1="2" x2="12" y2="12"/>
            </svg>
            Disconnect
          </button>
        </div>
      </div>
    `;
    }).join('');

    return `
      <div class="stats-bar">
        <div class="stats-count">
          <span class="stats-number">${sessions.length}</span>
          <span class="stats-label">Active<br/>Session${sessions.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="pulse-indicator"></div>
      </div>
      <div class="sessions-list">
        ${sessionCards}
      </div>
      ${sessions.length > 1 ? `
        <div class="disconnect-all-wrapper">
          <button class="btn btn-danger-outline" onclick="disconnectAll()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Disconnect All Sessions
          </button>
        </div>
      ` : ''}
    `;
  }

  private _renderEmptyState(): string {
    return `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L3 7v6c0 5.25 3.75 9.74 9 11 5.25-1.26 9-5.75 9-11V7l-9-5z"/>
          <circle cx="12" cy="11" r="3"/>
        </svg>
        <div class="empty-title">No Active Sessions</div>
        <div class="empty-desc">
          Connect to a target from the<br/>
          Targets panel to start a session.
        </div>
      </div>
    `;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Escape a string for safe use in JavaScript string literals.
   * Prevents XSS when inserting values into onclick handlers.
   */
  private _escapeJsString(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/</g, '\\x3c')
      .replace(/>/g, '\\x3e');
  }

  public dispose(): void {
    for (const disposable of this._disposables) {
      disposable.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Singleton
let panelProvider: SessionsPanelProvider | undefined;

export function createSessionsPanelProvider(extensionUri: vscode.Uri): SessionsPanelProvider {
  if (!panelProvider) {
    panelProvider = new SessionsPanelProvider(extensionUri);
  }
  return panelProvider;
}

export function getSessionsPanelProvider(): SessionsPanelProvider | undefined {
  return panelProvider;
}

export function disposeSessionsPanelProvider(): void {
  if (panelProvider) {
    panelProvider.dispose();
    panelProvider = undefined;
  }
}
