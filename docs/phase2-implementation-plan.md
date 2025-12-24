# Phase 2: Session Recording View - Implementation Plan

## Current Extension Architecture

### File Structure
```
src/
├── auth/               # Authentication management
│   ├── authManager.ts  # Auth orchestration
│   └── authState.ts    # State manager with events
├── boundary/           # Boundary CLI integration
│   ├── cli.ts          # CLI wrapper
│   └── parser.ts       # CLI output parsing
├── targets/            # Target management (EXISTING)
│   ├── targetProvider.ts  # TreeDataProvider for targets
│   ├── targetService.ts   # Business logic for targets
│   └── targetItem.ts      # Tree item definitions
├── connection/         # SSH connection management
├── ui/                 # UI components
│   ├── sessionsPanel.ts   # WebView for active sessions
│   ├── quickPick.ts       # Quick pick dialogs
│   └── statusBar.ts       # Status bar integration
└── utils/              # Shared utilities
```

### Key Patterns

1. **Service Container Pattern** (`services/container.ts`):
   - Dependency injection for all services
   - Factory functions for creating services
   - Global container for singleton access

2. **TreeDataProvider Pattern** (targets view):
   - `TargetProvider implements vscode.TreeDataProvider`
   - Listens to auth state changes
   - Fetches data via `TargetService`
   - Emits `onDidChangeTreeData` for refresh

3. **State Management**:
   - `AuthStateManager` - Central auth state with event emitter
   - Services subscribe to state changes
   - UI components react to state

4. **CLI Integration**:
   - `BoundaryCLI` class wraps boundary CLI
   - Parser functions extract structured data
   - Validation with Zod schemas

## Phase 2 Implementation Plan

### Goal
Add "Recordings" view to sidebar showing session recordings with metadata

### Components to Create

#### 1. `src/recordings/recordingService.ts`
**Purpose**: Business logic for fetching and managing recordings

```typescript
export class RecordingService {
  constructor(private cli: BoundaryCLI) {}

  // Fetch recordings for a scope
  async getRecordings(scopeId: string): Promise<SessionRecording[]>

  // Fetch recording details
  async getRecordingById(id: string): Promise<SessionRecording>

  // Group recordings by target
  groupRecordingsByTarget(recordings: SessionRecording[]): Map<string, SessionRecording[]>

  // Event emitter for recording changes
  private _onRecordingsChanged = new vscode.EventEmitter<void>()
  readonly onRecordingsChanged = this._onRecordingsChanged.event
}
```

#### 2. `src/recordings/recordingProvider.ts`
**Purpose**: TreeDataProvider for recordings view (similar to TargetProvider)

```typescript
export class RecordingProvider implements vscode.TreeDataProvider<RecordingTreeItemData> {
  private recordings: SessionRecording[] = []
  private loading = false
  private error: string | undefined

  // Listen to auth state changes
  initialize(): void

  // Refresh on auth state change
  private handleAuthStateChange(state: AuthState): void

  // Fetch recordings when authenticated
  private async fetchRecordings(): Promise<void>

  // TreeDataProvider methods
  getTreeItem(element: RecordingTreeItemData): vscode.TreeItem
  getChildren(element?: RecordingTreeItemData): RecordingTreeItemData[]
}
```

#### 3. `src/recordings/recordingItem.ts`
**Purpose**: Tree item definitions for recordings

```typescript
export interface RecordingTreeItemData {
  type: 'target-group' | 'recording' | 'loading' | 'error'
  id: string
  label: string
  description?: string
  recording?: SessionRecording
}

export class RecordingTreeItem extends vscode.TreeItem {
  constructor(data: RecordingTreeItemData) {
    super(data.label,
      data.type === 'target-group'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    )
    // Set icon, tooltip, context value, etc.
  }
}
```

#### 4. `src/boundary/parser.ts` (extend)
**Purpose**: Add parsing for session recordings CLI output

```typescript
// Add to existing parser.ts
export function parseSessionRecordings(output: string): SessionRecording[] {
  const data = JSON.parse(output)
  // Parse and validate with Zod schema
  return data.items.map(parseRecording)
}

const SessionRecordingSchema = z.object({
  id: z.string(),
  created_time: z.string(),
  duration: z.string().optional(),
  target_id: z.string().optional(),
  user_id: z.string().optional(),
  // ... other fields
})
```

#### 5. `src/types.ts` (extend)
**Purpose**: Add recording types

```typescript
export interface SessionRecording {
  id: string
  created_time: string
  duration?: string
  target_id?: string
  target_name?: string
  user_id?: string
  scope_id: string
  // ... metadata
}

export interface IRecordingService {
  getRecordings(scopeId: string): Promise<SessionRecording[]>
  groupRecordingsByTarget(recordings: SessionRecording[]): Map<string, SessionRecording[]>
  onRecordingsChanged: vscode.Event<void>
}

export interface IRecordingProvider extends vscode.TreeDataProvider<RecordingTreeItemData> {
  refresh(): void
  initialize(): void
}
```

