# Seamless DevContainer Architecture Proposal

## Executive Summary

This proposal extends the existing [k8s-agent-sandbox](https://github.com/CloudbrokerAz/k8s-agent-sandbox) architecture to support **multi-developer team scenarios** with warm sandbox pools accessed via HashiCorp Boundary and VS Code.

**Current State**: Single-developer sandboxes using Sandbox CRD + envbuilder + Boundary SSH already provide seamless one-click access.

**Gap**: Multi-developer teams sharing access to sandbox pools need session isolation, developer-to-sandbox assignment, and file separation strategies.

**Target Experience**: Any team member clicks "Connect" → Assigned to their sandbox → Working in < 10 seconds.

---

## Current Architecture (Single Developer)

The existing k8s-agent-sandbox provides seamless access for individual developers:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     CURRENT: SINGLE-DEVELOPER SANDBOX ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Developer                    Boundary                      Kubernetes                   │
│  Workstation                  (HCP/Self-hosted)             (agent-sandbox)              │
│                                                                                          │
│  ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────────────┐   │
│  │ VS Code         │         │ Controller      │         │ Sandbox CRD             │   │
│  │ + Boundary Ext  │         │ + Workers       │         │ (claude-code-sandbox)   │   │
│  └────────┬────────┘         └────────┬────────┘         └────────────┬────────────┘   │
│           │                           │                               │                 │
│           │ 1. Connect to Target      │                               │                 │
│           ├──────────────────────────►│                               │                 │
│           │                           │                               │                 │
│           │ 2. Vault SSH Certificate  │         ┌─────────────────────┴──────────────┐ │
│           │◄──────────────────────────┤         │  Pod: envbuilder + devcontainer    │ │
│           │    (24hr TTL, user cert)  │         │  ┌─────────────────────────────┐   │ │
│           │                           │         │  │ SSH Server (:22)            │   │ │
│           │ 3. TCP Proxy              │         │  │ - Vault CA trusted          │   │ │
│           │    localhost:2250 ────────┼────────►│  │ - No password auth          │   │ │
│           │                           │         │  ├─────────────────────────────┤   │ │
│           │                           │         │  │ code-server (:13337)        │   │ │
│           │ 4. VS Code Remote SSH     │         │  │ - Browser IDE fallback      │   │ │
│           │    Opens /workspaces/repos│         │  ├─────────────────────────────┤   │ │
│           ├───────────────────────────┼────────►│  │ Dev Tools                   │   │ │
│           │                           │         │  │ - Claude Code / Gemini CLI  │   │ │
│           │                           │         │  │ - Terraform, AWS CLI, etc   │   │ │
│           │ 5. Working (< 10 sec)     │         │  └─────────────────────────────┘   │ │
│           │                           │         │  /workspaces (25Gi PVC)            │ │
│           │                           │         └────────────────────────────────────┘ │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘

Key Components:
- Sandbox CRD: kubernetes-sigs/agent-sandbox manages pod lifecycle
- envbuilder: Builds devcontainer.json at runtime (cached after first build)
- Vault SSH CA: TrustedUserCAKeys in sshd_config, certs signed per-session
- ClusterIP Service: Exposes SSH:22 and code-server:13337 internally
- Boundary Target: Routes to ClusterIP service
```

---

## Gap: Multi-Developer Team Scenarios

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          PROBLEM: TEAM SHARING SANDBOX POOLS                             │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Team: "App Team Alpha"                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                                   │
│  │  Alice   │ │   Bob    │ │  Carol   │ │  David   │                                   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘                                   │
│       │            │            │            │                                          │
│       └────────────┴─────┬──────┴────────────┘                                          │
│                          │                                                               │
│                          ▼                                                               │
│              ┌───────────────────────┐                                                  │
│              │ Boundary Target:      │                                                  │
│              │ "app-team-sandbox"    │                                                  │
│              └───────────┬───────────┘                                                  │
│                          │                                                               │
│                          ▼                                                               │
│              ┌───────────────────────────────────────────────────────┐                  │
│              │           Sandbox Pool (Host Set)                     │                  │
│              │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │                  │
│              │  │sandbox-1│ │sandbox-2│ │sandbox-3│ │sandbox-4│     │                  │
│              │  │  (???)  │ │  (???)  │ │  (???)  │ │  (???)  │     │                  │
│              │  └─────────┘ └─────────┘ └─────────┘ └─────────┘     │                  │
│              └───────────────────────────────────────────────────────┘                  │
│                                                                                          │
│  QUESTIONS:                                                                              │
│  ─────────────────────────────────────────────────────────────────────────────────────  │
│  1. How does each developer get assigned to a specific sandbox?                         │
│  2. How do they return to the SAME sandbox across sessions?                             │
│  3. What happens if two developers connect to the same sandbox?                         │
│  4. How are workspaces and files kept separate?                                         │
│  5. How does the VS Code extension know which sandbox to connect to?                    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Proposed Solutions for Multi-Developer Scenarios

### Solution Comparison

| Approach | Developer Assignment | Sandbox State | Boundary Config | Extension Changes |
|----------|---------------------|---------------|-----------------|-------------------|
| **A: 1:1 Dedicated Targets** | Static (per-user target) | Persistent | One target per dev | None |
| **B: Pool + Host-ID Selection** | Extension-managed | Persistent | One target + host set | Add `-host-id` support |
| **C: Pool + Assignment Service** | External service | Persistent | Dynamic host discovery | API integration |
| **D: Ephemeral + Git State** | Any available | Stateless | Pool target | Git clone on connect |

---

### Solution A: Dedicated Targets per Developer (Simplest)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                      SOLUTION A: 1:1 DEVELOPER-TO-TARGET MAPPING                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Boundary Targets                              Kubernetes Sandboxes                      │
│  (one per developer)                           (one per developer)                       │
│                                                                                          │
│  ┌──────────────────────┐                     ┌──────────────────────┐                  │
│  │ target: alice-sandbox│────────────────────►│ sandbox-alice        │                  │
│  │ host: sandbox-alice  │                     │ PVC: alice-workspace │                  │
│  └──────────────────────┘                     └──────────────────────┘                  │
│                                                                                          │
│  ┌──────────────────────┐                     ┌──────────────────────┐                  │
│  │ target: bob-sandbox  │────────────────────►│ sandbox-bob          │                  │
│  │ host: sandbox-bob    │                     │ PVC: bob-workspace   │                  │
│  └──────────────────────┘                     └──────────────────────┘                  │
│                                                                                          │
│  ┌──────────────────────┐                     ┌──────────────────────┐                  │
│  │ target: carol-sandbox│────────────────────►│ sandbox-carol        │                  │
│  │ host: sandbox-carol  │                     │ PVC: carol-workspace │                  │
│  └──────────────────────┘                     └──────────────────────┘                  │
│                                                                                          │
│  Pros:                                         Cons:                                     │
│  ✓ No extension changes needed                 ✗ Target proliferation                   │
│  ✓ Simple RBAC (target = user)                 ✗ Manual provisioning per user           │
│  ✓ Complete isolation                          ✗ Doesn't scale for large teams          │
│  ✓ Predictable state persistence               ✗ Requires Terraform/automation          │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Terraform Example:**
```hcl
# Create sandbox + target per developer
variable "developers" {
  default = ["alice", "bob", "carol"]
}

resource "boundary_target" "sandbox" {
  for_each     = toset(var.developers)
  name         = "${each.key}-sandbox"
  scope_id     = boundary_scope.dev.id
  type         = "ssh"
  default_port = 22
  host_source_ids = [boundary_host_static.sandbox[each.key].id]
}
```

---

### Solution B: Shared Pool with Host-ID Selection (Recommended)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    SOLUTION B: POOL TARGET WITH HOST-ID SELECTION                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│                      Boundary Target                                                     │
│                      (shared by team)                                                    │
│                                                                                          │
│                    ┌─────────────────────┐                                              │
│                    │ target: team-sandbox│                                              │
│                    │ host_set: pool      │                                              │
│                    └──────────┬──────────┘                                              │
│                               │                                                          │
│      ┌────────────────────────┼────────────────────────┐                                │
│      │                        │                        │                                │
│      ▼                        ▼                        ▼                                │
│  ┌─────────┐             ┌─────────┐             ┌─────────┐                           │
│  │sandbox-1│             │sandbox-2│             │sandbox-3│    Sandbox Pool           │
│  │hst_abc  │             │hst_def  │             │hst_ghi  │                           │
│  └─────────┘             └─────────┘             └─────────┘                           │
│      ▲                        ▲                        ▲                                │
│      │                        │                        │                                │
│  boundary connect         boundary connect         boundary connect                     │
│  -host-id=hst_abc         -host-id=hst_def         -host-id=hst_ghi                    │
│      │                        │                        │                                │
│  ┌───┴───┐                ┌───┴───┐                ┌───┴───┐                           │
│  │ Alice │                │  Bob  │                │ Carol │                           │
│  └───────┘                └───────┘                └───────┘                           │
│                                                                                          │
│  Extension stores: { "alice": "hst_abc", "bob": "hst_def", "carol": "hst_ghi" }        │
│                                                                                          │
│  Pros:                                         Cons:                                     │
│  ✓ Single target for team                      ✗ Requires extension changes             │
│  ✓ Pool scales independently                   ✗ Need assignment persistence            │
│  ✓ Existing Boundary RBAC works                ✗ First-time assignment UX               │
│  ✓ Standard host set patterns                                                           │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Extension Changes Required:**
```typescript
// Add to ConnectOptions
interface ConnectOptions {
  hostId?: string;  // NEW: Specific host from host set
}

// Add to connect() in cli.ts
if (options.hostId) {
  args.push('-host-id', options.hostId);
}

// Store developer→host mapping
interface DeveloperAssignment {
  developerId: string;    // From Boundary auth (user ID or email)
  hostId: string;         // Assigned sandbox host
  targetId: string;       // Pool target
  assignedAt: Date;
}
```

---

### Solution C: External Assignment Service

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    SOLUTION C: ASSIGNMENT SERVICE ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────┐      ┌─────────────────────┐      ┌─────────────────────┐             │
│  │  VS Code    │      │  Assignment Service │      │  Kubernetes         │             │
│  │  Extension  │      │  (API)              │      │  Sandbox Pool       │             │
│  └──────┬──────┘      └──────────┬──────────┘      └──────────┬──────────┘             │
│         │                        │                            │                         │
│         │ 1. Request sandbox     │                            │                         │
│         │    (user: alice)       │                            │                         │
│         ├───────────────────────►│                            │                         │
│         │                        │ 2. Query pool              │                         │
│         │                        ├───────────────────────────►│                         │
│         │                        │                            │                         │
│         │                        │◄───────────────────────────┤                         │
│         │                        │    Available sandboxes     │                         │
│         │                        │                            │                         │
│         │                        │ 3. Assign or return        │                         │
│         │                        │    existing assignment     │                         │
│         │◄───────────────────────┤                            │                         │
│         │  { hostId: "hst_abc",  │                            │                         │
│         │    targetId: "tssh_x"} │                            │                         │
│         │                        │                            │                         │
│         │ 4. Connect with host-id│                            │                         │
│         ├────────────────────────┼───────────────────────────►│                         │
│         │                        │                            │                         │
│                                                                                          │
│  Assignment Service Responsibilities:                                                    │
│  - Maintain developer → sandbox mappings (database/ConfigMap)                           │
│  - Handle first-time assignment from available pool                                     │
│  - Scale pool based on demand                                                           │
│  - Reclaim inactive sandboxes                                                           │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Solution D: Ephemeral Sandboxes with Git State

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    SOLUTION D: STATELESS SANDBOXES (GIT = SOURCE OF TRUTH)              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Developer connects → Gets ANY available sandbox → Clones repo → Works → Pushes → Done  │
│                                                                                          │
│  ┌──────────┐                                                                           │
│  │  Alice   │───┐                   ┌─────────┐                                         │
│  └──────────┘   │                   │sandbox-1│◄── Alice today                          │
│                 │    Round-robin    └─────────┘                                         │
│  ┌──────────┐   ├──────────────────►┌─────────┐                                         │
│  │   Bob    │───┤    or random      │sandbox-2│◄── Bob today, Alice tomorrow           │
│  └──────────┘   │                   └─────────┘                                         │
│                 │                   ┌─────────┐                                         │
│  ┌──────────┐   │                   │sandbox-3│◄── Carol today                          │
│  │  Carol   │───┘                   └─────────┘                                         │
│  └──────────┘                                                                           │
│                                                                                          │
│  Sandbox Lifecycle:                                                                      │
│  1. On connect: Clone repos from git (SSH agent forwarding)                             │
│  2. On disconnect: Optional cleanup or retain for TTL                                   │
│  3. On next connect: May get different sandbox, state comes from git                    │
│                                                                                          │
│  Pros:                                         Cons:                                     │
│  ✓ True pool elasticity                        ✗ Slower startup (clone time)            │
│  ✓ No assignment complexity                    ✗ Local uncommitted work lost            │
│  ✓ Clean state guarantees                      ✗ IDE settings not preserved             │
│  ✓ Works with existing Boundary                ✗ Large repos = slow                     │
│                                                                                          │
│  Best for: CI/CD, untrusted workloads, contractors, short-term tasks                    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Sandbox Pool Management

### Allocation Strategies

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SANDBOX ALLOCATION STRATEGIES                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Strategy A: 1:1 DEDICATED (Recommended for Teams)                                      │
│  ─────────────────────────────────────────────────────────────────                      │
│                                                                                          │
│    Team Member        Sandbox Assignment         State                                   │
│    ────────────────────────────────────────────────────────                             │
│    alice@corp.com  →  sandbox-alice-001      →  Always Running                          │
│    bob@corp.com    →  sandbox-bob-002        →  Always Running                          │
│    carol@corp.com  →  sandbox-carol-003      →  Always Running                          │
│                                                                                          │
│    Boundary Target: One per developer (or use host-id selection)                        │
│    Pros: Persistent state, instant connect, predictable                                 │
│    Cons: Resources always allocated                                                      │
│                                                                                          │
│  ──────────────────────────────────────────────────────────────────────────────────     │
│                                                                                          │
│  Strategy B: WARM POOL (Recommended for Large Teams)                                    │
│  ─────────────────────────────────────────────────────────────────                      │
│                                                                                          │
│    Pool Status:                                                                          │
│    ┌──────────┬──────────┬──────────┬──────────┬──────────┐                            │
│    │ sandbox-1│ sandbox-2│ sandbox-3│ sandbox-4│ sandbox-5│   ← Warm Pool              │
│    │  (alice) │  (idle)  │  (bob)   │  (idle)  │  (idle)  │                            │
│    │ ASSIGNED │ AVAILABLE│ ASSIGNED │ AVAILABLE│ AVAILABLE│                            │
│    └──────────┴──────────┴──────────┴──────────┴──────────┘                            │
│                                                                                          │
│    Assignment Service: Maps developer → sandbox, persists across sessions               │
│    Scale: Pool grows/shrinks based on active developers                                 │
│    Pros: Efficient resource usage, handles team changes                                 │
│    Cons: Requires assignment service, cold start if pool exhausted                      │
│                                                                                          │
│  ──────────────────────────────────────────────────────────────────────────────────     │
│                                                                                          │
│  Strategy C: EPHEMERAL (For CI/CD or Untrusted Workloads)                              │
│  ─────────────────────────────────────────────────────────────────                      │
│                                                                                          │
│    Request → Spin Up → Work → Tear Down                                                 │
│              (~30-60s)        (~immediate)                                              │
│                                                                                          │
│    Pros: Maximum isolation, clean state                                                 │
│    Cons: Slow startup, state must be external (git)                                     │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Option: Generic Sandbox + Dynamic DevContainer

An alternative to the current envbuilder approach is a **generic sandbox with Docker** that launches devcontainers dynamically based on the repository's configuration.

### Concept

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│              GENERIC SANDBOX + DYNAMIC DEVCONTAINER (KUBERNETES)                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Current (envbuilder):              vs.    Proposed (Generic + Docker):                 │
│  ──────────────────────────────────────────────────────────────────────────────────     │
│  Sandbox = specific devcontainer           Sandbox = generic runtime + Docker           │
│  Built at pod startup                      DevContainer built on connect                │
│  One sandbox config per project            Any project's devcontainer.json              │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Kubernetes Pod: Generic Sandbox                                                 │   │
│  │  ┌───────────────────────────────────────────────────────────────────────────┐  │   │
│  │  │  Container: sandbox-runtime                                               │  │   │
│  │  │  Image: generic-sandbox:latest                                            │  │   │
│  │  │  ├── SSH Server (:22) ← Boundary connects here                            │  │   │
│  │  │  ├── Docker Engine (DinD/Sysbox/Kata)                                     │  │   │
│  │  │  ├── devcontainer CLI (@devcontainers/cli)                                │  │   │
│  │  │  └── Git, curl, jq (base tools only)                                      │  │   │
│  │  │                                                                           │  │   │
│  │  │       ┌───────────────────────────────────────────────────────────┐       │  │   │
│  │  │       │  Docker: DevContainer (launched on demand)                │       │  │   │
│  │  │       │  Built from: /workspace/myapp/.devcontainer/              │       │  │   │
│  │  │       │  ├── Project-specific tools (Node, Python, etc)           │       │  │   │
│  │  │       │  ├── VS Code Server                                       │       │  │   │
│  │  │       │  └── /workspace bind-mounted from outer                   │       │  │   │
│  │  │       └───────────────────────────────────────────────────────────┘       │  │   │
│  │  └───────────────────────────────────────────────────────────────────────────┘  │   │
│  │  Volumes:                                                                        │   │
│  │  ├── workspace-pvc:/workspace (25Gi) - Persists repos                           │   │
│  │  ├── docker-pvc:/var/lib/docker (50Gi) - Caches Docker layers                   │   │
│  │  └── vault-ssh-ca (secret) - SSH certificate authority                          │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Container Runtime Options for Nested Docker

| Runtime | Security | Setup Complexity | Notes |
|---------|----------|------------------|-------|
| **DinD (privileged)** | Low | Simple | Requires `privileged: true` |
| **Sysbox** | High | Medium | Rootless nested containers, requires Sysbox on nodes |
| **Kata Containers** | Very High | Medium | VM-level isolation, recommended for multi-tenant |
| **gVisor + Docker** | Medium | Medium | User-space kernel, some compatibility issues |

---

## Recommended: Kata Containers for Secure Multi-Tenant Sandboxes

Kata Containers provides **VM-level isolation** for each sandbox, eliminating the need for privileged mode while enabling full Docker-in-Docker functionality.

### Why Kata for This Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│            KATA CONTAINERS: VM-LEVEL ISOLATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Without Kata (privileged DinD):          With Kata:                        │
│  ───────────────────────────────          ──────────────────────            │
│  Pod needs privileged: true               Pod runs in micro-VM              │
│  Docker shares host kernel                Docker has isolated kernel        │
│  Security concern for multi-tenant        Safe for multi-tenant             │
│                                                                              │
│  Kubernetes Node                          Kubernetes Node                   │
│  ┌─────────────────────────┐              ┌─────────────────────────┐       │
│  │  Shared Kernel          │              │  Host Kernel            │       │
│  │  ┌───────────────────┐  │              │  ┌───────────────────┐  │       │
│  │  │ Pod (privileged)  │  │              │  │ Kata VM           │  │       │
│  │  │ ┌───────────────┐ │  │              │  │ ┌───────────────┐ │  │       │
│  │  │ │ Docker        │ │  │              │  │ │ Guest Kernel  │ │  │       │
│  │  │ │ ┌───────────┐ │ │  │              │  │ │ ┌───────────┐ │ │  │       │
│  │  │ │ │DevContainer│ │ │  │              │  │ │ │ Docker    │ │ │  │       │
│  │  │ │ └───────────┘ │ │  │              │  │ │ │ ┌───────┐ │ │ │  │       │
│  │  │ └───────────────┘ │  │              │  │ │ │ │DevCont│ │ │ │  │       │
│  │  └───────────────────┘  │              │  │ │ └─┴───────┴─┘ │ │  │       │
│  └─────────────────────────┘              │  │ └───────────────┘ │  │       │
│                                           │  └───────────────────┘  │       │
│  Risk: Container escape → host            └─────────────────────────┘       │
│                                           Safe: Escape only reaches VM      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Kata Benefits

| Benefit | Description |
|---------|-------------|
| **No privileged mode** | Docker runs normally inside VM, no security compromise |
| **Kernel isolation** | Each sandbox has its own kernel, kernel exploits contained |
| **Resource isolation** | Memory/CPU limits enforced by hypervisor, not just cgroups |
| **Multi-tenant safe** | Alice's sandbox cannot affect Bob's sandbox |
| **Nested containers work** | Docker-in-Docker just works with full kernel support |

### Trade-offs

| Aspect | Impact |
|--------|--------|
| VM boot overhead | ~1-2 seconds (acceptable for persistent sandboxes) |
| Memory overhead | ~50-100MB per VM |
| Node requirement | Kata runtime must be installed on K8s nodes |

---

## Hybrid Architecture: envbuilder + Kata + DevContainers

Combine **envbuilder** (for cached sandbox builds) with **Kata** (for security) and **dynamic devcontainers** (for flexibility).

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HYBRID: ENVBUILDER + KATA + DYNAMIC DEVCONTAINERS                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Pod Startup (envbuilder + Kata)            On Connect (developer)          │
│  ───────────────────────────────            ──────────────────────          │
│                                                                              │
│  ┌─────────────────────────────┐           ┌─────────────────────────────┐  │
│  │ Kata VM boots (~1-2 sec)    │           │ Developer connects:         │  │
│  │ envbuilder builds:          │           │                             │  │
│  │ generic-sandbox             │           │ 1. SSH into sandbox (Kata)  │  │
│  │ devcontainer.json           │  ───────► │ 2. Clone project repo       │  │
│  │ ├── SSH Server              │           │ 3. devcontainer up          │  │
│  │ ├── Docker Engine           │           │ 4. Work in nested           │  │
│  │ ├── devcontainer CLI        │           │    devcontainer             │  │
│  │ └── Base tools              │           │                             │  │
│  └─────────────────────────────┘           └─────────────────────────────┘  │
│                                                                              │
│  Benefits:                                                                   │
│  ✓ envbuilder's layer caching for generic sandbox                           │
│  ✓ Kata VM isolation (no privileged mode)                                   │
│  ✓ Kubernetes-native (Sandbox CRD unchanged)                                │
│  ✓ Dynamic project devcontainers on demand                                  │
│  ✓ One sandbox → many projects                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Complete Architecture with Kata

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPLETE: ENVBUILDER + KATA + DEVCONTAINERS + EMBEDDED URI                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Developer                  Boundary              Kubernetes (Kata)         │
│                                                                              │
│  ┌─────────────┐           ┌─────────┐           ┌─────────────────────┐   │
│  │ VS Code     │           │Controller│           │ Kata VM             │   │
│  │ + Extension │           │+ Workers│           │ (sandbox-alice)     │   │
│  └──────┬──────┘           └────┬────┘           │ ┌─────────────────┐ │   │
│         │                       │                 │ │ envbuilder      │ │   │
│         │ 1. Connect            │                 │ │ generic sandbox │ │   │
│         ├──────────────────────►│                 │ │ ├── SSH         │ │   │
│         │                       │                 │ │ ├── Docker      │ │   │
│         │ 2. SSH cert           │                 │ │ └── devcontainer│ │   │
│         │◄──────────────────────┤                 │ │      CLI        │ │   │
│         │                       │                 │ │                 │ │   │
│         │ 3. SSH tunnel ────────┼────────────────►│ │  ┌───────────┐  │ │   │
│         │                       │                 │ │  │DevContainer│  │ │   │
│         │ 4. git clone +        │                 │ │  │(project)  │  │ │   │
│         │    devcontainer up    │                 │ │  └───────────┘  │ │   │
│         │    (via SSH)          │                 │ └─────────────────┘ │   │
│         │                       │                 └─────────────────────┘   │
│         │ 5. Open URI directly  │                                           │
│         │    into devcontainer  │                  Isolated by VM kernel    │
│         │                       │                  No privileged needed     │
│         ▼                       │                                           │
│  ┌─────────────┐                │                                           │
│  │ Working in  │                │                                           │
│  │ devcontainer│                │                                           │
│  │ (one click) │                │                                           │
│  └─────────────┘                │                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Generic Sandbox devcontainer.json (for envbuilder with Kata)

```json
{
  "name": "Generic Development Sandbox (Kata)",
  "image": "ubuntu:22.04",
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {
      "dockerDashComposeVersion": "v2"
    },
    "ghcr.io/devcontainers/features/sshd:1": {
      "version": "latest"
    },
    "ghcr.io/devcontainers/features/node:1": {
      "version": "20"
    },
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "postCreateCommand": "npm install -g @devcontainers/cli && bash /workspaces/.devcontainer/scripts/setup-ssh-ca.sh",
  "remoteUser": "vscode",
  "workspaceFolder": "/workspaces",
  "containerEnv": {
    "DOCKER_HOST": "unix:///var/run/docker.sock"
  },
  "mounts": [
    "source=sandbox-docker-cache,target=/var/lib/docker,type=volume"
  ],
  "portsAttributes": {
    "22": { "label": "SSH" },
    "13337": { "label": "code-server" }
  }
}
```

### Kubernetes Manifest with Kata Runtime

```yaml
# k8s/generic-sandbox/sandbox-kata.yaml
apiVersion: agentsandbox.io/v1alpha1
kind: Sandbox
metadata:
  name: sandbox-${DEVELOPER}
  namespace: dev-sandboxes
  labels:
    app: generic-sandbox
    developer: ${DEVELOPER}
spec:
  # Use Kata runtime for VM-level isolation
  runtimeClassName: kata-qemu  # or kata-clh (Cloud Hypervisor)

  image: ghcr.io/myorg/generic-sandbox:latest

  # NO privileged needed with Kata!
  # Docker-in-Docker works because Kata provides a real kernel
  # securityContext:
  #   privileged: true  # ← NOT REQUIRED

  env:
    - name: GIT_REPO_URL
      value: ""
    - name: GIT_BRANCH
      value: "main"
    - name: AUTO_DEVCONTAINER
      value: "false"

  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
    limits:
      cpu: "8"
      memory: "16Gi"
      # Note: memory includes both guest OS and containers

  volumes:
    # Workspace persists repos and working files
    - name: workspace
      mountPath: /workspace
      persistentVolumeClaim:
        claimName: sandbox-${DEVELOPER}-workspace

    # Docker layer cache (critical for fast devcontainer rebuilds)
    - name: docker-cache
      mountPath: /var/lib/docker
      persistentVolumeClaim:
        claimName: sandbox-${DEVELOPER}-docker

    # Vault SSH CA
    - name: vault-ssh-ca
      mountPath: /vault-ssh-ca
      secret:
        secretName: vault-ssh-ca

---
# PVC for Docker layer cache (enables fast devcontainer rebuilds)
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sandbox-${DEVELOPER}-docker
  namespace: dev-sandboxes
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 50Gi
  storageClassName: fast-ssd  # SSD recommended for Docker operations

---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-${DEVELOPER}
  namespace: dev-sandboxes
spec:
  type: ClusterIP
  selector:
    app: generic-sandbox
    developer: ${DEVELOPER}
  ports:
    - name: ssh
      port: 22
      targetPort: 22
```

---

## DevContainer Image Caching Strategies

Fast devcontainer builds are critical for good UX. Multiple caching layers ensure minimal wait times.

### Caching Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DEVCONTAINER CACHING LAYERS                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  First `devcontainer up`:                 Subsequent `devcontainer up`:     │
│  ─────────────────────────                ──────────────────────────────    │
│                                                                              │
│  Pull base image ─────────► 2-5 min       Using cached image ──► <1 sec    │
│  Install features ────────► 1-3 min       Using cached layers ──► <1 sec   │
│  Run postCreateCommand ───► 1-2 min       Skip (already done) ──► 0 sec    │
│  ─────────────────────────────────        ─────────────────────────────     │
│  Total: 4-10 min                          Total: <5 seconds                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Cache Locations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CACHE LOCATIONS IN SANDBOX                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Sandbox Pod (Kata VM)                                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │   /var/lib/docker (PVC: 50Gi)  ← DOCKER LAYER CACHE                   │  │
│  │   ├── overlay2/                 ← Image layers                        │  │
│  │   │   ├── abc123.../            ← ubuntu:22.04 base                   │  │
│  │   │   ├── def456.../            ← node:20 layer                       │  │
│  │   │   └── ghi789.../            ← devcontainer features               │  │
│  │   ├── image/                    ← Image metadata                      │  │
│  │   └── containers/               ← Running container data              │  │
│  │                                                                        │  │
│  │   /workspace (PVC: 25Gi)        ← PROJECT FILES                       │  │
│  │   ├── project-a/                                                      │  │
│  │   │   ├── .devcontainer/                                              │  │
│  │   │   └── src/                                                        │  │
│  │   └── project-b/                                                      │  │
│  │       ├── .devcontainer/                                              │  │
│  │       └── src/                                                        │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Cache persists across:                                                      │
│  ✓ Pod restarts                                                             │
│  ✓ devcontainer rebuilds                                                    │
│  ✓ Different projects (shared base images)                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Caching Strategy Options

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CACHING OPTIONS (Combine for Best Results)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Layer 1: LOCAL PVC (Default)                                               │
│  ─────────────────────────────────────                                      │
│  • Docker layers stored in /var/lib/docker PVC                              │
│  • Per-developer cache (not shared across developers)                       │
│  • Fast rebuilds after first build                                          │
│                                                                              │
│  Layer 2: PRE-PULLED BASE IMAGES (DaemonSet)                                │
│  ─────────────────────────────────────                                      │
│  • DaemonSet pre-pulls popular base images to nodes                         │
│  • Images: node:20, python:3.11, mcr.microsoft.com/devcontainers/*         │
│  • Reduces first devcontainer build time                                    │
│                                                                              │
│  Layer 3: PRE-BUILT DEVCONTAINER IMAGES (CI/CD) - Recommended               │
│  ─────────────────────────────────────                                      │
│  • CI builds and pushes devcontainer images nightly                         │
│  • Projects reference pre-built image in devcontainer.json                  │
│  • First connect: pull only (~30 sec instead of 5-10 min)                   │
│                                                                              │
│  Layer 4: REGISTRY CACHE (BuildKit)                                         │
│  ─────────────────────────────────────                                      │
│  • Push built layers to registry cache                                      │
│  • Shared across all developers                                             │
│  • Useful for large teams                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Pre-Built DevContainer Images (Fastest UX)

```json
// .devcontainer/devcontainer.json (in project repo)
{
  // Use pre-built image instead of building from features:
  "image": "ghcr.io/myorg/devcontainer-myproject:latest",

  "workspaceFolder": "/workspaces/myproject",
  "remoteUser": "vscode"

  // postCreateCommand still runs (but fast since deps installed in image)
}
```

```yaml
# .github/workflows/devcontainer-build.yml
name: Build DevContainer Image
on:
  push:
    paths: ['.devcontainer/**']
  schedule:
    - cron: '0 0 * * *'  # Nightly rebuild

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build devcontainer image
        uses: devcontainers/ci@v0.3
        with:
          imageName: ghcr.io/${{ github.repository }}/devcontainer
          cacheFrom: ghcr.io/${{ github.repository }}/devcontainer
          push: always
```

### Time Comparison

| Scenario | First Build | Subsequent |
|----------|-------------|------------|
| **No caching** | 5-10 min | 5-10 min |
| **Local PVC cache only** | 5-10 min | <10 sec |
| **Pre-pulled base images** | 2-5 min | <10 sec |
| **Pre-built devcontainer image** | <30 sec (pull) | <10 sec |
| **Pre-built + local cache** | <30 sec | <5 sec |

---

## Seamless UX: Embedded DevContainer URI

Skip the "Reopen in Container" prompt by having the extension orchestrate devcontainer launch and open VS Code directly into the container.

### URI-Based Connection Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│            SEAMLESS FLOW: EMBEDDED DEVCONTAINER URI                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Standard flow (2 steps):                 With URI (1 step):                │
│  ─────────────────────────                ─────────────────────             │
│                                                                              │
│  1. Connect to sandbox SSH                1. Connect directly to devcontainer│
│  2. "Reopen in Container" prompt             inside sandbox                  │
│                                                                              │
│  Click ──► SSH ──► Prompt ──► DC          Click ──► DC (via SSH tunnel)    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Extension-Orchestrated Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EXTENSION ORCHESTRATES DEVCONTAINER LAUNCH                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Target Config (VS Code settings or Boundary metadata):                      │
│  {                                                                           │
│    "targetId": "tssh_xxx",                                                  │
│    "devcontainer": {                                                        │
│      "repo": "https://github.com/org/my-project",                          │
│      "workspaceFolder": "/workspaces/my-project",                          │
│      "autoLaunch": true                                                     │
│    }                                                                        │
│  }                                                                          │
│                                                                              │
│  ┌─────────────┐                                                            │
│  │   VS Code   │                                                            │
│  │  Extension  │                                                            │
│  └──────┬──────┘                                                            │
│         │                                                                    │
│         │ 1. boundary connect (SSH tunnel to sandbox)                       │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────┐                │
│  │  Sandbox Pod (Kata VM, via SSH)                         │                │
│  │                                                         │                │
│  │  2. Extension runs via SSH:                             │                │
│  │     git clone <repo> /workspaces/<project>              │                │
│  │     devcontainer up --workspace-folder /workspaces/...  │                │
│  │                                                         │                │
│  │  3. Returns container ID                                │                │
│  │     └─► container_abc123                                │                │
│  └─────────────────────────────────────────────────────────┘                │
│         │                                                                    │
│         │ 4. Extension configures SSH with RemoteCommand:                   │
│         │    docker exec -it <container_id> /bin/bash                       │
│         │                                                                    │
│         │ 5. Extension opens URI:                                           │
│         │    vscode://vscode-remote/ssh-remote+boundary-dc/workspaces/...   │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────┐                │
│  │  VS Code opens directly in devcontainer                 │                │
│  │  No prompts - seamless one-click experience             │                │
│  └─────────────────────────────────────────────────────────┘                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Extension Implementation

```typescript
// src/connection/devcontainerLauncher.ts

interface DevContainerConfig {
  repo?: string;           // Git repo to clone
  branch?: string;         // Branch to checkout
  workspaceFolder: string; // Path inside sandbox
  autoLaunch: boolean;     // Launch devcontainer automatically
}

export class DevContainerLauncher {

  async launchAndConnect(
    session: BoundarySession,
    config: DevContainerConfig
  ): Promise<void> {

    // 1. Clone repo if needed (via SSH to sandbox)
    if (config.repo) {
      await this.sshExec(session, `
        if [ ! -d "${config.workspaceFolder}/.git" ]; then
          git clone ${config.branch ? `-b ${config.branch}` : ''} \
            "${config.repo}" "${config.workspaceFolder}"
        fi
      `);
    }

    // 2. Launch devcontainer (via SSH to sandbox)
    await this.sshExec(session, `
      cd "${config.workspaceFolder}" && \
      devcontainer up --workspace-folder . 2>&1
    `);

    // 3. Get container ID
    const containerId = await this.sshExec(session, `
      docker ps -q --filter "label=devcontainer.local_folder=${config.workspaceFolder}"
    `);

    // 4. Configure SSH to exec into devcontainer
    await this.configureShellRedirect(session, containerId.trim(), config.workspaceFolder);
  }

  private async configureShellRedirect(
    session: BoundarySession,
    containerId: string,
    workspaceFolder: string
  ): Promise<void> {
    // SSH config that execs into the devcontainer
    const hostAlias = `boundary-${session.targetName}-dc`;
    const sshConfig = `
Host ${hostAlias}
    HostName ${session.localHost}
    Port ${session.localPort}
    User developer
    IdentityFile ${session.identityFile}
    RequestTTY yes
    RemoteCommand docker exec -it ${containerId} /bin/bash -l
`;

    await this.appendToSSHConfig(sshConfig);

    // Open VS Code directly to devcontainer
    const uri = vscode.Uri.parse(
      `vscode://vscode-remote/ssh-remote+${hostAlias}${workspaceFolder}`
    );
    await vscode.env.openExternal(uri);
  }
}
```

### Target Configuration Options

```json
// VS Code settings.json
{
  "boundary.targets": {
    "tssh_sandbox_pool": {
      "type": "devcontainer-sandbox",
      "devcontainer": {
        "repo": "https://github.com/myorg/myapp",
        "workspaceFolder": "/workspaces/myapp",
        "autoLaunch": true
      }
    }
  }
}
```

### Final UX Flow

```
Developer clicks "Connect to sandbox" (with devcontainer config)
    │
    ▼
Extension: boundary connect → SSH tunnel established
    │
    ▼
Extension (via SSH): git clone + devcontainer up (cached = fast)
    │
    ▼
Extension: Configure SSH with RemoteCommand → docker exec
    │
    ▼
Extension: Open vscode://vscode-remote/ssh-remote+boundary-dc/workspace
    │
    ▼
VS Code opens directly inside devcontainer

Total: ONE CLICK → Working in project devcontainer
```

---

## Summary: Recommended Architecture

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Pod Runtime** | Kata Containers | VM isolation, no privileged mode needed |
| **Sandbox Build** | envbuilder | Layer caching, Sandbox CRD native |
| **Inner Containers** | Docker-in-Docker | Standard devcontainer workflow |
| **Connection** | Boundary SSH | Zero-trust access with Vault SSH CA |
| **Caching** | PVC + Pre-built images | Sub-30-second first connect |
| **UX** | Embedded URI | One-click to devcontainer |

This architecture provides:
- ✅ **Maximum security** (Kata VM isolation)
- ✅ **Fast startup** (envbuilder + image caching)
- ✅ **Flexibility** (any project devcontainer)
- ✅ **Seamless UX** (one-click connection)
- ✅ **Multi-tenant safe** (complete isolation between developers)

---

### Generic Sandbox Dockerfile

```dockerfile
# generic-sandbox/Dockerfile
FROM ubuntu:22.04

ARG USERNAME=developer
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# ============================================
# SSH Server (Boundary access point)
# ============================================
RUN apt-get update && apt-get install -y \
    openssh-server \
    && mkdir /var/run/sshd

# SSH config for Vault CA
RUN echo 'PermitRootLogin no' >> /etc/ssh/sshd_config && \
    echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config && \
    echo 'PubkeyAuthentication yes' >> /etc/ssh/sshd_config && \
    echo 'TrustedUserCAKeys /vault-ssh-ca/vault-ssh-ca.pub' >> /etc/ssh/sshd_config && \
    echo 'AllowAgentForwarding yes' >> /etc/ssh/sshd_config && \
    echo 'AllowTcpForwarding yes' >> /etc/ssh/sshd_config

# ============================================
# Docker Engine
# ============================================
RUN curl -fsSL https://get.docker.com | sh

# ============================================
# devcontainer CLI
# ============================================
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @devcontainers/cli

# ============================================
# Base Tools (minimal - devcontainer has the rest)
# ============================================
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    jq \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# Developer User
# ============================================
RUN groupadd --gid $USER_GID $USERNAME && \
    useradd --uid $USER_UID --gid $USER_GID -m -s /bin/bash $USERNAME && \
    echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME && \
    usermod -aG docker $USERNAME

# ============================================
# Workspace
# ============================================
RUN mkdir -p /workspace && chown $USERNAME:$USERNAME /workspace
WORKDIR /workspace

# ============================================
# Entrypoint
# ============================================
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
```

### Generic Sandbox Entrypoint

```bash
#!/bin/bash
# generic-sandbox/entrypoint.sh

set -e

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ============================================
# Start Docker daemon
# ============================================
log "Starting Docker daemon..."
dockerd &
sleep 3  # Wait for Docker to be ready

# ============================================
# Clone repository (if configured)
# ============================================
if [ -n "$GIT_REPO_URL" ] && [ ! -d "/workspace/.git" ]; then
    log "Cloning repository: $GIT_REPO_URL"
    git clone ${GIT_BRANCH:+--branch $GIT_BRANCH} "$GIT_REPO_URL" /workspace
    chown -R developer:developer /workspace
fi

# ============================================
# Auto-launch devcontainer (if configured)
# ============================================
if [ "$AUTO_DEVCONTAINER" = "true" ] && [ -f "/workspace/.devcontainer/devcontainer.json" ]; then
    log "Auto-launching devcontainer..."

    # Build and start devcontainer
    su - developer -c "cd /workspace && devcontainer up --workspace-folder ."

    # Get container ID
    CONTAINER_ID=$(docker ps -q --filter "label=devcontainer.local_folder=/workspace")

    if [ -n "$CONTAINER_ID" ]; then
        log "DevContainer running: $CONTAINER_ID"

        # Option 1: Forward SSH into devcontainer
        # socat TCP-LISTEN:2222,fork,reuseaddr EXEC:"docker exec -i $CONTAINER_ID /usr/sbin/sshd -D"

        # Option 2: Set up docker exec as shell
        echo "export DEVCONTAINER_ID=$CONTAINER_ID" >> /home/developer/.bashrc
        echo 'alias dc="docker exec -it $DEVCONTAINER_ID"' >> /home/developer/.bashrc
    fi
fi

# ============================================
# Start SSH server
# ============================================
log "Starting SSH server..."
mkdir -p /run/sshd
ssh-keygen -A 2>/dev/null || true

log "========================================"
log "Generic Sandbox Ready"
log "Docker: $(docker --version)"
log "devcontainer CLI: $(devcontainer --version)"
[ -n "$GIT_REPO_URL" ] && log "Repository: $GIT_REPO_URL"
log "========================================"

exec /usr/sbin/sshd -D -e
```

### Kubernetes Manifest

```yaml
# k8s/generic-sandbox/sandbox.yaml
apiVersion: agentsandbox.io/v1alpha1
kind: Sandbox
metadata:
  name: sandbox-${DEVELOPER}
  namespace: dev-sandboxes
  labels:
    app: generic-sandbox
    developer: ${DEVELOPER}
spec:
  image: ghcr.io/myorg/generic-sandbox:latest

  # Required for Docker-in-Docker
  # For Sysbox: use runtimeClassName instead
  securityContext:
    privileged: true

  # Or with Sysbox (more secure):
  # runtimeClassName: sysbox-runc

  env:
    # Optional: pre-clone a repo
    - name: GIT_REPO_URL
      value: ""
    - name: GIT_BRANCH
      value: "main"
    # Set to "true" to auto-launch devcontainer on pod start
    - name: AUTO_DEVCONTAINER
      value: "false"

  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
    limits:
      cpu: "8"
      memory: "16Gi"

  volumes:
    # Workspace persists repos and working files
    - name: workspace
      mountPath: /workspace
      persistentVolumeClaim:
        claimName: sandbox-${DEVELOPER}-workspace

    # Docker layer cache (important for fast rebuilds)
    - name: docker
      mountPath: /var/lib/docker
      persistentVolumeClaim:
        claimName: sandbox-${DEVELOPER}-docker

    # Vault SSH CA
    - name: vault-ssh-ca
      mountPath: /vault-ssh-ca
      secret:
        secretName: vault-ssh-ca

---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-${DEVELOPER}
  namespace: dev-sandboxes
spec:
  type: ClusterIP
  selector:
    app: generic-sandbox
    developer: ${DEVELOPER}
  ports:
    - name: ssh
      port: 22
      targetPort: 22
```

### DevContainer Launch Options

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         DEVCONTAINER LAUNCH OPTIONS                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  Option A: Manual (Standard VS Code Flow)                                               │
│  ─────────────────────────────────────────                                              │
│  1. Developer connects to generic sandbox via Boundary                                  │
│  2. VS Code Remote SSH opens /workspace                                                 │
│  3. Developer clones repo: git clone <url>                                              │
│  4. VS Code detects .devcontainer/devcontainer.json                                     │
│  5. Shows "Reopen in Container" prompt                                                  │
│  6. User clicks → devcontainer builds and starts                                        │
│                                                                                          │
│  Pros: Standard flow, no extension changes                                              │
│  Cons: Extra click, user must clone repo manually                                       │
│                                                                                          │
│  ──────────────────────────────────────────────────────────────────────────────────     │
│                                                                                          │
│  Option B: Auto via Sandbox Config (env vars)                                           │
│  ─────────────────────────────────────────                                              │
│  1. Sandbox configured with GIT_REPO_URL + AUTO_DEVCONTAINER=true                       │
│  2. On pod start: entrypoint clones repo + runs devcontainer up                         │
│  3. Developer connects → lands directly in devcontainer context                         │
│                                                                                          │
│  Pros: Seamless, no prompts                                                             │
│  Cons: Repo baked into sandbox config, slower pod startup                               │
│                                                                                          │
│  ──────────────────────────────────────────────────────────────────────────────────     │
│                                                                                          │
│  Option C: Extension-Triggered (Recommended for flexibility)                            │
│  ─────────────────────────────────────────                                              │
│  1. Developer connects to generic sandbox                                               │
│  2. Extension detects current local workspace has .devcontainer/                        │
│  3. Extension prompts: "Launch devcontainer on remote?"                                 │
│  4. If yes: Extension runs via SSH:                                                     │
│     - git clone <repo> /workspace/<project>                                             │
│     - devcontainer up --workspace-folder /workspace/<project>                           │
│  5. Extension reconnects VS Code to devcontainer                                        │
│                                                                                          │
│  Pros: Dynamic, any repo, good UX                                                       │
│  Cons: Requires extension changes                                                       │
│                                                                                          │
│  ──────────────────────────────────────────────────────────────────────────────────     │
│                                                                                          │
│  Option D: VS Code Tunnel from DevContainer                                             │
│  ─────────────────────────────────────────                                              │
│  1. Developer connects to generic sandbox                                               │
│  2. Runs: devcontainer up && devcontainer exec code tunnel                              │
│  3. Gets vscode.dev URL pointing to devcontainer                                        │
│  4. Opens in browser or connects VS Code desktop via tunnel                             │
│                                                                                          │
│  Pros: Works without Boundary after initial setup                                       │
│  Cons: Browser-based or requires tunnel auth                                            │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Comparison: envbuilder vs Generic+Docker

| Aspect | envbuilder (current) | Generic + Docker |
|--------|---------------------|------------------|
| **Pod image** | envbuilder + devcontainer.json | Generic sandbox + Docker daemon |
| **DevContainer built** | At pod startup (5-10 min) | On-demand (when needed) |
| **Pod startup time** | Slow (builds devcontainer) | Fast (just starts Docker) |
| **DevContainer build time** | Same | Same (but deferred) |
| **Repo coupling** | Baked into pod config | Dynamic - any repo |
| **Multi-project** | One pod = one project | One pod = many projects |
| **Layer caching** | envbuilder cache | Docker layer cache PVC |
| **Security** | Standard container | Privileged or Sysbox required |
| **Switching projects** | Deploy new sandbox | Clone new repo, devcontainer up |
| **Resource efficiency** | One container | Nested containers (more overhead) |

### When to Use Which

| Scenario | Recommended Approach |
|----------|---------------------|
| **Single project team** | envbuilder (current) |
| **Multi-project developer** | Generic + Docker |
| **Rapid project switching** | Generic + Docker |
| **Maximum security** | envbuilder (no privileged) |
| **Standard devcontainer workflow** | Generic + Docker |
| **CI/CD runners** | Generic + Docker (ephemeral) |

---

## Existing Architecture Reference

The existing [k8s-agent-sandbox](https://github.com/CloudbrokerAz/k8s-agent-sandbox) provides the foundation:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     EXISTING K8S-AGENT-SANDBOX ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  k8s/agent-sandbox/                                                                      │
│  ├── vscode-claude/                    ← Claude Code sandbox                            │
│  │   ├── base/                                                                          │
│  │   │   ├── claude-code-sandbox.yaml  ← Sandbox CRD (envbuilder + devcontainer)       │
│  │   │   ├── service.yaml              ← ClusterIP: SSH:22, code-server:13337          │
│  │   │   └── kustomization.yaml                                                         │
│  │   ├── devcontainer.json             ← Built at runtime by envbuilder                │
│  │   ├── entrypoint.sh                 ← code-server startup                           │
│  │   └── scripts/                                                                       │
│  │       └── setup-ssh-ca.sh           ← Vault SSH CA configuration                    │
│  │                                                                                       │
│  ├── vscode-gemini/                    ← Gemini sandbox (same structure)               │
│  │                                                                                       │
│  └── overlays/                                                                          │
│      ├── gvisor/                       ← Enhanced isolation (optional)                  │
│      └── kata/                         ← VM-level isolation (optional)                  │
│                                                                                          │
│  Key Components:                                                                         │
│  ─────────────────────────────────────────────────────────────────────────────────────  │
│  • Sandbox CRD: kubernetes-sigs/agent-sandbox manages pod lifecycle                     │
│  • envbuilder: ghcr.io/coder/envbuilder builds devcontainer.json at runtime            │
│  • Base Image: srlynch1/terraform-ai-tools (Node, Terraform, AWS CLI, etc.)            │
│  • SSH: Vault CA certificates via TrustedUserCAKeys (24hr TTL)                          │
│  • code-server: Browser IDE fallback on port 13337                                      │
│  • Storage: 25Gi PVC at /workspaces                                                     │
│                                                                                          │
│  Access Methods:                                                                         │
│  ─────────────────────────────────────────────────────────────────────────────────────  │
│  1. kubectl exec (direct shell)                                                         │
│  2. kubectl port-forward (code-server in browser)                                       │
│  3. Boundary SSH target (VS Code Remote SSH) ← Extension handles this                  │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### devcontainer.json (from existing repo)

```json
{
  "image": "srlynch1/terraform-ai-tools:latest",
  "workspaceFolder": "/workspaces/repos",
  "remoteUser": "node",
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": { "version": "latest" }
  },
  "postCreateCommand": "npm install -g @anthropic-ai/claude-code && bash /workspaces/.devcontainer/scripts/setup-ssh-ca.sh",
  "portsAttributes": {
    "13337": { "label": "code-server" },
    "22": { "label": "SSH" }
  },
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/workspaces/.claude-config",
    "HISTFILE": "/workspaces/.bash_history/.bash_history"
  }
}
```

### Vault SSH CA Setup (from existing repo)

```bash
#!/bin/bash
# scripts/setup-ssh-ca.sh - Configures SSH to trust Vault-signed certificates

