# Architecture Improvements Specification

**Feature Branch**: `002-boundary-vscode-extension`
**Created**: 2025-12-12
**Status**: Draft
**Type**: Technical Debt / Refactoring

---

## Overview

This document captures architectural improvements identified during code review of the VS Code Boundary extension. Issues are prioritized by severity, effort, and impact area.

---

## Issues Summary

| #  | Issue                      | Severity | Effort | Impact          | Phase        |
|----|----------------------------|----------|--------|-----------------|--------------|
| 1  | Excessive Singletons       | High     | High   | Testability     | Phase 3      |
| 2  | Circular Import Risk       | Medium   | Low    | Maintainability | Quick Win    |
| 3  | Missing Interfaces         | Medium   | Low    | Testability     | Quick Win    |
| 4  | Webview CSP                | Low      | Low    | Security        | Quick Win    |
| 5  | Username Cache             | Low      | Low    | UX              | Quick Win    |
| 6  | SSH Config Pollution       | Medium   | Medium | UX              | Phase 2      |
| 7  | Duplicate ID Generation    | Low      | Low    | Consistency     | Quick Win    |
| 8  | Process Management         | Medium   | Medium | Reliability     | Phase 2      |
| 9  | No Retry Logic             | Medium   | Medium | Reliability     | Phase 2      |
| 10 | Parser Type Safety         | Medium   | Medium | Reliability     | Phase 2      |

---

## Issue Details

### Issue 1: Excessive Singleton Pattern

**Severity**: High | **Effort**: High | **Impact**: Testability

**Problem**: Nearly every service uses module-level singleton pattern:
- `BoundaryCLI`, `AuthStateManager`, `TargetService`, `ConnectionManager`
- `StatusBarManager`, `ConfigurationService`, `SessionsPanelProvider`

**Current Pattern** (throughout codebase):
```typescript
let instance: MyService | undefined;
export function getMyService(): MyService {
  if (!instance) { instance = new MyService(); }
  return instance;
}
```

**Impact**:
- Unit testing requires global state management
- Tight coupling between modules
- Initialization order is fragile
- Hard to test error scenarios in isolation

**Recommendation**: Implement dependency injection container or service locator pattern.

**Files Affected**:
- `src/boundary/cli.ts`
- `src/auth/authState.ts`
- `src/targets/targetService.ts`
- `src/connection/connectionManager.ts`
- `src/ui/statusBar.ts`
- `src/utils/config.ts`
- `src/ui/sessionsPanel.ts`
- `src/ui/decorationProvider.ts`

---

### Issue 2: Circular Import Risk

**Severity**: Medium | **Effort**: Low | **Impact**: Maintainability

**Problem**: Extension activation has careful ordering to prevent race conditions:

```typescript
// src/extension.ts:91-94
// Initialize auth state BEFORE creating TargetProvider to avoid race condition
// TargetProvider subscribes to auth state changes, so we need auth state resolved first
await authManager.initialize();
```

**Impact**:
- Fragile initialization requiring manual ordering
- Comments document implicit dependencies
- Easy to break during refactoring

**Recommendation**: Use lazy subscription or explicit initialization method:

```typescript
class TargetProvider {
  private subscribed = false;

  initialize(authManager: IAuthManager) {
    if (!this.subscribed) {
      this.authManager = authManager;
      this.subscribeToAuthChanges();
      this.subscribed = true;
    }
  }
}
```

**Files Affected**:
- `src/extension.ts`
- `src/targets/targetProvider.ts`

---

### Issue 3: Missing Interface Abstractions

**Severity**: Medium | **Effort**: Low | **Impact**: Testability

**Problem**: Several services lack interface definitions, making mocking difficult:

| Service | Has Interface |
|---------|---------------|
| `TargetService` | No |
| `AuthStateManager` | No |
| `StatusBarManager` | Yes (`IStatusBarManager`) |
| `ConnectionManager` | Yes (`IConnectionManager`) |
| `BoundaryCLI` | Yes (`IBoundaryCLI`) |
| `ConfigurationService` | Yes (`IConfigurationService`) |

**Recommendation**: Add interfaces for `TargetService` and `AuthStateManager`:

