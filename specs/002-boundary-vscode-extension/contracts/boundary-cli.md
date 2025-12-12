# Boundary CLI Command Contracts

This document defines the expected CLI commands, arguments, and output formats used by the extension.

## Prerequisites

- Boundary CLI installed and in PATH (or configured via `boundary.cliPath` setting)
- Boundary controller accessible (via `BOUNDARY_ADDR` env var or `-addr` flag)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BOUNDARY_ADDR` | Controller API address | Yes |
| `BOUNDARY_TOKEN` | Authentication token | No (stored in keyring) |
| `BOUNDARY_CACERT` | CA certificate path | No |
| `BOUNDARY_TLS_INSECURE` | Skip TLS verification | No |

## Commands

### Check CLI Availability

```bash
boundary version
```

**Expected Output (success)**:
```
Boundary v0.15.0
```

**Error**: Command not found indicates CLI not installed.

---

### Password Authentication

```bash
boundary authenticate password \
  -auth-method-id <auth-method-id> \
  -login-name <username> \
  -password <password> \
  -format json
```

**Success Output (JSON)**:
```json
{
  "status_code": 200,
  "item": {
    "id": "at_xxx",
    "token": "at_xxx_xxxxxxxx",
    "user_id": "u_xxx",
    "account_id": "acctpw_xxx",
    "auth_method_id": "ampw_xxx",
    "created_time": "2025-01-15T10:30:00Z",
    "updated_time": "2025-01-15T10:30:00Z",
    "approximate_last_used_time": "2025-01-15T10:30:00Z",
    "expiration_time": "2025-01-22T10:30:00Z"
  }
}
```

**Error Output**:
```json
{
  "status_code": 401,
  "status": "Unauthorized",
  "error": {
    "kind": "Unauthorized",
    "message": "Invalid login name or password"
  }
}
```

**Exit Codes**:
- `0`: Success
- `1`: Authentication failed

---

### OIDC Authentication

```bash
boundary authenticate oidc \
  -auth-method-id <auth-method-id> \
  -format json
```

**Behavior**: Opens browser for OIDC provider authentication. Blocks until complete or timeout.

**Success Output**: Same as password authentication.

---

### Get Stored Token

```bash
boundary config get-token
```

**Success Output**:
```
at_xxx_xxxxxxxx
```

**Exit Codes**:
- `0`: Token found
- `1`: No token stored

---

### List Scopes

```bash
boundary scopes list \
  -scope-id <parent-scope-id> \
  -format json
```

**Success Output (JSON)**:
```json
{
  "status_code": 200,
  "items": [
    {
      "id": "o_xxx",
      "scope_id": "global",
      "scope": {
        "id": "global",
        "type": "global",
        "name": "Global"
      },
      "name": "My Organization",
      "description": "Organization scope",
      "created_time": "2025-01-01T00:00:00Z",
      "updated_time": "2025-01-01T00:00:00Z",
      "type": "org"
    }
  ]
}
```

---

### List Targets

```bash
boundary targets list \
  -scope-id <scope-id> \
  -recursive \
  -format json
```

**Success Output (JSON)**:
```json
{
  "status_code": 200,
  "items": [
    {
      "id": "ttcp_xxx",
      "scope_id": "p_xxx",
      "scope": {
        "id": "p_xxx",
        "type": "project",
        "name": "Production",
        "parent_scope_id": "o_xxx"
      },
      "name": "web-server-ssh",
      "description": "SSH access to web server",
      "created_time": "2025-01-01T00:00:00Z",
      "updated_time": "2025-01-01T00:00:00Z",
      "version": 1,
      "type": "tcp",
      "session_max_seconds": 28800,
      "session_connection_limit": -1,
      "attributes": {
        "default_port": 22
      },
      "authorized_actions": [
        "read",
        "authorize-session"
      ]
    }
  ]
}
```

**Filtering**: Only targets with `"authorize-session"` in `authorized_actions` should be displayed to user.

---

### Authorize Session

```bash
boundary targets authorize-session \
  -id <target-id> \
  -format json
```

**Success Output (JSON)**:
```json
{
  "status_code": 200,
  "item": {
    "session_id": "s_xxx",
    "target_id": "ttcp_xxx",
    "scope": {
      "id": "p_xxx",
      "type": "project"
    },
    "created_time": "2025-01-15T10:30:00Z",
    "type": "tcp",
    "authorization_token": "at_xxx_session_token",
    "endpoint": "boundary-worker.example.com",
    "endpoint_port": 9202,
    "expiration_time": "2025-01-15T18:30:00Z",
    "credentials": []
  }
}
```

---

### Connect to Target

```bash
boundary connect \
  -target-id <target-id> \
  -listen-port 0
```

**Behavior**:
1. Spawns long-running process
2. Opens local TCP listener
3. Proxies traffic to target via Boundary worker

**Stdout Output** (what we parse for port):
```
Proxy listening on 127.0.0.1:52847
```

**Port Capture Regex**:
```typescript
const PORT_REGEX = /(?:Proxy listening|Listening) on 127\.0\.0\.1:(\d+)/i;
```

**Alternative patterns to handle**:
- `Proxy listening on 127.0.0.1:52847`
- `Listening on 127.0.0.1:52847`

**Process Lifecycle**:
- Runs until explicitly killed (SIGTERM/SIGKILL)
- Exits on connection error or auth failure
- Must be terminated when session ends

**Exit Codes**:
- `0`: Normal termination (killed)
- `1`: Connection failed
- `2`: Authorization failed

---

### Connect with SSH Helper

```bash
boundary connect ssh \
  -target-id <target-id> \
  -- -l <username>
```

**Note**: This spawns SSH client directly. For VS Code Remote SSH integration, we use `boundary connect` (TCP proxy) instead and trigger Remote SSH separately.

---

## Error Handling

### Common Error Patterns

**Not Authenticated**:
```json
{
  "status_code": 401,
  "error": {
    "kind": "Unauthorized",
    "message": "Unauthenticated request"
  }
}
```

**Token Expired**:
```json
{
  "status_code": 401,
  "error": {
    "kind": "Unauthorized",
    "message": "Token has expired"
  }
}
```

**Target Not Found**:
```json
{
  "status_code": 404,
  "error": {
    "kind": "NotFound",
    "message": "Target not found"
  }
}
```

**Permission Denied**:
```json
{
  "status_code": 403,
  "error": {
    "kind": "Forbidden",
    "message": "Forbidden"
  }
}
```

**Connection Error**:
```
Error: error performing request: Post "https://boundary.example.com/v1/...": dial tcp: connect: connection refused
```

## Parsing Strategy

### JSON Parsing

1. Always use `-format json` flag when available
2. Parse with `JSON.parse()`
3. Check `status_code` field:
   - `200`: Success, data in `item` or `items`
   - `4xx`: Client error, message in `error.message`
   - `5xx`: Server error, message in `error.message`

### Text Parsing (connect output)

1. Read stdout line by line
2. Match against port regex
3. Timeout after 30 seconds if no port captured
4. Monitor stderr for error messages

### Process Management

1. Store `ChildProcess` reference
2. Listen for `exit`, `error` events
3. Kill with `SIGTERM` on disconnect
4. Force `SIGKILL` after 5 second grace period
