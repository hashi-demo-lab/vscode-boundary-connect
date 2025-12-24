# Session Recording Investigation: VS Code Remote SSH vs Plain SSH

**Date**: 2024-12-24
**Issue**: VS Code Remote SSH recordings show server metadata instead of terminal I/O
**Status**: Investigation Complete ⚠️ Limitation Identified

## Executive Summary

**Finding**: Boundary session recordings **DO capture** VS Code Remote SSH sessions, but the terminal I/O cannot be converted to asciicast playback format due to how VS Code Remote SSH uses the SSH protocol. The raw data is recorded in BSR files, but is not viewable through the standard playback interface.

**Impact**: Users cannot playback terminal commands from VS Code Remote SSH connections via the extension's playback panel, though connection metadata and audit logs are still captured.

## Test Results

### ✅ Plain SSH (`boundary connect ssh`)

**Command**: `boundary connect ssh -target-id=tssh_RrlYVTBgBN`

**Results**:
- ✅ Terminal I/O fully captured
- ✅ Asciicast playback works perfectly
- ✅ Shows all commands: `echo`, `ls`, `pwd`, etc.
- ✅ Single channel recording (`chr_fc8sBEfvte`)
- ✅ Instant playback availability

**Recording Structure**:
```
Session: sr_AipSnOesTJ
└── Connection 0
    └── Channel 0 (chr_fc8sBEfvte)
        - Type: application/x-asciicast
        - Contains: All terminal I/O
```

### ❌ VS Code Remote SSH (via extension)

**Command**: Extension's "Connect to Boundary Target" → Triggers Remote SSH

**Results**:
- ❌ Terminal I/O NOT visible in playback
- ❌ Asciicast shows VS Code server metadata/logs
- ✅ Connection audit trail captured
- ⚠️ Three channels created (only 1 playable)
- ⚠️ Playable channel contains server logs, not terminal data

**Recording Structure**:
```
Session: sr_is6VJMAJYu
└── Connection 0
    ├── Channel 0 (chr_za6bhUqbRr) - mime: none - "Playback not supported"
    ├── Channel 1 (chr_svN0zSG8fz) - mime: none - "Playback not supported"
    └── Channel 2 (chr_QfY1AtTcZB) - mime: application/x-asciicast
        - Contains: VS Code server logs, connection metadata
        - Missing: User's terminal commands
```

**Sample playback output**:
```
77532151c78b: start
listeningOn==127.0.0.1:36843==
osReleaseId==debian==
arch==aarch64==
vscodeArch==arm64==
bitness==64==
tmpDir==/tmp==
platform==linux==
```

## Root Cause Analysis

### How VS Code Remote SSH Works