```typescript
// src/types.ts
export interface ITargetService extends vscode.Disposable {
  getAllTargets(forceRefresh?: boolean): Promise<BoundaryTarget[]>;
  getTargetsForScope(scopeId: string, forceRefresh?: boolean): Promise<BoundaryTarget[]>;
  getTarget(targetId: string): Promise<BoundaryTarget | undefined>;
  groupTargetsByScope(targets: BoundaryTarget[]): Map<string, BoundaryTarget[]>;
  clearCache(): void;
  readonly onTargetsChanged: vscode.Event<void>;
}

export interface IAuthStateManager extends vscode.Disposable {
  readonly state: AuthState;
  readonly isAuthenticated: boolean;
  readonly lastError: string | undefined;
  dispatch(event: AuthEvent): void;
  reset(): void;
  readonly onStateChanged: vscode.Event<AuthState>;
}
```

**Files Affected**:
- `src/types.ts`
- `src/targets/targetService.ts`
- `src/auth/authState.ts`

---

### Issue 4: Webview CSP Too Permissive

**Severity**: Low | **Effort**: Low | **Impact**: Security

**Problem**: Sessions panel uses `'unsafe-inline'` for styles:

```html
<!-- src/ui/sessionsPanel.ts:100 -->
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
```

**Recommendation**: Use nonce for styles (same pattern as scripts):

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
```

Then inject styles with nonce:
```html
<style nonce="${nonce}">
  /* CSS here */
</style>
```

**Files Affected**:
- `src/ui/sessionsPanel.ts`

---

### Issue 5: Username Cache Not Persisted

**Severity**: Low | **Effort**: Low | **Impact**: UX

**Problem**: Username cache is in-memory only, lost on extension reload:

```typescript
// src/connection/connectionManager.ts:139
// Simple in-memory username cache (could be persisted later)
private usernameCache: Map<string, string> = new Map();
```

**Recommendation**: Use VS Code's `ExtensionContext.globalState`:

```typescript
constructor(private context: vscode.ExtensionContext) {}

private getSavedUsername(targetId: string): string | undefined {
  return this.context.globalState.get(`username:${targetId}`);
}

private async saveUsername(targetId: string, userName: string): Promise<void> {
  await this.context.globalState.update(`username:${targetId}`, userName);
}
```

**Files Affected**:
- `src/connection/connectionManager.ts`
- `src/extension.ts` (pass context to ConnectionManager)

---

### Issue 6: SSH Config Pollution

**Severity**: Medium | **Effort**: Medium | **Impact**: UX

**Problem**: Extension creates SSH config entries without automatic cleanup:

```typescript
// src/connection/remoteSSH.ts:69-139
async function ensureSSHConfigEntry(options: RemoteSSHConnectionOptions): Promise<string> {
  // Creates entries in ~/.ssh/config with marker comments
  // No cleanup on session disconnect
}
```

**Impact**:
- User's `~/.ssh/config` grows with stale entries over time
- Manual cleanup required

**Recommendation Options**:

**Option A**: Dedicated config file with SSH Include directive
```
# ~/.ssh/config
Include ~/.ssh/boundary_hosts
```
- Pros: Isolated, easy to clean up, doesn't touch user's config
- Cons: Requires one-time setup (Include directive)

**Option B**: Track and cleanup entries
```typescript
// Track entries in globalState
const createdEntries = context.globalState.get<string[]>('sshConfigEntries', []);

// On disconnect - cleanup entry
async function cleanupSessionEntry(hostAlias: string): Promise<void> {
  await removeSSHConfigEntry(hostAlias);
  const entries = context.globalState.get<string[]>('sshConfigEntries', []);
  await context.globalState.update('sshConfigEntries',
    entries.filter(e => e !== hostAlias)
  );
}
```

**Investigation Required**: Check VS Code Remote SSH `remote.SSH.configFile` setting compatibility.

**Files Affected**:
- `src/connection/remoteSSH.ts`
- `src/connection/connectionManager.ts`

---

### Issue 7: Duplicate Session ID Generation

**Severity**: Low | **Effort**: Low | **Impact**: Consistency

**Problem**: Session IDs generated in two places with different formats:

```typescript
// src/boundary/cli.ts:395
const sessionId = `session-${Date.now()}`;

// src/connection/session.ts:17
id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
```

**Recommendation**: Consolidate to single utility:

```typescript
// src/utils/id.ts
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
```

**Files Affected**:
- `src/boundary/cli.ts`
- `src/connection/session.ts`
- New file: `src/utils/id.ts`

---

### Issue 8: Process Management Gaps

**Severity**: Medium | **Effort**: Medium | **Impact**: Reliability

**Problem**: Process cleanup has edge cases in `killProcess()`:

```typescript
// src/boundary/cli.ts:556-572
const forceKillTimeout = setTimeout(() => {
  if (!process.killed) {
    process.kill('SIGKILL');
  }
}, 5000);

