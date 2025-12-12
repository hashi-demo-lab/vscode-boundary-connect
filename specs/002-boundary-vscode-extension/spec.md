# Feature Specification: VS Code Extension for HashiCorp Boundary

**Feature Branch**: `002-boundary-vscode-extension`
**Created**: 2025-12-11
**Status**: Draft
**Input**: GitHub Issue #2 - VS Code Extension for HashiCorp Boundary - Remote SSH Integration

## Overview

Develop a VS Code extension that bridges HashiCorp Boundary with VS Code's Remote SSH extension, providing seamless secure access to infrastructure without manual CLI workflows.

## Problem Statement

The current workflow for accessing Boundary-protected targets via VS Code Remote SSH requires:
1. Manual CLI authentication (`boundary authenticate`)
2. Listing and selecting targets via CLI
3. Running `boundary connect` and capturing the local port
4. Manually configuring SSH to connect to `localhost:<port>`
5. Triggering Remote SSH connection

This extension automates the entire flow within VS Code.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Authenticate with Boundary (Priority: P1)

As a developer, I want to authenticate with Boundary from within VS Code so that I can securely access protected infrastructure without leaving my IDE.

**Why this priority**: Authentication is the foundational requirement - no other functionality works without it. This delivers immediate value by eliminating the need to switch to terminal for auth.

**Independent Test**: Can be fully tested by triggering the login command and verifying token storage. Delivers value by securely storing credentials for subsequent operations.

**Acceptance Scenarios**:

1. **Given** the user has Boundary CLI installed and configured, **When** they invoke "Boundary: Login" command, **Then** they are presented with authentication method options (OIDC/Password)
2. **Given** the user selects OIDC authentication, **When** authentication completes, **Then** the token is securely stored using VS Code SecretStorage
3. **Given** the user selects Password authentication, **When** they enter valid credentials, **Then** the token is securely stored and they see a success notification
4. **Given** the user enters invalid credentials, **When** authentication fails, **Then** they see a clear error message with guidance
5. **Given** the user is already authenticated, **When** they invoke login again, **Then** they are asked if they want to re-authenticate or use existing session

---

### User Story 2 - Browse and Select Targets (Priority: P1)

As a developer, I want to browse available Boundary targets in a sidebar TreeView so that I can easily find and select the infrastructure I need to access.

**Why this priority**: Target discovery is essential for the core workflow - users need to see what they can connect to. Combined with P1 auth, this creates a usable MVP.

**Independent Test**: Can be fully tested by authenticating and viewing the TreeView. Delivers value by showing available infrastructure without CLI commands.

**Acceptance Scenarios**:

1. **Given** the user is authenticated, **When** they open the Boundary sidebar, **Then** they see a hierarchical tree of Scopes > Projects > Targets
2. **Given** the TreeView is displayed, **When** the user clicks the refresh button, **Then** the targets list is updated from Boundary
3. **Given** there are targets available, **When** the user hovers over a target, **Then** they see target details (type, address, description)
4. **Given** there are no targets available, **When** the TreeView loads, **Then** the user sees an appropriate empty state message
5. **Given** the user is not authenticated, **When** they view the sidebar, **Then** they see a login prompt/button

---

### User Story 3 - Connect to Target via Remote SSH (Priority: P1)

As a developer, I want to connect to a Boundary target with a single click and have it automatically open in Remote SSH so that I can start working immediately.

**Why this priority**: This is the core value proposition - seamless connection without manual steps. This completes the MVP when combined with auth and target browsing.

**Independent Test**: Can be fully tested by clicking a target and verifying Remote SSH opens. Delivers the primary value of the extension.

**Acceptance Scenarios**:

1. **Given** the user selects a target, **When** they click "Connect", **Then** the extension spawns `boundary connect` in the background
2. **Given** `boundary connect` is running, **When** the local proxy port is captured, **Then** Remote SSH is triggered to `localhost:<port>`
3. **Given** the connection is established, **When** Remote SSH opens, **Then** a new VS Code window connected to the target appears
4. **Given** the `boundary connect` process fails, **When** the error is detected, **Then** the user sees a clear error message with troubleshooting guidance
5. **Given** multiple connections are attempted, **When** each completes, **Then** each gets its own proxy port and Remote SSH window

---

### User Story 4 - Manage Active Sessions (Priority: P2)

As a developer, I want to see my active Boundary sessions and disconnect them when needed so that I can manage my infrastructure access and clean up resources.

**Why this priority**: Session management improves UX but is not required for basic functionality. Users can manually terminate processes if needed.

**Independent Test**: Can be tested by establishing a connection and using session management UI. Delivers value by providing visibility and control.

**Acceptance Scenarios**:

