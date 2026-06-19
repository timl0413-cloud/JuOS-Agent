# Command Channel: Task-Based Repo Routing

JuOS command-channel jobs route to a repository and worker **per task payload**, not by which room or GPT created the job. A single room may request work against different repos when `repo_ref`, `workspace_ref`, and `target_worker_profile` are valid and a matching worker hub is running.

See also:

- [`command-channel-room-capabilities.yaml`](./command-channel-room-capabilities.yaml) — room/GPT capability registry
- [`bridge/xiaoju-command-channel.md`](./bridge/xiaoju-command-channel.md) — no-paste flow and security boundary
- [`bridge/worker-routing-contract.md`](./bridge/worker-routing-contract.md) — coordinator routing fields and algorithm

## Terms

| Term | Meaning |
|------|---------|
| **Room / GPT** | A ChatGPT custom GPT or JuOS room (e.g. XiaoJu, Gsync, FA, JOB, Core). Rooms talk to Tim; they do not own repo routing. |
| **Action capability** | Whether a room's GPT Action can call the command-channel API (`POST /remote-jobs`, `GET /remote-jobs/{id}`). Configured per room; separate from which repo a job targets. |
| **`repo_ref`** | Logical repo identifier on the job (e.g. `TimOS-Agent`, `TimFinance`). Required for most routed work. |
| **`workspace_ref`** | Local workspace path or logical workspace id the worker should use (e.g. `C:\projects\TimOS-Agent`). Required for supervised local profiles. |
| **`target_worker_profile`** | Worker profile id the coordinator and worker hub use to claim and execute the job (e.g. `joa`, `finance`, `jucore`, `cloud-readonly`). |
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

Additional coordinator profiles (e.g. `cloud-readonly`, `nova-reading`) use synced repo sources or read-only task types; see `lib/command-channel-core.js` and `bridge/worker-routing-contract.md`.

## Action-capable rooms (registry)

Rooms that **may** have command-channel Actions when configured:

| Room | Action-capable | Repo/profile support |
|------|----------------|----------------------|
| XiaoJu | yes (primary) | Any valid task target; typically `joa`, `finance`, or `jucore` |
| Gsync | if configured | Local scaffold via `jucore` + `JuCore` when hub is running; may also target other confirmed profiles |
| FA | if configured | Depends on task target and available profiles |
| JOB | if configured | Depends on task target and available profiles |
| Core | if configured | Depends on task target and available profiles — **no dedicated repo yet** |

Full registry: [`command-channel-room-capabilities.yaml`](./command-channel-room-capabilities.yaml).

## Future repos (planning only — not created)

| Planned scope | Status |
|---------------|--------|
| Gsync / JuCore local scaffold | **Added** — local workspace `C:\projects\JuCore` with `jucore` profile (Tim approved); not a separate remote repo |
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

## Room smoke test checklist

Use this after wiring a room's Action or changing routing policy. Goal: prove end-to-end flow with **no file changes**.

1. **Create job** — From the room, create a supervised `inspect_only` job with `repo_ref`, `workspace_ref`, and `target_worker_profile` set for a confirmed profile (e.g. `joa` + `TimOS-Agent`).
2. **Tim approve** — Job stays pending until Tim approves (`approval_required: true`).
3. **Hub auto-claim** — Matching worker hub is running (`worker_profile=joa`, `finance`, or `jucore`); job moves to `claimed`.
4. **Cursor result completed** — Worker finishes; poll `GET /remote-jobs/{id}` until `status: completed` with a result summary.
5. **No file changes** — Confirm `inspect_only` produced read-only output; working tree in the target repo is unchanged.

Local hub startup (reference only): `scripts/start-worker-hubs.ps1` for `joa`, `finance`, and `jucore` hubs.

## Related scripts

| Script | Purpose |
|--------|---------|
| `scripts/start-worker-hubs.ps1` | Launch JOA, Finance, and JuCore persistent hubs |
| `scripts/start-juos-worker-hub.ps1` | Multi-profile poll loop (dev / extended profiles) |
| `scripts/command-channel-worker.js` | Worker poll, claim, Cursor handoff |
| `scripts/command-channel-smoke-test.js` | Local coordinator contract smoke test |
