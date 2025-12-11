/**
 * Remote SSH integration
 */

import * as vscode from 'vscode';
import { IRemoteSSHIntegration, RemoteSSHConnectionOptions } from '../types';
import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { logger } from '../utils/logger';

const REMOTE_SSH_EXTENSION_ID = 'ms-vscode-remote.remote-ssh';

/**
 * Check if Remote SSH extension is installed
 */
export function isRemoteSSHInstalled(): boolean {
  const extension = vscode.extensions.getExtension(REMOTE_SSH_EXTENSION_ID);
  return extension !== undefined;
}

/**
 * Prompt user to install Remote SSH extension
 */
export async function promptInstallRemoteSSH(): Promise<boolean> {
  const action = await vscode.window.showWarningMessage(
    'Remote SSH extension is required to connect to Boundary targets. Would you like to install it?',
    'Install',
    'Cancel'
  );

  if (action === 'Install') {
    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      REMOTE_SSH_EXTENSION_ID
    );
    return true;
  }

  return false;
}

/**
 * Trigger Remote SSH connection to localhost proxy
 */
export async function triggerRemoteSSH(options: RemoteSSHConnectionOptions): Promise<void> {
  logger.info(`Triggering Remote SSH to ${options.host}:${options.port}`);

  // Check if Remote SSH is installed
  if (!isRemoteSSHInstalled()) {
    const installed = await promptInstallRemoteSSH();
    if (!installed) {
      throw new BoundaryError(
        'Remote SSH extension is required',
        BoundaryErrorCode.REMOTE_SSH_NOT_INSTALLED
      );
    }

    // Wait a moment for extension to activate
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Recheck
    if (!isRemoteSSHInstalled()) {
      throw new BoundaryError(
        'Remote SSH extension installation failed',
        BoundaryErrorCode.REMOTE_SSH_NOT_INSTALLED
      );
    }
  }

  // Ensure extension is active
  const extension = vscode.extensions.getExtension(REMOTE_SSH_EXTENSION_ID);
  if (extension && !extension.isActive) {
    await extension.activate();
  }

  // Try primary method: opensshremotes.openEmptyWindow
  try {
    await vscode.commands.executeCommand('opensshremotes.openEmptyWindow', {
      host: `${options.host}:${options.port}`,
      userName: options.userName,
    });
    logger.info('Remote SSH connection triggered via openEmptyWindow');
    return;
  } catch (error) {
    logger.warn('Failed to use openEmptyWindow, trying fallback:', error);
  }

  // Fallback: Use URI scheme
  try {
    const hostWithPort = options.userName
      ? `${options.userName}@${options.host}:${options.port}`
      : `${options.host}:${options.port}`;

    const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostWithPort}/`);

    await vscode.commands.executeCommand('vscode.openFolder', uri, {
      forceNewWindow: true,
    });

    logger.info('Remote SSH connection triggered via URI scheme');
    return;
  } catch (error) {
    logger.error('Failed to trigger Remote SSH via URI scheme:', error);
  }

  // Final fallback: Show manual connection instructions
  const port = options.port;
  const message = `Connection established on localhost:${port}. ` +
    'Use Remote SSH to connect to this address.';

  void vscode.window.showInformationMessage(message, 'Open Remote SSH').then(action => {
    if (action === 'Open Remote SSH') {
      void vscode.commands.executeCommand('opensshremotes.openEmptyWindow');
    }
  });
}

/**
 * Remote SSH integration service
 */
export class RemoteSSHIntegration implements IRemoteSSHIntegration {
  isInstalled(): boolean {
    return isRemoteSSHInstalled();
  }

  async promptInstall(): Promise<boolean> {
    return promptInstallRemoteSSH();
  }

  async connect(options: RemoteSSHConnectionOptions): Promise<void> {
    return triggerRemoteSSH(options);
  }
}
