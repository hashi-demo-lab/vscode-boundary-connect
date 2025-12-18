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
const BOUNDARY_KEYS_DIR = '.boundary-keys';

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
 * Get the directory for storing brokered SSH keys
 */
function getBoundaryKeysDir(): string {
  return path.join(os.homedir(), '.ssh', BOUNDARY_KEYS_DIR);
}

/**
 * Save a brokered private key (and optionally certificate) to temporary files
 * Returns the path to the key file
 *
 * For Vault SSH key signing, the certificate must be saved as <keyname>-cert.pub
 * alongside the private key for SSH to automatically use it.
 */
async function saveBrokeredKey(
  port: number,
  targetName: string | undefined,
  privateKey: string,
  certificate?: string
): Promise<string> {
  const keysDir = getBoundaryKeysDir();
  const hostAlias = generateBoundaryHostAlias(port, targetName);
  const keyPath = path.join(keysDir, `${hostAlias}.pem`);

  // Ensure keys directory exists with secure permissions
  try {
    await fs.promises.mkdir(keysDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger.debug('Keys directory already exists or created:', err);
  }

  // Write the key with secure permissions (owner read-only)
  await fs.promises.writeFile(keyPath, privateKey, { mode: 0o600 });
  logger.info(`Saved brokered SSH key to ${keyPath}`);

  // Save certificate if provided (for Vault SSH key signing)
  // SSH expects the certificate at <keyfile>-cert.pub
  if (certificate) {
    const certPath = keyPath.replace('.pem', '.pem-cert.pub');
    await fs.promises.writeFile(certPath, certificate, { mode: 0o600 });
    logger.info(`Saved brokered SSH certificate to ${certPath}`);
  }

  return keyPath;
}

/**
 * Remove a brokered key file and its certificate
 */
async function removeBrokeredKey(port: number, targetName?: string): Promise<void> {
  const hostAlias = generateBoundaryHostAlias(port, targetName);
  const keyPath = path.join(getBoundaryKeysDir(), `${hostAlias}.pem`);
  const certPath = keyPath.replace('.pem', '.pem-cert.pub');

  try {
    await fs.promises.unlink(keyPath);
    logger.debug(`Removed brokered key: ${keyPath}`);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      // Only log if it's not a "file not found" error
      logger.warn(`Failed to remove brokered key ${keyPath}:`, error.message);
    }
  }

  try {
    await fs.promises.unlink(certPath);
    logger.debug(`Removed brokered certificate: ${certPath}`);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      // Only log if it's not a "file not found" error
      logger.warn(`Failed to remove brokered certificate ${certPath}:`, error.message);
    }
  }
}

/**
 * Create or update SSH config entry for Boundary connection
 * This allows Remote SSH to connect to localhost on a custom port
 */
async function ensureSSHConfigEntry(options: RemoteSSHConnectionOptions & { targetName?: string; keyPath?: string }): Promise<string> {
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

  // Add brokered key if provided
  if (options.keyPath) {
    entryLines.push(`  IdentityFile ${options.keyPath}`);
    entryLines.push('  IdentitiesOnly yes');
    logger.info(`SSH config will use brokered key: ${options.keyPath}`);
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
 * Remove a specific Boundary SSH config entry by port and target name
 */
export async function removeBoundarySSHConfigEntry(port: number, targetName?: string): Promise<void> {
  const configPath = getSSHConfigPath();
  const hostAlias = generateBoundaryHostAlias(port, targetName);

  try {
    const config = await fs.promises.readFile(configPath, 'utf-8');

    // Remove the specific entry for this host alias
    const entryRegex = new RegExp(
      `\\n?${BOUNDARY_SSH_CONFIG_MARKER}\\n[^]*?Host ${hostAlias}\\n[^]*?(?=\\n${BOUNDARY_SSH_CONFIG_MARKER}|\\nHost |$)`,
      'g'
    );

    const newConfig = config.replace(entryRegex, '');

    if (newConfig !== config) {
      await fs.promises.writeFile(configPath, newConfig, { mode: 0o600 });
      logger.info(`Removed SSH config entry for ${hostAlias}`);
    }
  } catch (err) {
    logger.debug(`Failed to remove SSH config entry for ${hostAlias}:`, err);
  }

  // Also remove the brokered key file if it exists
  await removeBrokeredKey(port, targetName);
}

/**
 * Clean up all Boundary SSH config entries (for extension deactivation or maintenance)
 */
export async function cleanupBoundarySSHConfigEntries(): Promise<void> {
  const configPath = getSSHConfigPath();

  try {
    const config = await fs.promises.readFile(configPath, 'utf-8');

    // Remove all Boundary-generated entries
    const boundaryEntryRegex = new RegExp(`\\n?${BOUNDARY_SSH_CONFIG_MARKER}\\n[^]*?(?=\\n${BOUNDARY_SSH_CONFIG_MARKER}|\\nHost |$)`, 'g');
    const newConfig = config.replace(boundaryEntryRegex, '');

    if (newConfig !== config) {
      await fs.promises.writeFile(configPath, newConfig, { mode: 0o600 });
      logger.info('Cleaned up all Boundary SSH config entries');
    }
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

  // Save brokered private key (and certificate) if provided
  let keyPath: string | undefined;
  logger.debug('triggerRemoteSSH options:', {
    host: options.host,
    port: options.port,
    userName: options.userName,
    hasPrivateKey: !!options.privateKey,
    privateKeyLength: options.privateKey?.length,
    hasCertificate: !!options.certificate,
    certificateLength: options.certificate?.length
  });
  if (options.privateKey) {
    try {
      keyPath = await saveBrokeredKey(options.port, options.targetName, options.privateKey, options.certificate);
      logger.info(`Saved brokered key to: ${keyPath}${options.certificate ? ' (with certificate)' : ''}`);
    } catch (err) {
      logger.error('Failed to save brokered SSH key:', err);
      // Notify user that brokered key saving failed - they may need manual credentials
      void vscode.window.showWarningMessage(
        'Could not save brokered SSH key. You may need to provide credentials manually.',
        'View Logs'
      ).then(action => {
        if (action === 'View Logs') {
          logger.show();
        }
      });
      // Continue without the key - SSH may still work with agent or other auth
    }
  } else {
    logger.debug('No privateKey provided to triggerRemoteSSH');
  }

  // Create SSH config entry for this connection
  // This is the key fix - Remote SSH needs an SSH config alias for custom ports
  let hostAlias: string;
  try {
    hostAlias = await ensureSSHConfigEntry({ ...options, keyPath });
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

  // Get configured default remote path
  const config = vscode.workspace.getConfiguration('boundary');
  const defaultRemotePath = config.get<string>('defaultRemotePath') || '/workspace';

  // Use URI scheme - this is the most reliable method
  // The alias in SSH config contains all connection details (host, port, user)
  try {
    const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostAlias}${defaultRemotePath}`);
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
