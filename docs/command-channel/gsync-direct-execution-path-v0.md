# GSync Direct Development Execution Path v0

Minimum safe command-channel route so **GSync owns GSync development** in `juos-knowledge-vault` while **JOA owns routing / worker bridge plumbing only**.

## Status

| Item | Value |
|------|-------|
| Direct-send possible | **Yes** — after Tim starts the `gsync` worker hub |
| Worker profile | `gsync` |
| Repo | `juos-knowledge-vault` |
| Workspace | `C:\projects\juos-knowledge-vault` |
| Write scope | `gsync/**` only |
| First allowed action | `inspect_only` (read-only smoke test) |

## Boundary

| Owner | Scope |
|-------|-------|
| **GSync room** | GSync domain work under `gsync/**` in `juos-knowledge-vault` |
| **JOA / TimOS-Agent** | Command-channel profile, validation, worker hub scripts, docs |
| **Not in scope** | JOA implementing `/gsync` content; JuCore activation; auth/schema changes |

## Route GSync should use

Every GSync development job must set these fields on the payload:

```yaml
source_room: GSync
active_lane: gsync-dev
target_worker_profile: gsync
repo_ref: juos-knowledge-vault
workspace_ref: C:\projects\juos-knowledge-vault
requested_by: gsync
```

## First action: read-only inspect smoke test

| Field | Value |
|-------|-------|
| `task_type` | `inspect_only` |
| `risk_level` | `low` |
| `approval_required` | `true` |
| `auto_run_requested` | `true` (after Tim approval) |
| Cursor mode | ask (no file writes) |

Example payload:

```json
{
  "requested_by": "gsync",
  "source_room": "GSync",
  "active_lane": "gsync-dev",
  "target_worker_profile": "gsync",
  "repo_ref": "juos-knowledge-vault",
  "workspace_ref": "C:\\projects\\juos-knowledge-vault",
  "task_type": "inspect_only",
  "risk_level": "low",
  "auto_run_requested": true,
  "approval_required": true,
  "prompt": "Read-only connectivity inspect: confirm workspace is reachable, list top-level structure, note whether gsync/ exists. Do not modify any files."
}
```

**Pass criteria:** job completes with `status: completed`; working tree in `juos-knowledge-vault` unchanged.

## Write jobs (`supervised_implement`)

| Rule | Detail |
|------|--------|
| Approval | `approval_required: true`; Tim must approve before claim |
| Write scope | Files may change **only** under `gsync/**` |
| Enforcement | Worker validates git diff after execution; paths outside `gsync/**` → `failed` |
| Prompt guardrails | Cursor prompt includes scoped-write boundary from `config/workspace-targets.json` |
| Source control | No commit/push from supervised jobs |

Example payload:

```json
{
  "requested_by": "gsync",
  "source_room": "GSync",
  "active_lane": "gsync-dev",
  "target_worker_profile": "gsync",
  "repo_ref": "juos-knowledge-vault",
  "workspace_ref": "C:\\projects\\juos-knowledge-vault",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "approval_required": true,
  "prompt": "Implement the approved GSync task under gsync/ only."
}
```

## Finalize (`approved_finalize`)

| Rule | Detail |
|------|--------|
| Approval | `approval_status: approved` required |
| `allowlist_paths` | Every path must be under `gsync/**` (exact paths from `git status --short`) |
| Rejection | Allowlist entries outside `gsync/**` fail validation before git runs |

## Worker hub startup

Start a **separate** persistent loop for profile `gsync` (one loop per profile):

```powershell
# From token-loaded supervisor shell:
node scripts/command-channel-worker.js --http --worker-profile gsync --provider codex
```

Or via helper:

```powershell
.\scripts\start-juos-worker.ps1 -Profile gsync -Loop
```

Hub poll workspace: `C:\projects\juos-knowledge-vault`.

Full multi-hub launcher (`scripts/start-worker-hubs.ps1`) includes GSync when Tim starts all lanes.

## Validation helper

Read-only route readiness check (no network, no writes):

```powershell
node scripts/validate-gsync-route-readiness.js
```

Checks profile registration, repo/workspace contract, and write-scope config.

## Rejection examples

| Case | Result |
|------|--------|
| `workspace_ref: C:\projects\TimOS-Agent` with profile `gsync` | Create rejected — workspace must match contract |
| `repo_ref: JuCore` with profile `gsync` | Create rejected — repo must be `juos-knowledge-vault` |
| Supervised job modifies `README.md` at repo root | Job `failed` — outside `gsync/**` |
| `approved_finalize` with `allowlist_paths: ["docs/foo.md"]` | Claim rejected — outside `gsync/**` |

## Related docs

- [`command-channel-repo-routing.md`](../command-channel-repo-routing.md) — profile table
- [`command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml) — registry
- [`room-lane-identity-v0.md`](./room-lane-identity-v0.md) — lane identity
- [`parallel-lane-readiness-v0.md`](./parallel-lane-readiness-v0.md) — parallel capacity
- [`templates/command-channel/cross-room-readiness-packet.md`](../../templates/command-channel/cross-room-readiness-packet.md) — handoff template

## Remaining setup (Tim / worker host)

1. Confirm `C:\projects\juos-knowledge-vault` exists on the worker host
2. Start `gsync` worker hub in a dedicated shell
3. Run read-only `inspect_only` smoke test; Tim approves
4. Only after smoke pass: approve first `supervised_implement` under `gsync/**`

JOA does **not** implement GSync domain files in this path — GSync sends and owns those jobs directly.
