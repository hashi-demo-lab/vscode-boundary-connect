/**
 * VS Code API mocks for testing
 */

// Event emitter mock
export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };

  fire(data: T): void {
    this.listeners.forEach(listener => listener(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

// Uri mock
export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  parse: (uri: string) => {
    const url = new URL(uri);
    return {
      scheme: url.protocol.replace(':', ''),
      authority: url.host,
      path: url.pathname,
      query: url.search,
      fragment: url.hash,
      fsPath: url.pathname,
    };
  },
};

// TreeItemCollapsibleState mock
export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

// TreeItem mock
export class TreeItem {
  label?: string;
  id?: string;
  iconPath?: unknown;
  description?: string;
  tooltip?: string;
  collapsibleState?: TreeItemCollapsibleState;
  command?: unknown;
  contextValue?: string;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

// ThemeIcon mock
export class ThemeIcon {
  constructor(public readonly id: string) {}
}

// Configuration mock
const configurationValues: Record<string, unknown> = {
  'boundary.cliPath': 'boundary',
  'boundary.defaultAuthMethod': 'oidc',
  'boundary.autoConnect': false,
  'boundary.logLevel': 'info',
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => {
      const fullKey = section ? `${section}.${key}` : key;
      const value = configurationValues[fullKey];
      return (value !== undefined ? value : defaultValue) as T;
    },
    update: jest.fn().mockResolvedValue(undefined),
    has: (key: string) => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in configurationValues;
    },
    inspect: jest.fn(),
  }),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  workspaceFolders: [],
};

// Window mock
export const window = {
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showInputBox: jest.fn().mockResolvedValue(undefined),
  showQuickPick: jest.fn().mockResolvedValue(undefined),
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  })),
  createTreeView: jest.fn(() => ({
    reveal: jest.fn(),
    onDidChangeSelection: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeVisibility: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  })),
  registerTreeDataProvider: jest.fn(() => ({ dispose: jest.fn() })),
  createStatusBarItem: jest.fn(() => ({
    text: '',
    tooltip: '',
    command: undefined,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  })),
  withProgress: jest.fn(async (_options, task) => {
    const progress = {
      report: jest.fn(),
    };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    return task(progress, token);
  }),
};

// Commands mock
export const commands = {
  registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
  executeCommand: jest.fn().mockResolvedValue(undefined),
  getCommands: jest.fn().mockResolvedValue([]),
};

// Extensions mock
export const extensions = {
  getExtension: jest.fn((extensionId: string) => {
    if (extensionId === 'ms-vscode-remote.remote-ssh') {
      return {
        id: extensionId,
        isActive: true,
        activate: jest.fn().mockResolvedValue(undefined),
      };
    }
    return undefined;
  }),
  all: [],
};

// StatusBarAlignment mock
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

// ProgressLocation mock
export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

// ConfigurationTarget mock
export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

// QuickPickItemKind mock
export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

// SecretStorage mock
export class SecretStorage {
  private secrets: Map<string, string> = new Map();

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  onDidChange = jest.fn(() => ({ dispose: jest.fn() }));
}

// ExtensionContext mock
export function createMockExtensionContext(): {
  subscriptions: { dispose: () => void }[];
  secrets: SecretStorage;
  extensionPath: string;
  globalState: {
    get: <T>(key: string) => T | undefined;
    update: (key: string, value: unknown) => Promise<void>;
    keys: () => readonly string[];
  };
  workspaceState: {
    get: <T>(key: string) => T | undefined;
    update: (key: string, value: unknown) => Promise<void>;
    keys: () => readonly string[];
  };
} {
  const globalStateData: Map<string, unknown> = new Map();
  const workspaceStateData: Map<string, unknown> = new Map();

  return {
    subscriptions: [],
    secrets: new SecretStorage(),
    extensionPath: '/mock/extension/path',
    globalState: {
      get: <T>(key: string) => globalStateData.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        globalStateData.set(key, value);
      },
      keys: () => Array.from(globalStateData.keys()),
    },
    workspaceState: {
      get: <T>(key: string) => workspaceStateData.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        workspaceStateData.set(key, value);
      },
      keys: () => Array.from(workspaceStateData.keys()),
    },
  };
}

// Disposable mock
export class Disposable {
  constructor(private callOnDispose: () => void) {}

  static from(...disposables: { dispose: () => unknown }[]): Disposable {
    return new Disposable(() => {
      disposables.forEach(d => d.dispose());
    });
  }

  dispose(): void {
    this.callOnDispose();
  }
}

// ThemeColor mock
export class ThemeColor {
  constructor(public readonly id: string) {}
}