### Package.json Changes

Add to `contributes.views.boundary`:

```json
{
  "id": "boundary.recordings",
  "name": "Recordings",
  "contextualTitle": "Session Recordings",
  "when": "boundary.authenticated"
}
```

Add commands:

```json
{
  "command": "boundary.refreshRecordings",
  "title": "Boundary: Refresh Recordings",
  "icon": "$(refresh)"
},
{
  "command": "boundary.downloadRecording",
  "title": "Download Recording",
  "icon": "$(cloud-download)"
}
```

### Extension.ts Integration

```typescript
// Add to service factories
recordings: (cli) => new RecordingService(cli),

// In activate():
const recordingProvider = new RecordingProvider(
  serviceContainer.recordings,
  serviceContainer.authState
)
recordingProvider.initialize()

context.subscriptions.push(
  vscode.window.registerTreeDataProvider('boundary.recordings', recordingProvider)
)

// Register commands
context.subscriptions.push(
  vscode.commands.registerCommand('boundary.refreshRecordings', () => {
    recordingProvider.refresh()
  })
)
```

## Implementation Order

### Step 1: Types and Data Models ✅ Start Here
- [ ] Add `SessionRecording` interface to `src/types.ts`
- [ ] Add `RecordingTreeItemData` type
- [ ] Add `IRecordingService` interface
- [ ] Add `IRecordingProvider` interface

### Step 2: Boundary CLI Integration
- [ ] Add `parseSessionRecordings()` to `src/boundary/parser.ts`
- [ ] Add Zod schema for validation
- [ ] Add `listSessionRecordings()` method to `BoundaryCLI`
- [ ] Test CLI integration

### Step 3: Service Layer
- [ ] Create `src/recordings/recordingService.ts`
- [ ] Implement `getRecordings(scopeId)`
- [ ] Implement `groupRecordingsByTarget()`
- [ ] Add to service container factories

### Step 4: UI Components
- [ ] Create `src/recordings/recordingItem.ts`
- [ ] Define tree item types (target-group, recording, loading, error)
- [ ] Add icons and styling
- [ ] Create `src/recordings/recordingProvider.ts`
- [ ] Implement TreeDataProvider interface
- [ ] Add auth state listener
- [ ] Implement refresh logic

### Step 5: Extension Registration
- [ ] Add view to `package.json`
- [ ] Add commands to `package.json`
- [ ] Register provider in `extension.ts`
- [ ] Register commands in `extension.ts`
- [ ] Add menu items (view/title, view/item/context)

### Step 6: Testing & Polish
- [ ] Test with real recordings
- [ ] Add error handling
- [ ] Add loading states
- [ ] Add empty states
- [ ] Update README with screenshots

## Data Flow

```
User Opens Recordings View
    ↓
RecordingProvider.initialize()
    ↓
Listens to authState.onStateChanged
    ↓
When authenticated → fetchRecordings()
    ↓
RecordingService.getRecordings(scopeId)
    ↓
BoundaryCLI.listSessionRecordings()
    ↓
boundary session-recordings list -scope-id=<id> -format=json
    ↓
parseSessionRecordings(output)
    ↓
Returns SessionRecording[]
    ↓
Provider groups by target
    ↓
Emits onDidChangeTreeData
    ↓
VS Code renders tree view
```

## Boundary CLI Commands

```bash
# List recordings for a scope
boundary session-recordings list \
  -scope-id=<scope-id> \
  -format=json

# Get recording details
boundary session-recordings read \
  -id=<recording-id> \
  -format=json

# Download recording (Phase 3)
boundary session-recordings download \
  -id=<recording-id> \
  -format=asciicast \
  -output=<file>
```

## UI Mockup

```
BOUNDARY
├─ Targets
│  ├─ claude-ssh-injected
│  └─ gemini-ssh
├─ Sessions (WebView)
└─ Recordings  ← NEW
   ├─ 🎬 claude-ssh-injected (5 recordings)
   │  ├─ 📹 Dec 20, 2025 14:32:15 (2m 45s)
   │  ├─ 📹 Dec 20, 2025 10:15:22 (5m 12s)
   │  └─ 📹 Dec 19, 2025 16:48:09 (1m 33s)
   └─ 🎬 gemini-ssh (2 recordings)
      ├─ 📹 Dec 20, 2025 09:22:11 (3m 05s)
      └─ 📹 Dec 19, 2025 14:12:44 (8m 21s)
```

## Next Steps

Start with **Step 1: Types and Data Models** - this provides the foundation for all other components.

Would you like to:
1. Begin implementing Step 1 (types and interfaces)?
2. Review and adjust the implementation plan?
3. See examples from existing code for reference?
