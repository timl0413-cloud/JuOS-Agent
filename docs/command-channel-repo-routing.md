# Command Channel: Task-Based Repo Routing

JuOS command-channel jobs route to a repository and worker **per task payload**, not by which room or GPT created the job. A single room may request work against different repos when `repo_ref`, `workspace_ref`, and `target_worker_profile` are valid and a matching worker hub is running.

See also:

- [`command-channel-room-capabilities.yaml`](./command-channel-room-capabilities.yaml) — room/GPT capability registry
- [`command-channel/room-lane-identity-v0.md`](./command-channel/room-lane-identity-v0.md) — room/lane identity registry (`source_room`, `active_lane`)
- [`command-channel/jub-lane-contract-v0.md`](./command-channel/jub-lane-contract-v0.md) — JUB lane contract and registry plan before any workspace creation
- [`command-channel/gsync-direct-execution-path-v0.md`](./command-channel/gsync-direct-execution-path-v0.md) — GSync direct development route
- [`bridge/xiaoju-command-channel.md`](./bridge/xiaoju-command-channel.md) — no-paste flow and security boundary
- [`bridge/worker-routing-contract.md`](./bridge/worker-routing-contract.md) — coordinator routing fields and algorithm

## Terms

| Term | Meaning |
|------|---------|
| **Room / GPT** | A ChatGPT custom GPT or JuOS room (e.g. XiaoJu, Gsync, FA, JOB, Core). Rooms talk to Tim; they do not own repo routing. |
| **Action capability** | Whether a room's GPT Action can call the command-channel API (`POST /remote-jobs`, `GET /remote-jobs/{id}`). Configured per room; separate from which repo a job targets. |
| **`repo_ref`** | Logical repo identifier on the job (e.g. `TimOS-Agent`, `TimFinance`). Required for most routed work. |
| **`workspace_ref`** | Local workspace path or logical workspace id the worker should use (e.g. `C:\projects\TimOS-Agent`). Required for supervised local profiles. |
| **`target_worker_profile`** | Worker profile id the coordinator and worker hub use to claim and execute the job (e.g. `joa`, `finance`, `jucore`, `nova`, `spacea`, `ministry`, `cloud-readonly`). |
| **Worker hub** | A long-running local process that polls the coordinator for jobs for one profile and executes them (typically via Cursor Agent). Started from scripts such as `scripts/start-worker-hubs.ps1` or `scripts/start-juos-worker-hub.ps1`. |

## Routing principle

**Repo is assigned per task/job, not per room.**

```
Room/GPT (any action-capable room)
    |
    |  POST /remote-jobs
    |  repo_ref, workspace_ref, target_worker_profile on payload
    v
Command channel coordinator
    |
    |  routes by target_worker_profile + task validation
    v
Worker hub (profile-specific poll + local workspace)
    |
    v
Target repo / workspace
```

A room may create jobs for `TimOS-Agent` via `target_worker_profile: joa` and later jobs for `TimFinance` via `target_worker_profile: finance`. The room identity (`requested_by`, GPT name) is audit metadata only; it does not lock routing to one repo.

## Confirmed worker profiles (current)

These profiles have confirmed repo/workspace contracts in TimOS-Agent today:

| Profile | `repo_ref` | `workspace_ref` | Notes |
|---------|------------|-----------------|-------|
| `joa` | `TimOS-Agent` | `C:\projects\TimOS-Agent` | JOA worker hub; supervised implement / approved finalize |
| `finance` | `TimFinance` | `C:\projects\TimFinance` | Finance worker hub |
| `jucore` | `JuCore` | `C:\projects\JuCore` | JuCore worker hub (Gsync local scaffold); supervised implement / approved finalize |
| `gsync` | `juos-knowledge-vault` | `C:\projects\juos-knowledge-vault` | GSync direct dev; writes restricted to `gsync/**` — see [`gsync-direct-execution-path-v0.md`](./command-channel/gsync-direct-execution-path-v0.md) |
| `nova` | `Nova` | `C:\projects\Nova` | Nova worker hub; inspect / supervised implement / approved finalize |
| `spacea` | per job (`STUF`, `Kenkoup`, `Primoo`, `_ClientOps`) | per job (see below) | SpaceA bridge; multi-target local Cursor routing |
| `ministry` | per job (`IMPACT`, `BETHANY`, `GFPF`, `GospelFilm`, `_MinistryOps`) | per job (see below) | MinistryOps bridge; multi-target local Cursor routing |

