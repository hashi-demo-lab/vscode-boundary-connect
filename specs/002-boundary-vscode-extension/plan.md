# Implementation Plan: VS Code Extension for HashiCorp Boundary

**Branch**: `002-boundary-vscode-extension` | **Date**: 2025-12-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-boundary-vscode-extension/spec.md`

## Summary

Build a VS Code extension that integrates HashiCorp Boundary with VS Code's Remote SSH extension, enabling one-click secure infrastructure access. The extension provides authentication (OIDC/Password), target browsing via TreeView, and automatic Remote SSH connection through Boundary's local proxy.

## Technical Context

**Language/Version**: TypeScript 5.x with ES2022 target
**Primary Dependencies**: VS Code Extension API (^1.74.0), child_process (Node.js built-in)
**Storage**: VS Code SecretStorage for tokens (encrypted), ExtensionContext for state
**Testing**: VS Code Extension Test framework (@vscode/test-electron), Jest for unit tests
**Target Platform**: VS Code Desktop (Windows, macOS, Linux)
**Project Type**: VS Code Extension (single project)
**Performance Goals**: UI response <200ms, connection establishment <5s
**Constraints**: Requires Boundary CLI installed, requires Remote SSH extension
**Scale/Scope**: Single extension, ~15 commands, 1 TreeView, 1 status bar item

## Constitution Check

*Note: The project constitution is Terraform-focused. This VS Code extension project follows VS Code extension development best practices instead.*

**Applicable Principles**:
- ✅ Specification-Driven Development - Following detailed spec.md
- ✅ Security-First - Using SecretStorage for tokens, no plaintext credentials
- ✅ Code Quality - TypeScript, esbuild bundler, linting

**Not Applicable**:
- Terraform module patterns (this is a VS Code extension)
- HCP Terraform workspaces (no infrastructure provisioning)
- Private module registry (TypeScript/npm dependencies)

## Project Structure

### Documentation (this feature)

```text
specs/002-boundary-vscode-extension/
├── spec.md              # Feature specification
├── plan.md              # This file (implementation plan)
├── research.md          # Technical research findings
├── tasks.md             # Implementation tasks (Phase 2)
└── contracts/           # API contracts and interfaces
    ├── boundary-cli.md  # CLI command contracts
    ├── vscode-api.md    # VS Code API usage patterns
    └── types.ts         # TypeScript interface definitions
```

### Source Code (repository root)

```text
src/
├── extension.ts         # Extension entry point (activate/deactivate)
├── auth/
│   ├── authManager.ts   # Authentication orchestration
│   ├── oidcAuth.ts      # OIDC authentication flow
│   └── passwordAuth.ts  # Password authentication flow
├── boundary/
│   ├── cli.ts           # Boundary CLI wrapper
│   ├── types.ts         # Boundary data types
│   └── parser.ts        # CLI output parsing
├── targets/
│   ├── targetProvider.ts    # TreeDataProvider implementation
│   ├── targetItem.ts        # TreeItem implementations
│   └── targetService.ts     # Target fetching and caching
├── connection/
│   ├── connectionManager.ts # Connection lifecycle management
│   ├── session.ts           # Active session tracking
│   └── remoteSSH.ts         # Remote SSH integration
├── ui/
│   ├── statusBar.ts         # Status bar item
│   ├── quickPick.ts         # QuickPick target selection
│   └── notifications.ts     # User notifications
└── utils/
    ├── config.ts            # Extension configuration
    ├── logger.ts            # Logging utilities
    └── errors.ts            # Error handling

tests/
├── unit/
│   ├── auth/
│   ├── boundary/
│   ├── targets/
│   └── connection/
├── integration/
│   ├── cli.test.ts          # CLI integration tests
│   └── extension.test.ts    # Extension lifecycle tests
└── mocks/
    ├── vscode.ts            # VS Code API mocks
    └── boundary.ts          # Boundary CLI mocks

resources/
├── icons/
│   ├── boundary.svg         # Extension icon
│   ├── target.svg           # Target icon
│   └── session.svg          # Session icon
└── images/
    └── logo.png             # Marketplace logo

