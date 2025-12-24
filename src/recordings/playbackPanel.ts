/**
 * Session Recording Playback Panel
 * Uses asciinema-player to render Boundary session recordings
 */

import * as vscode from 'vscode';
import { SessionRecording, IBoundaryCLI } from '../types';
import { logger } from '../utils/logger';

interface WebviewMessage {
  command: 'ready' | 'error';
  error?: string;
}

export class PlaybackPanel {
  public static currentPanel: PlaybackPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static async createOrShow(
    extensionUri: vscode.Uri,
    cli: IBoundaryCLI,
    recording: SessionRecording
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (PlaybackPanel.currentPanel) {
      PlaybackPanel.currentPanel._panel.reveal(column);
      // Load new recording
      await PlaybackPanel.currentPanel._loadRecording(cli, recording);
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      'boundaryPlayback',
      `Recording: ${recording.targetName || recording.id}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true, // Keep player state when hidden
      }
    );

    PlaybackPanel.currentPanel = new PlaybackPanel(panel, extensionUri);
    await PlaybackPanel.currentPanel._loadRecording(cli, recording);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set initial HTML content (loading state)
    this._panel.webview.html = this._getLoadingHtml();

    // Listen for disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        switch (message.command) {
          case 'ready':
            logger.info('Playback webview ready');
            break;
          case 'error':
            logger.error('Playback error:', message.error);
            void vscode.window.showErrorMessage(`Playback error: ${message.error}`);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private async _loadRecording(cli: IBoundaryCLI, recording: SessionRecording): Promise<void> {
    try {
      // Show loading state
      this._panel.webview.html = this._getLoadingHtml();
      this._panel.title = `Loading: ${recording.targetName || recording.id}`;

      // Download recording in asciicast format
      logger.info(`Downloading recording ${recording.id} for playback`);
      const asciicast = await cli.downloadRecording(recording.id);

      // Update title
      const createdDate = new Date(recording.createdTime).toLocaleString();
      this._panel.title = `${recording.targetName || 'Recording'} - ${createdDate}`;

      // Render playback UI
      this._panel.webview.html = this._getPlaybackHtml(asciicast, recording);
    } catch (error) {
      logger.error('Failed to load recording:', error);
      this._panel.webview.html = this._getErrorHtml(
        error instanceof Error ? error.message : 'Failed to load recording'
      );
    }
  }

  private _getLoadingHtml(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <title>Loading Recording</title>
  <style nonce="${nonce}">
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    .loading {
      text-align: center;
    }
    .spinner {
      border: 3px solid var(--vscode-widget-border);
      border-top: 3px solid #E76F51;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <div>Loading recording...</div>
  </div>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
  <title>Error</title>
  <style nonce="${nonce}">
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    .error {
      text-align: center;
      max-width: 500px;
      padding: 20px;
    }
    .error-icon {
      font-size: 48px;
      margin-bottom: 16px;
      color: #EF4444;
    }
    .error-message {
      color: var(--vscode-errorForeground);
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="error">
    <div class="error-icon">⚠️</div>
    <h2>Failed to Load Recording</h2>
    <div class="error-message">${escapeHtml(message)}</div>
  </div>
</body>
</html>`;
  }

  private _getPlaybackHtml(asciicast: string, recording: SessionRecording): string {
    const nonce = getNonce();

    // Use CDN for asciinema-player to avoid CSP issues with local resources
    // Version 3.13.5 (same as in package.json)
    const playerCss = 'https://cdn.jsdelivr.net/npm/asciinema-player@3.13.5/dist/bundle/asciinema-player.min.css';
    const playerJs = 'https://cdn.jsdelivr.net/npm/asciinema-player@3.13.5/dist/bundle/asciinema-player.min.js';

    logger.debug(`Playback panel - using CDN for asciinema-player v3.13.5`);

    // Asciicast v2 format is a text format with newline-separated JSON:
    // - First line: header JSON object
    // - Subsequent lines: event arrays [time, type, data]
    // The player expects this raw string format, not a parsed object

    // Safely embed the raw asciicast string in the HTML
    // Use JSON.stringify to properly escape the string for embedding
    const asciicastData = JSON.stringify(asciicast);

    const createdDate = new Date(recording.createdTime).toLocaleString();
    const duration = recording.duration || 'unknown';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src https://cdn.jsdelivr.net 'unsafe-inline'; script-src https://cdn.jsdelivr.net 'unsafe-inline' 'wasm-unsafe-eval'; img-src data:;">
  <title>Session Recording</title>
  <link rel="stylesheet" type="text/css" href="${playerCss}">
  <style nonce="${nonce}">
    :root {
      --boundary-primary: #E76F51;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 20px;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .header {
      background: linear-gradient(135deg, #F4A261 0%, #E9967A 50%, #E76F51 100%);
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 20px;
      color: white;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .recording-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .recording-icon {
      width: 24px;
      height: 24px;
    }

    .recording-meta {
      display: flex;
      gap: 24px;
      font-size: 12px;
      opacity: 0.95;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .player-container {
      flex: 1;
      background: #000;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
    }

    #player {
      flex: 1;
      width: 100%;
    }

    /* Override asciinema-player styles to match VS Code theme */
    .asciinema-player-wrapper {
      height: 100%;
    }

    .asciinema-terminal {
      background: #000 !important;
    }

    .error-state {
      padding: 40px;
      text-align: center;
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="recording-title">
      <svg class="recording-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="3" fill="currentColor"/>
      </svg>
      <span>${escapeHtml(recording.targetName || recording.id)}</span>
    </div>
    <div class="recording-meta">
      <div class="meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>${escapeHtml(createdDate)}</span>
      </div>
      <div class="meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span>Duration: ${escapeHtml(duration)}</span>
      </div>
    </div>
  </div>

  <div class="player-container">
    <div id="player"></div>
  </div>

  <script>
    console.log('Attempting to load player from: ${playerJs}');
    console.log('Window location:', window.location.href);
  </script>
  <script src="${playerJs}" onload="console.log('Player script loaded successfully, AsciinemaPlayer =', typeof AsciinemaPlayer)" onerror="console.error('Failed to load player script from ${playerJs}')"></script>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      // Wait for DOM and ensure AsciinemaPlayer is available
      function initPlayer() {
        try {
          console.log('initPlayer called, typeof AsciinemaPlayer =', typeof AsciinemaPlayer);
          console.log('window.AsciinemaPlayer =', window.AsciinemaPlayer);
          console.log('All window keys:', Object.keys(window).filter(k => k.toLowerCase().includes('ascii')));

          // Check if AsciinemaPlayer is available
          if (typeof AsciinemaPlayer === 'undefined') {
            throw new Error('AsciinemaPlayer library not loaded. Please check that asciinema-player package is installed.');
          }

          // Asciicast data is embedded as a raw string
          const asciicastString = ${asciicastData};

          console.log('Creating player with asciicast string (length:', asciicastString.length, ')');
          console.log('First 200 chars:', asciicastString.substring(0, 200));

          // Create player with the raw asciicast string
          // asciinema-player v3 expects { data: <asciicast-string> } as the src parameter
          AsciinemaPlayer.create({ data: asciicastString }, document.getElementById('player'), {
            autoPlay: false,
            loop: false,
            fit: 'both',
            theme: 'custom', // Use custom theme to match VS Code
            speed: 1
          });

          vscode.postMessage({ command: 'ready' });
        } catch (error) {
          console.error('Failed to initialize player:', error);
          document.getElementById('player').innerHTML =
            '<div class="error-state">Failed to load recording: ' + error.message + '</div>';
          vscode.postMessage({ command: 'error', error: error.message });
        }
      }

      // Try to initialize immediately, or wait for window load
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initPlayer);
      } else {
        initPlayer();
      }
    })();
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    PlaybackPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
