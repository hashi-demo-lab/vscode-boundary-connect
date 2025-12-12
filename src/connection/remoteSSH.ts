/**
 * Remote SSH integration
 *
 * Handles connecting VS Code Remote SSH to Boundary proxy sessions.
 * Creates dynamic SSH config entries since Remote SSH doesn't handle
 * host:port format directly in URIs.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IRemoteSSHIntegration, RemoteSSHConnectionOptions } from '../types';
import { BoundaryError, BoundaryErrorCode } from '../utils/errors';
import { logger } from '../utils/logger';

const REMOTE_SSH_EXTENSION_ID = 'ms-vscode-remote.remote-ssh';
const BOUNDARY_SSH_CONFIG_MARKER = '# Boundary VS Code Extension - Auto-generated';

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
 * Get the path to the user's SSH config file
 */
function getSSHConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config');
}

/**
 * Generate a unique SSH host alias for a Boundary connection
 */
function generateBoundaryHostAlias(port: number, targetName?: string): string {
  const sanitizedName = targetName
    ? targetName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
    : 'boundary';
  return `boundary-${sanitizedName}-${port}`;
}

/**
 * Create or update SSH config entry for Boundary connection
 * This allows Remote SSH to connect to localhost on a custom port
 */
async function ensureSSHConfigEntry(options: RemoteSSHConnectionOptions & { targetName?: string }): Promise<string> {
  const sshDir = path.join(os.homedir(), '.ssh');
  const configPath = getSSHConfigPath();
  const hostAlias = generateBoundaryHostAlias(options.port, options.targetName);

  logger.info(`Creating SSH config entry: ${hostAlias} -> ${options.host}:${options.port}`);

  // Ensure .ssh directory exists
  try {
    await fs.promises.mkdir(sshDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger.debug('SSH directory already exists or created:', err);
  }

  // Build the SSH config entry lines
  const entryLines = [
    `${BOUNDARY_SSH_CONFIG_MARKER}`,
    `# Target: ${options.targetName || 'Boundary Connection'}`,
    `# Created: ${new Date().toISOString()}`,
    `Host ${hostAlias}`,
    `  HostName ${options.host}`,
    `  Port ${options.port}`,
  ];

  if (options.userName) {
    entryLines.push(`  User ${options.userName}`);
  }

  entryLines.push(
    '  StrictHostKeyChecking no',
    '  UserKnownHostsFile /dev/null',
    '  LogLevel ERROR'
  );

  // Join with newlines and ensure proper spacing
  const configEntry = '\n' + entryLines.join('\n') + '\n';

  // Read existing config
  let existingConfig = '';
  try {
    existingConfig = await fs.promises.readFile(configPath, 'utf-8');
  } catch {
    logger.debug('No existing SSH config file, will create new one');
  }

  // Ensure existing config ends with newline to prevent concatenation issues
  if (existingConfig && !existingConfig.endsWith('\n')) {
    existingConfig += '\n';
  }

  // Check if this exact host alias already exists and update or append
  const hostRegex = new RegExp(
    `\\n?${BOUNDARY_SSH_CONFIG_MARKER}\\n[^]*?Host ${hostAlias}\\n[^]*?(?=\\n${BOUNDARY_SSH_CONFIG_MARKER}|\\nHost |$)`,
    'g'
  );

  if (hostRegex.test(existingConfig)) {
    // Update existing entry
    const updatedConfig = existingConfig.replace(hostRegex, configEntry);
    await fs.promises.writeFile(configPath, updatedConfig, { mode: 0o600 });
    logger.info(`Updated SSH config entry for ${hostAlias}`);
  } else {
    // Append new entry
    const newConfig = existingConfig + configEntry;
    await fs.promises.writeFile(configPath, newConfig, { mode: 0o600 });
    logger.info(`Added SSH config entry for ${hostAlias}`);
  }

  return hostAlias;
}

/**
 * Clean up old Boundary SSH config entries (optional maintenance)
 */
export async function cleanupBoundarySSHConfigEntries(): Promise<void> {
  const configPath = getSSHConfigPath();

  try {
    let config = await fs.promises.readFile(configPath, 'utf-8');

    // Remove all Boundary-generated entries
    const boundaryEntryRegex = new RegExp(`\\n?${BOUNDARY_SSH_CONFIG_MARKER}\\n[^]*?(?=\\n${BOUNDARY_SSH_CONFIG_MARKER}|\\nHost |$)`, 'g');
    config = config.replace(boundaryEntryRegex, '');

    await fs.promises.writeFile(configPath, config, { mode: 0o600 });
    logger.info('Cleaned up Boundary SSH config entries');
  } catch (err) {
    logger.debug('Failed to cleanup SSH config entries:', err);
  }
}

/**
 * Trigger Remote SSH connection to localhost proxy
 */
export async function triggerRemoteSSH(options: RemoteSSHConnectionOptions & { targetName?: string }): Promise<void> {
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

  // Create SSH config entry for this connection
  // This is the key fix - Remote SSH needs an SSH config alias for custom ports
  let hostAlias: string;
  try {
    hostAlias = await ensureSSHConfigEntry(options);
    logger.info(`Created SSH config entry with alias: ${hostAlias}`);
  } catch (err) {
    logger.error('Failed to create SSH config entry:', err);
    // Fall back to showing manual instructions
    showManualConnectionInfo(options);
    return;
  }

  // Use the SSH config alias with Remote SSH
  // The vscode-remote URI scheme with just the alias (no user@) works with SSH config
  logger.info(`Opening Remote SSH with alias: ${hostAlias}`);

  // Use URI scheme - this is the most reliable method
  // The alias in SSH config contains all connection details (host, port, user)
  try {
    const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostAlias}/`);
    logger.info(`Remote SSH URI: ${uri.toString()}`);

    await vscode.commands.executeCommand('vscode.openFolder', uri, {
      forceNewWindow: true,
    });

    logger.info('Remote SSH connection triggered via URI scheme with alias');
    return;
  } catch (error) {
    logger.error('Failed to trigger Remote SSH via URI scheme:', error);
  }

  // Fallback: Try openEmptyWindow command
  try {
    await vscode.commands.executeCommand('opensshremotes.openEmptyWindow', {
      host: hostAlias,
    });
    logger.info('Remote SSH connection triggered via openEmptyWindow with alias');
    return;
  } catch (error) {
    logger.warn('Failed to use openEmptyWindow:', error);
  }

  // Final fallback: Show manual connection instructions
  showManualConnectionInfo(options);
}

/**
 * Show manual connection instructions when automatic connection fails
 */
function showManualConnectionInfo(options: RemoteSSHConnectionOptions): void {
  const port = options.port;
  const userPart = options.userName ? `${options.userName}@` : '';
  const sshCommand = `ssh ${userPart}localhost -p ${port}`;

  void vscode.window.showInformationMessage(
    `Connection established on localhost:${port}. SSH command: ${sshCommand}`,
    'Copy SSH Command',
    'Open Remote SSH'
  ).then(action => {
    if (action === 'Copy SSH Command') {
      void vscode.env.clipboard.writeText(sshCommand);
      void vscode.window.showInformationMessage('SSH command copied to clipboard');
    } else if (action === 'Open Remote SSH') {
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