VAULT_CA_MOUNT="/vault-ssh-ca/vault-ssh-ca.pub"

# Configure sshd for Vault CA
sed -i 's/^#*Port.*/Port 22/' /etc/ssh/sshd_config
echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config
echo "TrustedUserCAKeys $VAULT_CA_MOUNT" >> /etc/ssh/sshd_config
echo "AuthorizedPrincipalsFile none" >> /etc/ssh/sshd_config
echo "AllowTcpForwarding yes" >> /etc/ssh/sshd_config

# Start SSH server
mkdir -p /run/sshd
ssh-keygen -A
/usr/sbin/sshd -D &
```

---

## Boundary Configuration

### Terraform Configuration

```hcl
# File: terraform/boundary-sandboxes.tf

# ============================================
# Scope Structure
# ============================================
resource "boundary_scope" "org" {
  scope_id    = "global"
  name        = "engineering"
  description = "Engineering organization"
}

resource "boundary_scope" "project" {
  scope_id    = boundary_scope.org.id
  name        = "dev-sandboxes"
  description = "Development sandbox environments"
}

# ============================================
# Host Catalog (Dynamic from Kubernetes)
# ============================================
resource "boundary_host_catalog_plugin" "k8s_sandboxes" {
  scope_id    = boundary_scope.project.id
  name        = "kubernetes-sandboxes"
  plugin_name = "kubernetes"

  attributes_json = jsonencode({
    disable_credential_rotation = true
    namespace                   = "dev-sandboxes"
    label_selector             = "app=dev-sandbox"
  })

  secrets_json = jsonencode({
    kubeconfig = file("~/.kube/config")
  })
}