Additional coordinator profiles (e.g. `cloud-readonly`, `nova-reading`) use synced repo sources or read-only task types; see `lib/command-channel-core.js` and `bridge/worker-routing-contract.md`.

### Scoped write profile (`gsync`)

Profile `gsync` uses a single workspace with **subdirectory write enforcement** (`gsync/**`) defined in `config/workspace-targets.json`. The worker rejects supervised jobs and `approved_finalize` allowlists that touch paths outside that scope.

| Profile | Workspace | Allowed write scope |
|---------|-----------|---------------------|
| `gsync` | `C:\projects\juos-knowledge-vault` | `gsync/**` only |

### Multi-workspace bridge profiles (`spacea`, `ministry`)

These profiles use **one central worker hub** (default poll workspace: `C:\projects\TimOS-Agent`) with **multiple allowed execution targets** defined in `config/workspace-targets.json` and validated by `lib/workspace-target-registry.js`.

| Profile | Allowed normal workspace targets | Admin/shared target | Blocked parent |
|---------|----------------------------------|---------------------|----------------|
| `spacea` | `C:\projects\SpaceA\STUF-Website`, `Kenkoup`, `Primoo` | `C:\projects\SpaceA\_ClientOps` (requires `work_purpose`: registry, admin, template, shared_ops) | `C:\projects\SpaceA` |
| `ministry` | `C:\projects\MinistryOps\IMPACT`, `BETHANY`, `GFPF`, `GospelFilm` | `C:\projects\MinistryOps\_MinistryOps` (requires `work_purpose`) | `C:\projects\MinistryOps` |

Classification rules:

- **SpaceA** projects: STUF, Kenkoup, Primoo
- **MinistryOps** projects: IMPACT, BETHANY, GFPF, GospelFilm
- **GospelFilm** belongs under MinistryOps only (`target_worker_profile: ministry`)
- Billing channel must not decide workspace classification; project nature, ownership, and review context decide classification
- Non-git folders are valid workspace targets (git is not required for routing validation)

Every `spacea` / `ministry` job result should include a structured report: workspace touched, files changed, what changed, risks, check/preview result, what Tim needs to review, and anything skipped due to guardrails.

## Action-capable rooms (registry)

Rooms that **may** have command-channel Actions when configured:

| Room | Action-capable | Repo/profile support |
|------|----------------|----------------------|
| XiaoJu | yes (primary) | Any valid task target; typically `joa`, `finance`, `jucore`, `nova`, `spacea`, or `ministry` |
| Gsync | if configured | Direct dev via `gsync` + `juos-knowledge-vault` (`gsync/**` writes); JuCore scaffold via `jucore` when hub running |
| FA | if configured | Depends on task target and available profiles |
| JOB | if configured | Depends on task target and available profiles |
| Core | if configured | Depends on task target and available profiles — **no dedicated repo yet** |

Full registry: [`command-channel-room-capabilities.yaml`](./command-channel-room-capabilities.yaml).

## Future repos (planning only — not created)

| Planned scope | Status |
|---------------|--------|
| Gsync / JuCore local scaffold | **Added** — local workspace `C:\projects\JuCore` with `jucore` profile (Tim approved); not a separate remote repo |
| JUB hosted platform-operation lane | **Documentation only** — no `C:\projects\JUB`, no `jub` worker profile, no backend extraction yet; see [`jub-lane-contract-v0.md`](./command-channel/jub-lane-contract-v0.md) |
| Core repo | **TBD** — placeholder only; do not create automatically |

When additional repos exist beyond the local JuCore scaffold, add worker profiles and registry entries only after Tim approval. Gsync/Core rooms may create jobs against confirmed profiles when task payload and running hubs match.

## Guardrails

- **No automatic repo creation** — documentation and jobs must not assume new repos will be scaffolded without an explicit Tim-approved task.
- **No new `target_worker_profile` values without Tim approval** — extend `ALLOWED_WORKER_PROFILES` and hub scripts only after review.
- **No sensitive local settings in docs** — do not commit tokens, `.env` paths with secrets, or production credentials.
- **No production settings changes from docs-only work** — policy docs do not modify deploy env, Supabase, or Vercel configuration.
- **Worker hub default workspace is not room routing** — hub scripts pick a default cwd for polling; the job payload still defines `repo_ref` / `workspace_ref` for supervised work.