.vscode/
├── launch.json              # Debug configurations
├── tasks.json               # Build tasks
└── extensions.json          # Recommended extensions
```

**Structure Decision**: Single VS Code extension project with modular source organization. Separates concerns into auth, boundary CLI interaction, target management, connection management, and UI components.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │  AuthManager   │  │ TargetProvider │  │ ConnectionMgr   │   │
│  │                │  │                │  │                 │   │
│  │ - login()      │  │ - getChildren()│  │ - connect()     │   │
│  │ - logout()     │  │ - refresh()    │  │ - disconnect()  │   │
│  │ - getToken()   │  │ - onSelect()   │  │ - getActive()   │   │
│  └───────┬────────┘  └───────┬────────┘  └────────┬────────┘   │
│          │                   │                     │            │
│          └───────────────────┼─────────────────────┘            │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │   BoundaryCLI     │                        │
│                    │                   │                        │
│                    │ - authenticate()  │                        │
│                    │ - listTargets()   │                        │
│                    │ - connect()       │                        │
│                    │ - getToken()      │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   boundary CLI      │
                    │   (child_process)   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Boundary Server   │
                    └─────────────────────┘
```

## Component Design

### 1. AuthManager

**Responsibility**: Manage authentication state and token lifecycle

**Interface**:
```typescript
interface IAuthManager {
  login(method: 'oidc' | 'password'): Promise<void>;
  logout(): Promise<void>;
  getToken(): Promise<string | undefined>;
  isAuthenticated(): Promise<boolean>;
  onAuthStateChanged: vscode.Event<boolean>;
}
```

**Token Storage**: Uses `vscode.SecretStorage` for encrypted token persistence.

### 2. BoundaryCLI

**Responsibility**: Execute Boundary CLI commands and parse output

**Interface**:
```typescript
interface IBoundaryCLI {
  authenticate(method: AuthMethod, credentials?: Credentials): Promise<AuthResult>;
  listTargets(scopeId?: string): Promise<Target[]>;
  connect(targetId: string): Promise<Connection>;
  getToken(): Promise<string | undefined>;
  checkInstalled(): Promise<boolean>;
}
```

**Port Capture**: Regex pattern `/Listening on 127\.0\.0\.1:(\d+)/`

### 3. TargetProvider (TreeDataProvider)

**Responsibility**: Provide hierarchical target data for TreeView

**Hierarchy**:
- Scope (org/global) → Project → Target

**Interface**:
```typescript
class TargetProvider implements vscode.TreeDataProvider<TargetItem> {
  getTreeItem(element: TargetItem): vscode.TreeItem;
  getChildren(element?: TargetItem): Promise<TargetItem[]>;
  refresh(): void;
}
```

### 4. ConnectionManager

**Responsibility**: Manage active Boundary connections and Remote SSH handoff

**Interface**:
```typescript
interface IConnectionManager {
  connect(target: Target): Promise<Session>;
  disconnect(sessionId: string): Promise<void>;
  disconnectAll(): Promise<void>;
  getActiveSessions(): Session[];
  onSessionsChanged: vscode.Event<Session[]>;
}
```

**Process Management**: Tracks child processes spawned by `boundary connect`, terminates on disconnect/deactivate.

### 5. RemoteSSH Integration

**Primary Method**:
```typescript
await vscode.commands.executeCommand('opensshremotes.openEmptyWindow', {
  host: 'localhost',
  port: capturedPort
});
```

**Fallback Method** (URI scheme):
```typescript
const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+localhost:${port}/`);
await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
```

## Commands and Contributions

### Commands

| Command ID | Title | Description |
|------------|-------|-------------|
| `boundary.login` | Boundary: Login | Authenticate with Boundary |
| `boundary.logout` | Boundary: Logout | Clear authentication |
| `boundary.connect` | Boundary: Connect to Target | QuickPick target selection |
| `boundary.connectTarget` | (internal) | Connect to specific target |
| `boundary.disconnect` | Boundary: Disconnect | Disconnect active session |
| `boundary.disconnectAll` | Boundary: Disconnect All | Disconnect all sessions |
| `boundary.refresh` | Boundary: Refresh Targets | Refresh target list |
| `boundary.showSessions` | Boundary: Show Sessions | Show active sessions |

### Views

| View ID | Location | Description |
|---------|----------|-------------|
| `boundary.targets` | Activity Bar (sidebar) | Target browser TreeView |

### Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `boundary.cliPath` | string | `boundary` | Path to Boundary CLI |
| `boundary.defaultAuthMethod` | string | `oidc` | Default auth method |
| `boundary.autoConnect` | boolean | `false` | Auto-connect on startup |

## Data Flow

### Authentication Flow

```
User clicks Login
        │
        ▼