1. **Given** there are active sessions, **When** the user views the status bar, **Then** they see an indicator showing active connection count
2. **Given** the user clicks the status bar indicator, **When** the sessions list appears, **Then** they see all active connections with target names
3. **Given** the user selects "Disconnect" on a session, **When** confirmed, **Then** the `boundary connect` process is terminated and Remote SSH notified
4. **Given** all sessions are disconnected, **When** the status bar updates, **Then** it shows no active connections

---

### User Story 5 - QuickPick Target Selection (Priority: P3)

As a developer, I want to quickly search and connect to targets using a command palette interface so that I can connect faster when I know the target name.

**Why this priority**: This is a convenience feature that improves power-user workflow but is not essential for basic functionality.

**Independent Test**: Can be tested by invoking command and searching for targets. Delivers value for users who prefer keyboard-driven workflow.

**Acceptance Scenarios**:

1. **Given** the user invokes "Boundary: Connect to Target", **When** the QuickPick appears, **Then** they see a searchable list of all targets
2. **Given** targets are displayed, **When** the user types a search term, **Then** the list filters to matching targets
3. **Given** the user selects a target, **When** they press Enter, **Then** the connection flow begins

---

### Edge Cases

- What happens when Boundary CLI is not installed?
  - Display clear error message with installation instructions link
- What happens when Boundary CLI is not in PATH?
  - Allow configuration of custom CLI path in settings
- What happens when the token expires mid-session?
  - Detect auth errors and prompt for re-authentication
- What happens when Remote SSH extension is not installed?
  - Check on activation and prompt user to install with one-click button
- What happens when `boundary connect` process crashes unexpectedly?
  - Clean up resources and notify user with reconnect option
- What happens when the user closes the Remote SSH window?
  - Detect window close and terminate the corresponding `boundary connect` process
- What happens when network connectivity is lost?
  - Handle gracefully and show reconnect option when connectivity returns

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Extension MUST check for Boundary CLI availability on activation
- **FR-002**: Extension MUST support OIDC authentication method
- **FR-003**: Extension MUST support Password authentication method
- **FR-004**: Extension MUST store authentication tokens using VS Code SecretStorage API
- **FR-005**: Extension MUST display targets in a sidebar TreeView with Scope/Project/Target hierarchy
- **FR-006**: Extension MUST support target list refresh functionality
- **FR-007**: Extension MUST execute `boundary connect` command and capture the local proxy port
- **FR-008**: Extension MUST parse stdout for `Listening on 127.0.0.1:(\d+)` to extract port
- **FR-009**: Extension MUST trigger Remote SSH connection to `localhost:<captured_port>`
- **FR-010**: Extension MUST manage `boundary connect` process lifecycle (start/stop)
- **FR-011**: Extension MUST display active connection count in status bar
- **FR-012**: Extension MUST allow disconnection of active sessions
- **FR-013**: Extension MUST handle errors gracefully with user-friendly messages
- **FR-014**: Extension MUST check for Remote SSH extension dependency at runtime
- **FR-015**: Extension MUST provide QuickPick interface for target selection

### Non-Functional Requirements

- **NFR-001**: Extension MUST NOT store tokens in plaintext
- **NFR-002**: Extension MUST terminate `boundary connect` processes on deactivation
- **NFR-003**: Extension SHOULD respond to user actions within 200ms for UI operations
- **NFR-004**: Extension MUST support VS Code version 1.74.0 or higher
- **NFR-005**: Extension MUST work on Windows, macOS, and Linux

### Key Entities

- **BoundaryAuth**: Manages authentication state, token storage, and auth methods
- **BoundaryTarget**: Represents a connectable target (id, name, type, scope, project)
- **BoundarySession**: Active connection with process handle, port, and target reference
- **BoundaryScope**: Organizational unit containing projects (global, org)
- **BoundaryProject**: Container for targets within a scope

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete the full authentication → browse → connect workflow in under 30 seconds
- **SC-002**: Extension successfully captures proxy port from `boundary connect` output 100% of the time
- **SC-003**: Remote SSH connection triggers automatically within 2 seconds of port capture
- **SC-004**: All active sessions are properly terminated when extension deactivates
- **SC-005**: Error messages provide actionable guidance in 100% of failure scenarios
- **SC-006**: Extension passes all VS Code extension guidelines for marketplace publication

## Technical Constraints

- TypeScript with esbuild bundler
- VS Code Extension API v1.74.0+
- Dependency on `ms-vscode-remote.remote-ssh` extension (runtime check, not hard dependency)
- Must use `child_process` module for CLI execution
- Must use `vscode.SecretStorage` for credential storage

## Out of Scope

- Boundary server/controller management
- Target creation/modification
- Credential injection (relies on Boundary's credential brokering)
- Session recording playback
- Multi-factor authentication beyond OIDC
