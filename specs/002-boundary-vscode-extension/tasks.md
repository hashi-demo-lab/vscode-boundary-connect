# Tasks: VS Code Extension for HashiCorp Boundary

**Input**: Design documents from `/specs/002-boundary-vscode-extension/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and VS Code extension scaffold

- [ ] T001 Scaffold VS Code extension using `yo code` generator with TypeScript and esbuild
- [ ] T002 [P] Configure `package.json` with extension metadata, commands, views, and contributions
- [ ] T003 [P] Configure `tsconfig.json` for ES2022 target with strict mode
- [ ] T004 [P] Configure esbuild for extension bundling in `esbuild.js`
- [ ] T005 [P] Configure ESLint with TypeScript rules in `.eslintrc.json`
- [ ] T006 [P] Create `.vscode/launch.json` for extension debugging
- [ ] T007 [P] Create `.vscode/tasks.json` for build tasks
- [ ] T008 Create base directory structure per plan.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T009 [P] Create error types and error handling utilities in `src/utils/errors.ts`
- [ ] T010 [P] Create logging utilities in `src/utils/logger.ts`
- [ ] T011 [P] Create configuration service in `src/utils/config.ts`
- [ ] T012 [P] Create TypeScript interfaces (copy from contracts/types.ts) in `src/types.ts`
- [ ] T013 Implement BoundaryCLI wrapper base class in `src/boundary/cli.ts`
- [ ] T014 Implement CLI output parser in `src/boundary/parser.ts`
- [ ] T015 Create extension entry point scaffold in `src/extension.ts` (activate/deactivate stubs)
- [ ] T016 [P] Create test mocks for VS Code API in `tests/mocks/vscode.ts`
- [ ] T017 [P] Create test mocks for Boundary CLI in `tests/mocks/boundary.ts`
- [ ] T018 Configure Jest for unit testing in `jest.config.js`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Authenticate with Boundary (Priority: P1)

**Goal**: Enable users to authenticate with Boundary (OIDC/Password) and securely store tokens

**Independent Test**: Invoke login command, verify token is stored in SecretStorage

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T019 [P] [US1] Unit test for AuthManager in `tests/unit/auth/authManager.test.ts`
- [ ] T020 [P] [US1] Unit test for password auth flow in `tests/unit/auth/passwordAuth.test.ts`
- [ ] T021 [P] [US1] Unit test for OIDC auth flow in `tests/unit/auth/oidcAuth.test.ts`
- [ ] T022 [P] [US1] Unit test for BoundaryCLI authenticate in `tests/unit/boundary/cli.test.ts`

### Implementation for User Story 1

- [ ] T023 [US1] Implement AuthManager class in `src/auth/authManager.ts`
- [ ] T024 [P] [US1] Implement password authentication in `src/auth/passwordAuth.ts`
- [ ] T025 [P] [US1] Implement OIDC authentication in `src/auth/oidcAuth.ts`
- [ ] T026 [US1] Add `boundary.login` command implementation in `src/extension.ts`
- [ ] T027 [US1] Add `boundary.logout` command implementation in `src/extension.ts`
- [ ] T028 [US1] Implement auth method picker QuickPick in `src/ui/quickPick.ts`
- [ ] T029 [US1] Implement password input flow with InputBox
- [ ] T030 [US1] Add auth state event emitter and subscription handling
- [ ] T031 [US1] Register commands in `package.json` contributions

**Checkpoint**: User Story 1 complete - users can login/logout with Boundary

---

## Phase 4: User Story 2 - Browse and Select Targets (Priority: P1)

**Goal**: Display available targets in sidebar TreeView with hierarchical browsing

**Independent Test**: Authenticate, open sidebar, verify targets appear in tree structure

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T032 [P] [US2] Unit test for TargetProvider in `tests/unit/targets/targetProvider.test.ts`
- [ ] T033 [P] [US2] Unit test for TargetService in `tests/unit/targets/targetService.test.ts`
- [ ] T034 [P] [US2] Unit test for BoundaryCLI listTargets in `tests/unit/boundary/cli.test.ts`

### Implementation for User Story 2

- [ ] T035 [P] [US2] Create TargetTreeItem class in `src/targets/targetItem.ts`
- [ ] T036 [US2] Implement TargetService for fetching/caching targets in `src/targets/targetService.ts`
- [ ] T037 [US2] Implement TargetProvider (TreeDataProvider) in `src/targets/targetProvider.ts`
- [ ] T038 [US2] Add listTargets method to BoundaryCLI in `src/boundary/cli.ts`
- [ ] T039 [US2] Add listScopes method to BoundaryCLI in `src/boundary/cli.ts`
- [ ] T040 [US2] Add `boundary.refresh` command for manual refresh
- [ ] T041 [US2] Handle unauthenticated state in TreeView (show login prompt)
- [ ] T042 [US2] Register TreeView in `package.json` contributions
- [ ] T043 [US2] Create TreeView icons in `resources/icons/`
- [ ] T044 [US2] Wire AuthManager state changes to TreeView refresh

**Checkpoint**: User Story 2 complete - users can browse targets in sidebar

---

## Phase 5: User Story 3 - Connect to Target via Remote SSH (Priority: P1)

**Goal**: One-click connect to target, spawning boundary connect and triggering Remote SSH

**Independent Test**: Click target, verify Remote SSH window opens connected to localhost proxy

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T045 [P] [US3] Unit test for ConnectionManager in `tests/unit/connection/connectionManager.test.ts`
- [ ] T046 [P] [US3] Unit test for RemoteSSH integration in `tests/unit/connection/remoteSSH.test.ts`
- [ ] T047 [P] [US3] Unit test for port capture parser in `tests/unit/boundary/parser.test.ts`

### Implementation for User Story 3

- [ ] T048 [US3] Implement Session class in `src/connection/session.ts`
- [ ] T049 [US3] Implement ConnectionManager in `src/connection/connectionManager.ts`
- [ ] T050 [US3] Implement port capture from `boundary connect` stdout in `src/boundary/cli.ts`
- [ ] T051 [US3] Implement RemoteSSH integration in `src/connection/remoteSSH.ts`
- [ ] T052 [US3] Add `boundary.connectTarget` command (triggered from TreeView)
- [ ] T053 [US3] Add connection progress notification with withProgress
- [ ] T054 [US3] Handle process lifecycle (exit, error events)
- [ ] T055 [US3] Check for Remote SSH extension availability
- [ ] T056 [US3] Add context menu to TreeView for connect action
- [ ] T057 [US3] Handle connection errors with user-friendly messages

**Checkpoint**: User Story 3 complete - core MVP functional (auth → browse → connect)

---

## Phase 6: User Story 4 - Manage Active Sessions (Priority: P2)

**Goal**: Status bar showing active sessions, ability to disconnect

**Independent Test**: Connect to target, verify status bar shows session, disconnect works

### Tests for User Story 4

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T058 [P] [US4] Unit test for StatusBarManager in `tests/unit/ui/statusBar.test.ts`
- [ ] T059 [P] [US4] Unit test for session disconnect in `tests/unit/connection/connectionManager.test.ts`

### Implementation for User Story 4

- [ ] T060 [US4] Implement StatusBarManager in `src/ui/statusBar.ts`
- [ ] T061 [US4] Add `boundary.disconnect` command
- [ ] T062 [US4] Add `boundary.disconnectAll` command
- [ ] T063 [US4] Add `boundary.showSessions` command with QuickPick
- [ ] T064 [US4] Wire ConnectionManager events to StatusBarManager
- [ ] T065 [US4] Implement graceful process termination (SIGTERM → SIGKILL)
- [ ] T066 [US4] Register status bar contribution in `package.json`

**Checkpoint**: User Story 4 complete - users can manage active sessions

---

## Phase 7: User Story 5 - QuickPick Target Selection (Priority: P3)

**Goal**: Command palette interface for quick target search and connect

**Independent Test**: Invoke command, search for target, select and connect

### Tests for User Story 5

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T067 [P] [US5] Unit test for QuickPick target search in `tests/unit/ui/quickPick.test.ts`

### Implementation for User Story 5

- [ ] T068 [US5] Implement target QuickPick in `src/ui/quickPick.ts`
- [ ] T069 [US5] Add `boundary.connect` command (QuickPick flow)
- [ ] T070 [US5] Add target search/filter functionality
- [ ] T071 [US5] Register `boundary.connect` command in `package.json`

**Checkpoint**: User Story 5 complete - power users can use keyboard-driven flow

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, marketplace preparation

- [ ] T072 [P] Create README.md with features, installation, usage
- [ ] T073 [P] Create CHANGELOG.md for release notes
- [ ] T074 [P] Create extension icon in `resources/images/logo.png`
- [ ] T075 [P] Add extension keywords and categories in `package.json`
- [ ] T076 Implement cleanup in `deactivate()` - terminate all sessions
- [ ] T077 [P] Add configuration settings to `package.json` (boundary.cliPath, etc.)
- [ ] T078 Handle CLI not found error with installation instructions
- [ ] T079 Handle Remote SSH extension not installed with install prompt
- [ ] T080 [P] Integration test for extension lifecycle in `tests/integration/extension.test.ts`
- [ ] T081 Run `vsce package` to validate extension packaging
- [ ] T082 Final code review and cleanup

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - US1 (Auth) should complete first as US2/US3 depend on auth state
  - US2 (Browse) can start after US1 basics
  - US3 (Connect) depends on US1 and US2
  - US4 (Sessions) depends on US3
  - US5 (QuickPick) depends on US2 and US3
- **Polish (Phase 8)**: Depends on all P1 stories being complete

### Parallel Opportunities

Within each phase, tasks marked [P] can run in parallel:

**Phase 1 Parallel**:
```
T002, T003, T004, T005, T006, T007 (all can run together)
```

**Phase 2 Parallel**:
```
T009, T010, T011, T012, T016, T017 (all can run together)
```

**User Story Tests Parallel** (within each story):
```
All test tasks marked [P] can run together
```

### Critical Path

```
T001 → T008 → T013 → T014 → T015 → T023 → T037 → T049 → T051
(scaffold → structure → CLI → parser → entry → auth → targets → connect → SSH)
```

---

## Implementation Strategy

### MVP First (P1 Stories Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phase 3: User Story 1 (Auth)
4. Complete Phase 4: User Story 2 (Browse)
5. Complete Phase 5: User Story 3 (Connect)
6. **STOP and VALIDATE**: Test full workflow
7. Deploy/demo if ready

### TDD Approach

For each user story:
1. Write ALL tests first (T0XX-T0XX)
2. Verify tests FAIL
3. Implement functionality
4. Verify tests PASS
5. Refactor if needed
6. Move to next story

---

## Notes

- [P] tasks = different files, no dependencies
- [USX] label maps task to specific user story for traceability
- Verify tests fail before implementing
- Commit after each task or logical group
- Extension should work in isolation after each P1 story checkpoint