# ============================================
# Credential Store (Vault Integration)
# ============================================
resource "boundary_credential_store_vault" "sandbox_creds" {
  scope_id    = boundary_scope.project.id
  name        = "vault-ssh-creds"
  address     = var.vault_addr
  token       = var.vault_token
  namespace   = "admin"
}

resource "boundary_credential_library_vault_ssh_certificate" "sandbox_ssh" {
  credential_store_id = boundary_credential_store_vault.sandbox_creds.id
  name                = "sandbox-ssh-certs"
  path                = "ssh-client-signer/sign/sandbox-role"
  username            = "developer"
  key_type            = "ed25519"
  extensions = {
    permit-pty = ""
    permit-agent-forwarding = ""
  }
}

# ============================================
# Target (Per Developer or Pool)
# ============================================

# Option A: Dedicated targets per developer
resource "boundary_target" "sandbox" {
  for_each = toset(var.developers)

  scope_id     = boundary_scope.project.id
  name         = "sandbox-${each.key}"
  description  = "Development sandbox for ${each.key}"
  type         = "ssh"
  default_port = 22

  host_source_ids = [
    boundary_host_set_plugin.sandbox[each.key].id
  ]

  injected_application_credential_source_ids = [
    boundary_credential_library_vault_ssh_certificate.sandbox_ssh.id
  ]

  session_max_seconds = 28800  # 8 hours
}