┌───────────────────┐
│ Show auth method  │
│ picker (OIDC/PWD) │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐    ┌─────────────────┐
│ OIDC: spawn       │ OR │ Password: input │
│ boundary auth oidc│    │ credentials     │
└─────────┬─────────┘    └────────┬────────┘
          │                       │
          └───────────┬───────────┘
                      │
                      ▼
          ┌───────────────────┐
          │ Parse auth result │
          │ Store token       │
          └─────────┬─────────┘
                    │
                    ▼
          ┌───────────────────┐
          │ Refresh TreeView  │
          │ Update status bar │
          └───────────────────┘
```

### Connection Flow

```
User selects target
        │
        ▼
┌───────────────────┐
│ Spawn:            │
│ boundary connect  │
│ -target-id xxx    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Parse stdout for  │
│ "Listening on     │
│ 127.0.0.1:<port>" │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Execute:          │
│ opensshremotes.   │
│ openEmptyWindow   │
│ {host, port}      │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Track session:    │
│ - Process handle  │
│ - Port number     │
│ - Target info     │
└───────────────────┘
```

## Error Handling Strategy

| Error Type | Detection | User Feedback | Recovery |
|------------|-----------|---------------|----------|
| CLI not installed | `which boundary` fails | Install instructions link | Configure path |
| Auth failure | Non-zero exit code | Clear error message | Retry with guidance |
| Connection failure | Process exit/stderr | Troubleshooting steps | Reconnect option |
| Remote SSH missing | Extension check | Install prompt | One-click install |
| Token expired | 401 from CLI | Re-auth prompt | Auto-trigger login |
| Process crash | `exit` event | Notification | Clean up session |

## Testing Strategy

### Unit Tests

- **AuthManager**: Mock SecretStorage, test state transitions
- **BoundaryCLI**: Mock child_process, test output parsing
- **TargetProvider**: Mock CLI responses, test tree building
- **ConnectionManager**: Mock processes, test session tracking

### Integration Tests

- **CLI Integration**: Test actual CLI execution (requires Boundary)
- **Extension Lifecycle**: Test activation, command registration

### Manual Testing

- Full workflow: login → browse → connect → disconnect
- Error scenarios: no CLI, bad credentials, connection failure
- Multi-session management

## Dependencies

### Production

```json
{
  "engines": {
    "vscode": "^1.74.0"
  },
  "dependencies": {}
}
```
*Note: No runtime dependencies - uses VS Code API and Node.js built-ins*

### Development

```json
{
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/vscode": "^1.74.0",
    "@vscode/test-electron": "^2.x",
    "esbuild": "^0.19.x",
    "typescript": "^5.x",
    "jest": "^29.x",
    "@types/jest": "^29.x"
  }
}
```

## Milestones

### M1: Foundation (P1 - Auth)
- Extension scaffold with esbuild
- CLI detection and execution
- Authentication flow (OIDC + Password)
- Token storage with SecretStorage

### M2: Target Browser (P1 - Browse)
- TreeView with hierarchical targets
- Refresh functionality
- Target details on hover
- Empty/unauthenticated states

### M3: Connection (P1 - Connect)
- `boundary connect` execution
- Port capture from stdout
- Remote SSH trigger
- Process lifecycle management

### M4: Session Management (P2)
- Status bar indicator
- Active session list
- Disconnect functionality
- Cleanup on deactivate

### M5: Polish (P3)
- QuickPick target selection
- Error handling refinement
- Documentation
- Marketplace preparation

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Remote SSH command changes | High | Fallback to URI scheme |
| Boundary CLI output format changes | Medium | Defensive parsing, version check |
| Process zombie leaks | Medium | Aggressive cleanup on deactivate |
| Cross-platform path issues | Low | Use Node.js path module |
| Token expiration during session | Medium | Monitor for auth errors, re-prompt |

## Success Criteria Mapping

| Spec Criteria | Implementation Validation |
|---------------|---------------------------|
| SC-001: 30s workflow | Time auth → connect in tests |
| SC-002: 100% port capture | Unit tests with various outputs |
| SC-003: 2s SSH trigger | Measure time from capture to command |
| SC-004: Clean deactivation | Integration test session cleanup |
| SC-005: Actionable errors | Manual review of all error paths |
| SC-006: Marketplace guidelines | Follow vsce packaging checks |
