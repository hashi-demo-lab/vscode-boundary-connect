# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run compile      # Build extension (esbuild)
npm run watch        # Build with file watching
npm run lint         # Run ESLint
npm test             # Run all tests (Jest)
npm run test:unit    # Run unit tests only
npm run package      # Package as .vsix
```

Run a single test file:
```bash
npx jest tests/unit/auth/authManager.test.ts
```

Run tests matching a pattern:
```bash
npx jest --testNamePattern="should authenticate"
```

## Architecture Overview

This is a VS Code extension that integrates HashiCorp Boundary with VS Code Remote SSH. The extension follows a dependency injection pattern with a service container.

### Service Container (`src/services/container.ts`)

Central DI container with lazy initialization. All services accessed via `IServiceContainer`:
- `config` - Configuration from VS Code settings
- `cli` - Boundary CLI wrapper (source of truth for tokens via keyring)
- `authState` - State machine for authentication state
- `auth` - Authentication orchestration
- `targets` - Target discovery and caching
- `connections` - Session/connection lifecycle
- `statusBar` - UI status indicators

### Module Structure

```
src/
├── auth/           # Authentication (OIDC, password, state machine)
├── boundary/       # CLI wrapper, API types, JSON parsing
├── connection/     # Session management, Remote SSH integration
├── targets/        # Target discovery, tree provider
├── ui/             # Status bar, notifications, webview panels
├── utils/          # Config, logger, errors, validation
├── services/       # DI container
├── extension.ts    # Entry point, command registration
└── types.ts        # All TypeScript interfaces
```

### Key Patterns

**Auth State Machine**: `AuthStateManager` handles state transitions (`initializing` → `authenticated` → `expired` etc.). The Boundary CLI keyring is the source of truth for tokens.

**Tree Data Provider**: `TargetProvider` implements `vscode.TreeDataProvider` for the sidebar, subscribes to auth state changes.

**Connection Flow**: `ConnectionManager` → `BoundaryCLI.connect()` → spawns `boundary connect` process → configures SSH config → opens Remote SSH.

### Testing

Tests use Jest with a VS Code mock (`tests/mocks/vscode.ts`). Test files mirror source structure under `tests/unit/`.

## Additional Guidance

See `./AGENTS.md` for TDD practices and core principles.

Check for additional `AGENTS.md` files in subdirectories for component-specific guidance.

## Working with This Codebase

- Use `AskUserQuestion` tool when clarification is needed
- Use parallel subagents for concurrent research tasks
- Update AGENTS.md files when discovering new patterns or insights