# Option B: Shared pool with host-id selection
resource "boundary_target" "sandbox_pool" {
  scope_id     = boundary_scope.project.id
  name         = "team-sandbox-pool"
  description  = "Shared sandbox pool - select specific sandbox with -host-id"
  type         = "ssh"
  default_port = 22

  host_source_ids = [
    boundary_host_set_plugin.all_sandboxes.id
  ]

  injected_application_credential_source_ids = [
    boundary_credential_library_vault_ssh_certificate.sandbox_ssh.id
  ]
}
```

---

## VS Code Extension Integration

### Connection Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTENSION CONNECTION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  User Action                 Extension                          Infrastructure           │
│  ────────────────────────────────────────────────────────────────────────────────────   │
│                                                                                          │
│  1. Click "Connect"          │                                       │                  │
│     on target               ─┼──────────────────────────────────────►│                  │
│                              │  boundary targets authorize-session   │                  │
│                              │  -id=tssh_xxx                         │                  │
│                              │                                       │                  │
│                              │◄──────────────────────────────────────┤                  │
│                              │  { authz_token, credentials: {        │                  │
│                              │      ssh_certificate, username }}     │                  │
│                              │                                       │                  │
│  2. (Automatic)              │                                       │                  │
│     Save SSH cert           ─┼─► ~/.ssh/.boundary-keys/xxx.pem      │                  │
│     Create SSH config       ─┼─► ~/.ssh/config (Host boundary-xxx)  │                  │
│                              │                                       │                  │
│  3. (Automatic)              │  boundary connect                     │                  │
│     Establish tunnel        ─┼─► -authz-token=xxx                   ─┼─────────────────►│
│                              │  localhost:2250 ◄──────── TCP ────────┼─► container:22  │
│                              │                                       │                  │
│  4. (Automatic)              │                                       │                  │
│     Open VS Code            ─┼─► vscode.openFolder(                 │                  │
│                              │     "vscode-remote://ssh-remote+      │                  │
│                              │      boundary-xxx/workspace")         │                  │
│                              │                                       │                  │
│  5. User Working             │                                       │                  │
│     (< 10 seconds)           │  VS Code ◄──── SSH ───────────────────┼─► DevContainer  │
│                              │                                       │                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Code Changes Required

```typescript
// File: src/connection/connectionManager.ts
// Minimal changes - existing flow works for direct container SSH