// Status bar item mock instance for testing
export const mockStatusBarItem = {
  text: '',
  tooltip: '',
  command: 'boundary.showSessions' as string | undefined,
  backgroundColor: undefined as ThemeColor | undefined,
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

// QuickPick mock instance for testing
export const mockQuickPick = {
  items: [] as unknown[],
  selectedItems: [] as unknown[],
  placeholder: '',
  title: '',
  busy: false,
  onDidAccept: jest.fn(() => ({ dispose: jest.fn() })),
  onDidHide: jest.fn(() => ({ dispose: jest.fn() })),
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

// Secret storage mock for testing
export const mockSecretStorage = {
  get: jest.fn(),
  store: jest.fn(),
  delete: jest.fn(),
  onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
};

// Mock window for testing
export const mockWindow = {
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showInputBox: jest.fn().mockResolvedValue(undefined),
  showQuickPick: jest.fn().mockResolvedValue(undefined),
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  })),
  createTreeView: jest.fn(() => ({
    reveal: jest.fn(),
    onDidChangeSelection: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeVisibility: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  })),
  registerTreeDataProvider: jest.fn(() => ({ dispose: jest.fn() })),
  createStatusBarItem: jest.fn(() => mockStatusBarItem),
  createQuickPick: jest.fn(() => mockQuickPick),
  withProgress: jest.fn(async (_options, task) => {
    const progress = {
      report: jest.fn(),
    };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    return task(progress, token);
  }),
};

// Mock commands for testing
export const mockCommands = {
  registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
  executeCommand: jest.fn().mockResolvedValue(undefined),
  getCommands: jest.fn().mockResolvedValue([]),
};

// Mock extensions for testing
export const mockExtensions = {
  getExtension: jest.fn((extensionId: string) => {
    if (extensionId === 'ms-vscode-remote.remote-ssh') {
      return {
        id: extensionId,
        isActive: true,
        activate: jest.fn().mockResolvedValue(undefined),
      };
    }
    return undefined;
  }),
  all: [],
};

// Mock event emitter for testing
export const mockEventEmitter = {
  event: jest.fn(),
  fire: jest.fn(),
  dispose: jest.fn(),
};

// Reset all mocks
export function resetMocks(): void {
  mockStatusBarItem.text = '';
  mockStatusBarItem.tooltip = '';
  mockStatusBarItem.command = 'boundary.showSessions';
  mockStatusBarItem.backgroundColor = undefined;
  mockStatusBarItem.show.mockClear();
  mockStatusBarItem.hide.mockClear();
  mockStatusBarItem.dispose.mockClear();

  mockQuickPick.items = [];
  mockQuickPick.selectedItems = [];
  mockQuickPick.placeholder = '';
  mockQuickPick.title = '';
  mockQuickPick.busy = false;
  mockQuickPick.onDidAccept.mockClear();
  mockQuickPick.onDidHide.mockClear();
  mockQuickPick.show.mockClear();
  mockQuickPick.hide.mockClear();
  mockQuickPick.dispose.mockClear();

  mockSecretStorage.get.mockReset();
  mockSecretStorage.store.mockReset();
  mockSecretStorage.delete.mockReset();

  mockWindow.showInformationMessage.mockReset().mockResolvedValue(undefined);
  mockWindow.showWarningMessage.mockReset().mockResolvedValue(undefined);
  mockWindow.showErrorMessage.mockReset().mockResolvedValue(undefined);
  mockWindow.showInputBox.mockReset().mockResolvedValue(undefined);
  mockWindow.showQuickPick.mockReset().mockResolvedValue(undefined);
  mockWindow.withProgress.mockReset().mockImplementation(async (_options, task) => {
    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    return task(progress, token);
  });

  mockCommands.registerCommand.mockClear();
  mockCommands.executeCommand.mockReset().mockResolvedValue(undefined);
  mockCommands.getCommands.mockReset().mockResolvedValue([]);

  mockExtensions.getExtension.mockReset().mockImplementation((extensionId: string) => {
    if (extensionId === 'ms-vscode-remote.remote-ssh') {
      return {
        id: extensionId,
        isActive: true,
        activate: jest.fn().mockResolvedValue(undefined),
      };
    }
    return undefined;
  });
}

// Complete VS Code mock for Jest
export const mockVSCode = {
  Uri,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  ThemeColor,
  StatusBarAlignment,
  ProgressLocation,
  ConfigurationTarget,
  QuickPickItemKind,
  Disposable,
  EventEmitter,
  workspace,
  window: mockWindow,
  commands: mockCommands,
  extensions: mockExtensions,
  env: {
    openExternal: jest.fn().mockResolvedValue(true),
  },
};