## Example job payloads

### Inspect-only (TimOS-Agent via JOA)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "TimOS-Agent",
  "workspace_ref": "C:\\projects\\TimOS-Agent",
  "target_worker_profile": "joa",
  "task_type": "inspect_only",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Inspect repository structure. Do not modify files.",
  "approval_required": true
}
```

### Supervised implement (TimFinance via finance profile)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "TimFinance",
  "workspace_ref": "C:\\projects\\TimFinance",
  "target_worker_profile": "finance",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description here.",
  "approval_required": true
}
```

### Supervised implement (juos-knowledge-vault via gsync profile)

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
  "prompt": "Task description here — changes under gsync/ only.",
  "approval_required": true
}
```

### Inspect-only (juos-knowledge-vault via gsync profile)

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
  "prompt": "Read-only inspect of workspace connectivity and gsync/ layout.",
  "approval_required": true
}
```

### Supervised implement (JuCore via jucore profile)

```json
{
  "requested_by": "gsync",
  "repo_ref": "JuCore",
  "workspace_ref": "C:\\projects\\JuCore",
  "target_worker_profile": "jucore",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description here.",
  "approval_required": true
}
```

### Supervised implement (Nova via nova profile)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "Nova",
  "workspace_ref": "C:\\projects\\Nova",
  "target_worker_profile": "nova",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description here.",
  "approval_required": true
}
```

### Supervised implement (STUF via spacea profile)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "STUF",
  "workspace_ref": "C:\\projects\\SpaceA\\STUF-Website",
  "target_worker_profile": "spacea",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description here.",
  "approval_required": true
}
```

### Supervised implement (IMPACT via ministry profile)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "IMPACT",
  "workspace_ref": "C:\\projects\\MinistryOps\\IMPACT",
  "target_worker_profile": "ministry",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description here.",
  "approval_required": true
}
```

### Supervised implement (GospelFilm via ministry profile)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "GospelFilm",
  "workspace_ref": "C:\\projects\\MinistryOps\\GospelFilm",
  "target_worker_profile": "ministry",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description here.",
  "approval_required": true
}
```

### Admin registry work (SpaceA _ClientOps)

```json
{
  "requested_by": "xiaoju",
  "repo_ref": "_ClientOps",
  "workspace_ref": "C:\\projects\\SpaceA\\_ClientOps",
  "target_worker_profile": "spacea",
  "work_purpose": "registry",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Update client registry entry.",
  "approval_required": true
}
```

## Room smoke test checklist

Use this after wiring a room's Action or changing routing policy. Goal: prove end-to-end flow with **no file changes**.

1. **Create job** — From the room, create a supervised `inspect_only` job with `repo_ref`, `workspace_ref`, and `target_worker_profile` set for a confirmed profile (e.g. `joa` + `TimOS-Agent`).
2. **Tim approve** — Job stays pending until Tim approves (`approval_required: true`).
3. **Hub auto-claim** — Matching worker hub is running (`worker_profile=joa`, `finance`, `jucore`, `nova`, `spacea`, or `ministry`); job moves to `claimed`.
4. **Cursor result completed** — Worker finishes; poll `GET /remote-jobs/{id}` until `status: completed` with a result summary.
5. **No file changes** — Confirm `inspect_only` produced read-only output; working tree in the target repo is unchanged.

Local hub startup (reference only): `scripts/start-worker-hubs.ps1` for `joa`, `finance`, `jucore`, `gsync`, `nova`, `spacea`, and `ministry` hubs.

## Related scripts

| Script | Purpose |
|--------|---------|
| `scripts/start-worker-hubs.ps1` | Launch JOA, Finance, JuCore, GSync, Nova, SpaceA, and Ministry persistent hubs |
| `scripts/start-juos-worker-hub.ps1` | Multi-profile poll loop (dev / extended profiles) |
| `scripts/command-channel-worker.js` | Worker poll, claim, Cursor handoff |
| `scripts/command-channel-smoke-test.js` | Local coordinator contract smoke test |