// Timeout cleared on exit (line 564-566) but pattern is fragile
```

**Issues**:
- Race condition if process exits between check and kill
- No tracking if SIGTERM fails silently
- Timeout reference management is manual

**Recommendation**: Use AbortController pattern (Node 16+):

```typescript
async function killProcess(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed) { resolve(); return; }

    const controller = new AbortController();
    const cleanup = () => {
      controller.abort();
      resolve();
    };

    proc.once('exit', cleanup);
    proc.kill('SIGTERM');

    const timer = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, timeoutMs);

    controller.signal.addEventListener('abort', () => clearTimeout(timer));
  });
}
```

**Files Affected**:
- `src/boundary/cli.ts`
- `src/connection/session.ts`

---

### Issue 9: No Retry Logic for Transient Failures

**Severity**: Medium | **Effort**: Medium | **Impact**: Reliability

**Problem**: Network operations have no retry mechanism:
- `cli.listTargets()`
- `cli.authenticate()`
- `cli.connect()`

**Impact**: Single network glitch causes operation failure requiring manual retry.

**Recommendation**: Add exponential backoff utility:

```typescript
// src/utils/retry.ts
export interface RetryOptions {
  maxAttempts?: number;
  backoffMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, backoffMs = 1000, shouldRetry = () => true } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts && shouldRetry(err)) {
        await new Promise(r => setTimeout(r, backoffMs * attempt));
      }
    }
  }
  throw lastError!;
}
```

**Files Affected**:
- New file: `src/utils/retry.ts`
- `src/boundary/cli.ts`
- `src/targets/targetService.ts`

---

### Issue 10: Parser Type Safety

**Severity**: Medium | **Effort**: Medium | **Impact**: Reliability

**Problem**: Raw `JSON.parse` without runtime validation:

```typescript
// src/boundary/parser.ts:17-26
export function parseJsonResponse<T>(output: string): T {
  return JSON.parse(output) as T;  // Trusts CLI output blindly
}
```

**Impact**: Malformed or unexpected CLI output can cause runtime errors deep in call stack.

**Recommendation**: Use Zod for runtime validation:

```typescript
import { z } from 'zod';

const AuthMethodSchema = z.object({
  id: z.string(),
  scope_id: z.string(),
  name: z.string().optional(),
  type: z.enum(['oidc', 'password', 'ldap']),
  is_primary: z.boolean().default(false),
});

const AuthMethodsResponseSchema = z.object({
  status_code: z.number().optional(),
  items: z.array(AuthMethodSchema).default([]),
});

export function parseAuthMethodsResponse(output: string): BoundaryAuthMethod[] {
  const json = JSON.parse(output);
  const result = AuthMethodsResponseSchema.safeParse(json);

  if (!result.success) {
    throw new BoundaryError(
      `Invalid auth methods response: ${result.error.message}`,
      BoundaryErrorCode.PARSE_ERROR
    );
  }

  return result.data.items.map(item => ({
    id: item.id,
    scopeId: item.scope_id,
    name: item.name || getDefaultAuthMethodName(item.type),
    type: item.type,
    isPrimary: item.is_primary,
  }));
}
```

**Files Affected**:
- `src/boundary/parser.ts`
- `package.json` (add zod dependency)

---

## Implementation Phases

### Phase 1: Quick Wins (Low Effort)
- [ ] Issue 3: Add missing interfaces (`ITargetService`, `IAuthStateManager`)
- [ ] Issue 4: Fix webview CSP nonce for styles
- [ ] Issue 5: Persist username cache to globalState
- [ ] Issue 7: Consolidate session ID generation

### Phase 2: Reliability Improvements (Medium Effort)
- [ ] Issue 6: SSH config management (investigate dedicated file)
- [ ] Issue 8: Improve process management
- [ ] Issue 9: Add retry logic utility
- [ ] Issue 10: Add Zod runtime validation

### Phase 3: Architecture Refactoring (High Effort)
- [ ] Issue 1: Replace singletons with dependency injection
- [ ] Issue 2: Fix circular import risks with lazy initialization

---

## Related Documents

- [spec.md](./spec.md) - Feature specification
- [plan.md](./plan.md) - Implementation plan
- [tasks.md](./tasks.md) - Task breakdown