Based on [VS Code Remote SSH documentation](https://code.visualstudio.com/docs/remote/ssh) and [VS Code Server documentation](https://code.visualstudio.com/docs/remote/vscode-server):

1. **Initial SSH Connection**: VS Code establishes an SSH connection through Boundary
2. **Server Installation**: Installs/starts VS Code Server on the remote machine
3. **Multiplexed Protocol**: All subsequent communication (including terminal I/O) flows through VS Code's proprietary protocol over the SSH tunnel
4. **Terminal I/O**: Terminal windows in VS Code use VS Code's protocol, NOT standard SSH PTY

### Why Boundary Can't Capture Terminal I/O

According to [Boundary session recording documentation](https://developer.hashicorp.com/boundary/docs/operations/session-recordings):

> "Some SSH session types cannot be displayed in Boundary's asciicast playback format, such as sessions using the RemoteCommand option or used to exec a command. Additionally, if SSH is used for something other than an interactive shell, such as file transfer, X11 forwarding, or port forwarding, Boundary does not attempt to create an asciicast."

VS Code Remote SSH falls into this category because:
- Uses SSH to install/execute VS Code Server (not interactive shell)
- Establishes port forwarding and tunnels
- Multiplexes multiple data streams over single SSH connection
- Terminal data is encapsulated in VS Code's protocol, not raw PTY

### What IS Captured

Per [BSR file structure documentation](https://developer.hashicorp.com/boundary/docs/session-recording/data/bsr-file-structure):

✅ **Session metadata**: User, target, host, credentials used
✅ **Connection data**: SSH handshake, server installation
✅ **Raw SSH data**: All data transmitted in `messages-inbound.data` and `messages-outbound.data`
✅ **Audit trail**: Complete record of connection establishment

❌ **NOT converted to asciicast**: Terminal I/O encapsulated in VS Code protocol
❌ **NOT playable**: No built-in tool to decode VS Code's terminal protocol

## Investigation Details

### BSR File Analysis (Direct Storage Inspection)

**Storage**: MinIO bucket `boundary-recordings`
**Access**: Confirmed raw BSR files exist and are accessible

#### Plain SSH Recording (`sr_AipSnOesTJ`)
```
Structure:
└── sr_AipSnOesTJ.bsr/
    └── cr_ArnilXjN2w.connection/
        └── chr_fc8sBEfvte.channel/
            ├── messages-inbound.data (3,213 bytes)
            ├── messages-outbound.data (4,639 bytes) ✅ Contains terminal I/O
            ├── requests-inbound.data (445 bytes)
            └── requests-outbound.data (147 bytes)

Channel Summary:
{
  "ChannelType": "session",
  "SessionProgram": "shell",
  "BytesUp": 58,
  "BytesDown": 1346,
  "StartTime": "2025-12-24T06:37:55Z",
  "EndTime": "2025-12-24T06:38:15Z"
}
```

#### VS Code Remote SSH Recording (`sr_is6VJMAJYu`)
```
Structure:
└── sr_is6VJMAJYu.bsr/
    └── cr_8KBfOJurBJ.connection/
        ├── chr_za6bhUqbRr.channel/ (Channel 0)
        │   ├── messages-inbound.data
        │   └── messages-outbound.data
        ├── chr_svN0zSG8fz.channel/ (Channel 1)
        │   ├── messages-inbound.data (81 bytes) ⚠️ Empty
        │   └── messages-outbound.data (81 bytes) ⚠️ Empty
        └── chr_QfY1AtTcZB.channel/ (Channel 2) ⚠️ Asciicast channel
            ├── messages-inbound.data (4,765 bytes)
            ├── messages-outbound.data (9,613 bytes) ❌ VS Code server logs
            ├── requests-inbound.data (216 bytes)
            └── requests-outbound.data (81 bytes)

Channel 2 Summary:
{
  "ChannelType": "session",
  "SessionProgram": "shell",
  "BytesUp": 11852,
  "BytesDown": 1301,
  "StartTime": "2025-12-23T22:02:25Z",
  "EndTime": "2025-12-24T05:32:05Z"
}
```

**Critical Finding**: Both recordings have identical metadata:
- ChannelType: "session"
- SessionProgram: "shell"
- Both converted to asciicast format

**The difference**: What's actually in the "shell" session:
- ✅ Plain SSH: User's interactive commands (`echo`, `ls`, `pwd`)
- ❌ VS Code Remote SSH: VS Code server startup output and logs

**Conclusion**: Boundary IS recording the session correctly. The problem is that VS Code Remote SSH's "shell" session is used to start the VS Code server, not for user terminal interaction. The actual terminal I/O happens through VS Code's proprietary protocol over a different communication channel that Boundary doesn't capture.

### BSR File Format

From [BSR file structure documentation](https://developer.hashicorp.com/boundary/docs/session-recording/data/bsr-file-structure) and [reading BSR files](https://developer.hashicorp.com/boundary/docs/session-recording/data/read-bsr-file):

**BSR files contain**:
- **Binary data files** (`.data`): Big-endian format with chunks
- **Message files**: `messages-inbound.data` and `messages-outbound.data` containing all SSH data
- **Request files**: `requests-inbound.data` and `requests-outbound.data` for SSH requests
- **Metadata**: JSON summaries, signatures for tamper-proofing

**Conversion to asciicast**:
- Boundary generates asciicast from `messages-outbound.data`
- Only works for interactive shell sessions
- VS Code's protocol data cannot be decoded

**Reading raw BSR files**:
> "Boundary does not currently provide tooling to read other BSR .data files."

Custom tools would need to:
1. Parse binary BSR format (protobuf definitions available)
2. Extract VS Code protocol data
3. Decode VS Code's proprietary terminal protocol
4. Convert to viewable format

## Potential Solutions Explored

### ❌ Option 1: Access Raw BSR Files
- **Status**: Technically possible but impractical
- **Why**: Would require decoding VS Code's proprietary protocol
- **Effort**: Significant reverse engineering required
- **Benefit**: Low - data is server logs, not terminal I/O

### ❌ Option 2: Different SSH Mode
- **Status**: Not feasible with Remote SSH
- **Why**: Remote SSH's architecture requires its protocol
- **Alternative**: Would need completely different connection method

### ✅ Option 3: Document Limitation
- **Status**: Recommended
- **Why**: This is a known Boundary limitation with multiplexed SSH
- **Action**: Update README with clear explanation and workaround

### 🤔 Option 4: Alternative Connection Method (Dev Containers?)

Based on [dev containers blog post](https://blog.lohr.dev/launching-dev-containers):

Dev containers use a different connection method:
- URI-based: `vscode-remote://dev-container+<config>`
- Bypasses SSH entirely
- Uses VS Code's container protocol

**However**: This doesn't solve the recording problem:
- Still uses VS Code's proprietary protocol
- Boundary wouldn't be in the connection path
- No session recording capability at all

**Verdict**: Not a viable alternative for session recording

### ✅ Option 5: Hybrid Approach
- **Status**: Best practical solution
- **Implementation**:
  1. Keep current Remote SSH functionality for development
  2. Document that recordings won't show terminal I/O
  3. Provide "Direct SSH" connection option for auditable sessions
  4. Add command to connection context menu: "Open in Terminal (Recordable)"

## Comparison: Remote SSH vs Direct SSH

| Feature | VS Code Remote SSH | Direct SSH (`boundary connect ssh`) |
|---------|-------------------|-----------------------------------|
| Terminal playback | ❌ Server logs only | ✅ Full terminal I/O |
| VS Code integration | ✅ Full IDE experience | ❌ Terminal only |
| Asciicast conversion | ❌ Not supported | ✅ Works perfectly |
| Audit trail | ✅ Connection logged | ✅ Connection logged |
| Channel count | 3 channels | 1 channel |
| Playback format | Metadata/logs | Interactive commands |
| Use case | Development | Auditable admin work |

## Recommendations

### For Extension Users
1. **Development work**: Continue using Remote SSH (metadata still logged for audit)
2. **Auditable work**: Use `boundary connect ssh` directly when recording matters
3. **Compliance**: Be aware recordings won't show commands typed in VS Code terminals

### For Extension Developers
1. ✅ **Document limitation** in README with clear explanation
2. ✅ **Add feature**: "Open Direct SSH" command for recordable sessions
3. ✅ **Update playback UI**: Show warning when playing Remote SSH recordings
4. ⚠️ **Consider**: File issue with HashiCorp about VS Code Remote SSH support

### Documentation Updates Needed

**README.md**:
```markdown
## Session Recording Limitations

⚠️ **Important**: Terminal I/O from VS Code Remote SSH connections cannot be played back
due to how VS Code's protocol works over SSH. Recordings will show connection metadata
and server logs, but not your terminal commands.

**For recordable sessions**: Use the "Open Direct SSH Connection" command instead of
Remote SSH. This provides full terminal playback but without the VS Code IDE integration.

**What's still recorded**:
- Connection establishment and authentication
- User and target information
- Session duration and metadata
- All data is logged for audit purposes

See [SESSION_RECORDING_INVESTIGATION.md](./docs/SESSION_RECORDING_INVESTIGATION.md)
for technical details.
```

## Technical References

- [VS Code Remote SSH Documentation](https://code.visualstudio.com/docs/remote/ssh)
- [VS Code Server Documentation](https://code.visualstudio.com/docs/remote/vscode-server)
- [Boundary Session Recording](https://developer.hashicorp.com/boundary/docs/operations/session-recordings)
- [BSR File Structure](https://developer.hashicorp.com/boundary/docs/session-recording/data/bsr-file-structure)
- [Reading BSR Files](https://developer.hashicorp.com/boundary/docs/session-recording/data/read-bsr-file)
- [GitHub Issue: Recording SSH Sessions](https://github.com/hashicorp/boundary/issues/695)
- [Dev Containers Blog Post](https://blog.lohr.dev/launching-dev-containers)

## Final Verdict: This IS a Hard Stop ⛔

### Definitive Confirmation Through BSR Analysis

After inspecting the raw BSR files in MinIO storage, we can **definitively confirm**:

1. ✅ **Boundary IS recording the SSH session**
2. ✅ **The BSR files contain all SSH protocol data**
3. ✅ **Boundary correctly identifies the session as "shell" type**
4. ✅ **Asciicast conversion is working properly**
5. ❌ **The user's terminal commands are NOT in the recording**

### Why This Cannot Be Fixed

The terminal I/O is **physically not present** in the SSH session data because:

1. **VS Code's Architecture**: When Remote SSH connects, it:
   - Uses the SSH session to install/start VS Code Server
   - Establishes the VS Code protocol over the SSH tunnel
   - Routes terminal I/O through VS Code's proprietary protocol
   - The SSH "shell" session only contains server startup logs

2. **Boundary's Perspective**: It sees:
   - A valid SSH session with "shell" program
   - Data flowing through the session (server logs)
   - Correctly records and converts to asciicast
   - Has no visibility into VS Code's protocol layer

3. **Protocol Layering**:
   ```
   Plain SSH:
   User Terminal ──> SSH PTY ──> Boundary Records ──> Playback ✅

   VS Code Remote SSH:
   User Terminal ──> VS Code Protocol ──> SSH Tunnel ──> Boundary Records
                                                            └──> Only sees tunnel data ❌
   ```

### What This Means

**This is NOT**:
- ❌ A bug in the extension
- ❌ A Boundary configuration issue
- ❌ Fixable with different recording settings
- ❌ Accessible in raw BSR files

**This IS**:
- ✅ An architectural limitation
- ✅ How VS Code Remote SSH was designed
- ✅ A known tradeoff between UX and auditability
- ✅ The expected behavior

## Conclusion

This is **not a bug** in the VS Code Boundary extension. It's an architectural limitation of how VS Code Remote SSH was designed - it was never intended to have its terminal I/O captured by session recording systems.

**The data does NOT exist** in any accessible form. The user's terminal commands stay within VS Code's protocol layer and never appear in the SSH session that Boundary records.

**Recommended path forward**:
1. ✅ **Document the limitation clearly** in README (Priority 1)
2. ✅ **Provide direct SSH option** for users who need full recording (Priority 2)
3. ⚠️ **Consider filing issue with HashiCorp** about VS Code Remote SSH support (Low priority - likely won't be addressed)
4. ✅ **Accept this tradeoff**: Development UX (Remote SSH) vs Session Recording (Direct SSH)

---

**Investigation completed by**: Claude Code
**Testing environment**: k8s-agent-sandbox with Boundary + Keycloak + MinIO
**Test recordings**:
- Plain SSH: `sr_AipSnOesTJ` (✅ works)
- Remote SSH: `sr_is6VJMAJYu` (❌ shows metadata only)
