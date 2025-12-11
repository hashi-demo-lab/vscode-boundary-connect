/**
 * Configuration service for Boundary extension
 */

import * as vscode from 'vscode';
import { AuthMethod, ExtensionConfiguration, IConfigurationService } from '../types';

const CONFIGURATION_SECTION = 'boundary';

export class ConfigurationService implements IConfigurationService, vscode.Disposable {
  private readonly _onConfigurationChanged = new vscode.EventEmitter<ExtensionConfiguration>();
  readonly onConfigurationChanged = this._onConfigurationChanged.event;

  private configChangeSubscription: vscode.Disposable;

  constructor() {
    this.configChangeSubscription = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(CONFIGURATION_SECTION)) {
        this._onConfigurationChanged.fire(this.getConfiguration());
      }
    });
  }

  getConfiguration(): ExtensionConfiguration {
    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

    return {
      cliPath: config.get<string>('cliPath', 'boundary'),
      addr: config.get<string>('addr', ''),
      tlsInsecure: config.get<boolean>('tlsInsecure', false),
      keyringType: config.get<'auto' | 'none'>('keyringType', 'auto'),
      defaultAuthMethod: config.get<AuthMethod>('defaultAuthMethod', 'oidc'),
      boundaryAddr: config.get<string>('boundaryAddr'),
      autoConnect: config.get<boolean>('autoConnect', false),
      logLevel: config.get<'debug' | 'info' | 'warn' | 'error'>('logLevel', 'info'),
    };
  }

  get<K extends keyof ExtensionConfiguration>(key: K): ExtensionConfiguration[K] {
    const config = this.getConfiguration();
    return config[key];
  }

  /**
   * Update a configuration value
   */
  async update<K extends keyof ExtensionConfiguration>(
    key: K,
    value: ExtensionConfiguration[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    await config.update(key, value, target);
  }

  dispose(): void {
    this.configChangeSubscription.dispose();
    this._onConfigurationChanged.dispose();
  }
}

// Singleton instance for convenience
let configServiceInstance: ConfigurationService | undefined;

export function getConfigurationService(): ConfigurationService {
  if (!configServiceInstance) {
    configServiceInstance = new ConfigurationService();
  }
  return configServiceInstance;
}

export function disposeConfigurationService(): void {
  if (configServiceInstance) {
    configServiceInstance.dispose();
    configServiceInstance = undefined;
  }
}