export class ConnectionManager implements IConnectionManager {
  async connect(target: BoundaryTarget): Promise<Session> {
    // Existing implementation works as-is
    // The target now points to container SSH instead of host SSH

    const session = await this.cli.connect(target.id, options);

    // Trigger Remote SSH to /workspace (container's workspace)
    await triggerRemoteSSH({
      host: session.localHost,
      port: session.localPort,
      targetName: target.name,
      userName: credentials?.username || await this.promptForUsername(target),
      privateKey: credentials?.privateKey,
      certificate: credentials?.certificate,
    });

    return session;
  }
}
```

### Configuration Options

```json
// VS Code settings.json additions
{
  // Default remote path (container workspace)
  "boundary.defaultRemotePath": "/workspace",

  // Target-specific overrides
  "boundary.targets": {
    "tssh_abc123": {
      "remotePath": "/workspace/myapp",
      "type": "devcontainer"  // Hint that this is a container
    }
  }
}
```

---

## Security Considerations

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SECURITY MODEL                                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │  AUTHENTICATION CHAIN                                                            │    │
│  │                                                                                  │    │
│  │  Developer Identity ──► Boundary (OIDC/SSO) ──► Session Token                   │    │
│  │                                    │                                             │    │
│  │                                    ▼                                             │    │
│  │                              Vault SSH CA                                        │    │
│  │                                    │                                             │    │
│  │                                    ▼                                             │    │
│  │                         Short-lived SSH Certificate                              │    │
│  │                         (scoped to specific sandbox)                             │    │
│  │                                    │                                             │    │
│  │                                    ▼                                             │    │
│  │                            Container SSH Server                                  │    │
│  │                                                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │  ISOLATION BOUNDARIES                                                            │    │
│  │                                                                                  │    │
│  │  • Each developer gets isolated container (no shared filesystem)                │    │
│  │  • Network policies restrict inter-sandbox communication                        │    │
│  │  • SSH certificates scoped to specific sandbox principal                        │    │
│  │  • Session recordings for audit trail                                           │    │
│  │  • Automatic session termination after max duration                             │    │
│  │                                                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │  CREDENTIAL FLOW                                                                 │    │
│  │                                                                                  │    │
│  │  1. Boundary authenticates developer (OIDC)                                     │    │
│  │  2. Developer authorized for target (RBAC)                                      │    │
│  │  3. Vault signs SSH certificate (short TTL, sandbox-scoped)                     │    │
│  │  4. Certificate injected to developer's machine                                 │    │
│  │  5. Certificate used for SSH to container                                       │    │
│  │  6. Certificate expires (no persistent access)                                  │    │
│  │                                                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan for Multi-Developer Support

### Phase 1: Extension Support for Host-ID Selection
- [ ] Add `-host-id` parameter to `BoundaryCLI.connect()`
- [ ] Update `ConnectOptions` interface
- [ ] Add host selection UI when target has multiple hosts
- [ ] Store developer→host assignments in VS Code settings

### Phase 2: Boundary Pool Configuration
- [ ] Create Terraform module for team sandbox pools
- [ ] Configure host set with multiple sandbox services
- [ ] Setup Vault SSH CA with team-scoped principals
- [ ] Test multi-host target with `-host-id` selection

### Phase 3: Assignment Persistence
- [ ] Implement assignment storage (VS Code globalState or external)
- [ ] Add "first-time assignment" UX flow
- [ ] Handle assignment conflicts (sandbox already assigned)
- [ ] Add "release assignment" command

### Phase 4: Sandbox Pool Scaling (Optional)
- [ ] Integrate with Kubernetes autoscaling
- [ ] Implement idle sandbox detection
- [ ] Add pool utilization monitoring
- [ ] Create alerts for pool exhaustion

---

## Extension Changes Summary

```typescript
// Required changes to support multi-developer pools

