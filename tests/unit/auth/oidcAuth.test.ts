/**
 * Unit tests for OIDC authentication flow
 */

import { BoundaryAuthMethod } from '../../../src/types';

// Mock vscode module
jest.mock('vscode', () => ({
  window: {
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    withProgress: jest.fn((options, task) => task({ report: jest.fn() })),
  },
  commands: {
    executeCommand: jest.fn(),
  },
  ProgressLocation: {
    Notification: 1,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
}));

// Mock the config service
jest.mock('../../../src/utils/config', () => ({
  getConfigurationService: jest.fn(() => ({
    get: jest.fn((key: string) => {
      if (key === 'addr') return 'https://boundary.local';
      if (key === 'tlsInsecure') return true;
      return undefined;
    }),
    update: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the CLI
const mockListAuthMethods = jest.fn();
const mockCheckInstalled = jest.fn();

jest.mock('../../../src/boundary/cli', () => ({
  getBoundaryCLI: jest.fn(() => ({
    checkInstalled: mockCheckInstalled,
    listAuthMethods: mockListAuthMethods,
  })),
}));

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('OIDC Auth Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckInstalled.mockResolvedValue(true);
  });

  describe('module exports', () => {
    it('should export executeOidcAuth function', () => {
      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      expect(typeof executeOidcAuth).toBe('function');
    });
  });

  describe('auth method discovery', () => {
    const mockAuthMethods: BoundaryAuthMethod[] = [
      {
        id: 'amoidc_1234567890',
        scopeId: 'global',
        name: 'Okta SSO',
        description: 'Sign in with Okta',
        type: 'oidc',
        isPrimary: true,
      },
      {
        id: 'ampw_1234567890',
        scopeId: 'global',
        name: 'Password',
        description: 'Username and password',
        type: 'password',
        isPrimary: false,
      },
    ];

    it('should auto-select single OIDC method without prompting', async () => {
      const vscode = require('vscode');
      const singleOidcMethod: BoundaryAuthMethod[] = [
        {
          id: 'amoidc_keycloak',
          scopeId: 'global',
          name: 'Keycloak',
          type: 'oidc',
          isPrimary: true,
        },
      ];

      mockListAuthMethods.mockResolvedValue(singleOidcMethod);

      // Mock auth manager
      const mockAuthManager = {
        login: jest.fn().mockResolvedValue({ success: true, token: 'test-token' }),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      await executeOidcAuth(mockAuthManager);

      // Should NOT show quick pick when there's only one OIDC method
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();

      // Should call login with the auto-selected method
      expect(mockAuthManager.login).toHaveBeenCalledWith('oidc', {
        authMethodId: 'amoidc_keycloak',
      });
    });

    it('should show picker when multiple OIDC methods available', async () => {
      const vscode = require('vscode');
      const multipleOidcMethods: BoundaryAuthMethod[] = [
        {
          id: 'amoidc_okta',
          scopeId: 'global',
          name: 'Okta',
          type: 'oidc',
          isPrimary: true,
        },
        {
          id: 'amoidc_azure',
          scopeId: 'global',
          name: 'Azure AD',
          type: 'oidc',
          isPrimary: false,
        },
      ];

      mockListAuthMethods.mockResolvedValue(multipleOidcMethods);

      // Mock picker to select first option
      vscode.window.showQuickPick.mockResolvedValue({
        authMethod: multipleOidcMethods[0],
      });

      const mockAuthManager = {
        login: jest.fn().mockResolvedValue({ success: true }),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      await executeOidcAuth(mockAuthManager);

      // Should show quick pick for multiple OIDC methods
      expect(vscode.window.showQuickPick).toHaveBeenCalled();
    });

    it('should return error when CLI not installed', async () => {
      mockCheckInstalled.mockResolvedValue(false);

      const mockAuthManager = {
        login: jest.fn(),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      const result = await executeOidcAuth(mockAuthManager);

      expect(result.success).toBe(false);
      expect(result.error).toContain('CLI not found');
      expect(mockAuthManager.login).not.toHaveBeenCalled();
    });

    it('should handle empty auth methods by falling back to manual entry', async () => {
      const vscode = require('vscode');
      mockListAuthMethods.mockResolvedValue([]);

      // Mock warning message to not retry
      vscode.window.showWarningMessage.mockResolvedValue('Cancel');

      // Mock input box for manual entry (user cancels)
      vscode.window.showInputBox.mockResolvedValue(undefined);

      const mockAuthManager = {
        login: jest.fn(),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      const result = await executeOidcAuth(mockAuthManager);

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });

    it('should handle cancelled picker selection', async () => {
      const vscode = require('vscode');
      const multipleOidcMethods: BoundaryAuthMethod[] = [
        {
          id: 'amoidc_okta',
          scopeId: 'global',
          name: 'Okta',
          type: 'oidc',
          isPrimary: true,
        },
        {
          id: 'amoidc_azure',
          scopeId: 'global',
          name: 'Azure AD',
          type: 'oidc',
          isPrimary: false,
        },
      ];

      mockListAuthMethods.mockResolvedValue(multipleOidcMethods);

      // User cancels picker
      vscode.window.showQuickPick.mockResolvedValue(undefined);

      const mockAuthManager = {
        login: jest.fn(),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      const result = await executeOidcAuth(mockAuthManager);

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
      expect(mockAuthManager.login).not.toHaveBeenCalled();
    });
  });

  describe('auth method sorting', () => {
    it('should sort primary methods first', () => {
      // Test the sorting logic directly
      const methods: BoundaryAuthMethod[] = [
        { id: '1', scopeId: 'global', name: 'Secondary', type: 'oidc', isPrimary: false },
        { id: '2', scopeId: 'global', name: 'Primary', type: 'oidc', isPrimary: true },
      ];

      const sorted = [...methods].sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.name.localeCompare(b.name);
      });

      expect(sorted[0].name).toBe('Primary');
      expect(sorted[1].name).toBe('Secondary');
    });

    it('should sort OIDC methods before password methods when neither is primary', () => {
      const methods: BoundaryAuthMethod[] = [
        { id: '1', scopeId: 'global', name: 'Password', type: 'password', isPrimary: false },
        { id: '2', scopeId: 'global', name: 'OIDC', type: 'oidc', isPrimary: false },
      ];

      const sorted = [...methods].sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        if (a.type === 'oidc' && b.type !== 'oidc') return -1;
        if (a.type !== 'oidc' && b.type === 'oidc') return 1;
        return a.name.localeCompare(b.name);
      });

      expect(sorted[0].type).toBe('oidc');
      expect(sorted[1].type).toBe('password');
    });
  });

  describe('successful authentication', () => {
    it('should show success message on successful login', async () => {
      const vscode = require('vscode');
      const singleOidcMethod: BoundaryAuthMethod[] = [
        {
          id: 'amoidc_test',
          scopeId: 'global',
          name: 'Test OIDC',
          type: 'oidc',
          isPrimary: true,
        },
      ];

      mockListAuthMethods.mockResolvedValue(singleOidcMethod);

      const mockAuthManager = {
        login: jest.fn().mockResolvedValue({
          success: true,
          token: 'test-token',
          userId: 'u_123',
        }),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      const result = await executeOidcAuth(mockAuthManager);

      expect(result.success).toBe(true);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Successfully signed in')
      );
    });

    it('should show error message on failed login', async () => {
      const vscode = require('vscode');
      const singleOidcMethod: BoundaryAuthMethod[] = [
        {
          id: 'amoidc_test',
          scopeId: 'global',
          name: 'Test OIDC',
          type: 'oidc',
          isPrimary: true,
        },
      ];

      mockListAuthMethods.mockResolvedValue(singleOidcMethod);

      const mockAuthManager = {
        login: jest.fn().mockResolvedValue({
          success: false,
          error: 'Authentication timeout',
        }),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      const result = await executeOidcAuth(mockAuthManager);

      expect(result.success).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Authentication timeout')
      );
    });
  });

  describe('with provided authMethodId', () => {
    it('should skip discovery when authMethodId is provided', async () => {
      const mockAuthManager = {
        login: jest.fn().mockResolvedValue({ success: true }),
      };

      const { executeOidcAuth } = require('../../../src/auth/oidcAuth');
      await executeOidcAuth(mockAuthManager, { authMethodId: 'amoidc_provided' });

      // Should not call listAuthMethods when ID is provided
      expect(mockListAuthMethods).not.toHaveBeenCalled();

      // Should call login with provided ID
      expect(mockAuthManager.login).toHaveBeenCalledWith('oidc', {
        authMethodId: 'amoidc_provided',
      });
    });
  });
});