// 1. Add host-id to CLI wrapper (src/boundary/cli.ts)
interface ConnectOptions {
  targetId: string;
  hostId?: string;  // NEW: Select specific host from pool
}

// 2. Add assignment storage (new file: src/sandbox/assignment.ts)
interface SandboxAssignment {
  userId: string;         // Boundary user ID
  targetId: string;       // Pool target
  hostId: string;         // Assigned sandbox host
  hostName: string;       // Human-readable name
  assignedAt: Date;
}

// 3. Add host discovery (new capability)
interface PoolTarget extends BoundaryTarget {
  isPool: boolean;
  hosts?: Array<{
    id: string;
    name: string;
    address: string;
  }>;
}

// 4. Modify connection flow
async function connectToPool(target: PoolTarget): Promise<Session> {
  // Check for existing assignment
  let assignment = await getAssignment(target.id);

  if (!assignment) {
    // Show host selection or auto-assign
    const hostId = await selectOrAssignHost(target);
    assignment = await saveAssignment(target.id, hostId);
  }

  // Connect with specific host
  return this.cli.connect(target.id, { hostId: assignment.hostId });
}
```

---

## References

- [k8s-agent-sandbox Repository](https://github.com/CloudbrokerAz/k8s-agent-sandbox)
- [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox)
- [Boundary Multiple Hosts Discussion](https://discuss.hashicorp.com/t/multiple-host-in-a-host-set-host-catalog/39843)
- [VS Code Remote SSH Documentation](https://code.visualstudio.com/docs/remote/ssh)
- [Boundary SSH Targets](https://developer.hashicorp.com/boundary/docs/concepts/domain-model/targets)
- [Vault SSH Secrets Engine](https://developer.hashicorp.com/vault/docs/secrets/ssh)
- [GitHub Issue #14](https://github.com/hashi-demo-lab/vscode-boundary-connect/issues/14)
