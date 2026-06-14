# Worker Routing Contract (v0.8A)

Defines how the cloud coordinator routes jobs to replaceable workers. Complements `docs/bridge/coordinator-contract.md` (v0.7 intake/status) with capability-based worker selection.

## Job routing fields

| Field | Required | Description |
|-------|----------|-------------|
| `target_worker_profile` | no | Explicit worker id (e.g. `cloud-readonly`). If omitted, coordinator picks best eligible worker. |
| `required_capabilities` | no | Hard requirements: `local_cursor`, `synced_repo`, etc. |
| `workspace_ref` | recommended | Logical workspace id (e.g. `TimOS-Agent`, `timfinance`) |
| `repo_ref` | conditional | Synced repo pointer (e.g. `github:org/repo@main`). Required for cloud-readonly. |
| `task_type` | yes | e.g. `inspect_only`, `summarize_repo`, `propose_patch` |
| `risk_level` | yes | e.g. `low`, `medium`, `high` |
| `auto_run_requested` | no | Client intent; worker-side policy still decides execution |
| `result_contract` | recommended | Expected result shape for client polling |

### Optional constraint flags

| Field | Description |
|-------|-------------|
| `requires_local_files` | Job needs paths only on Tim's machine |
| `requires_local_credentials` | Job needs local secrets/SSH/env |
| `requested_actions` | Explicit action list — `deploy`, `push`, `migration` blocked for cloud |

### Example job (cloud-readonly eligible)

```json
{
  "workspace_ref": "TimOS-Agent",
  "repo_ref": "github:timos-agent",
  "task_type": "inspect_only",
  "risk_level": "low",
  "auto_run_requested": true,
  "requested_by": "xiaoju",
  "prompt": "Inspect this repository and summarize the current structure. Do not modify files.",
  "result_contract": {
    "format": "markdown_summary",
    "include_files_changed": false
  }
}
```

## Worker profile fields

See `config/worker-profiles.json.example`.

| Field | Description |
|-------|-------------|
| `id` | Profile id (`station1-local`, `cloud-readonly`, …) |
| `station` | Station label for coordinator queue partitioning |
| `location` | `local` or `cloud` |
| `availability` | `always_on` or `when_computer_on` |
| `can_use_local_cursor` | Whether local Cursor execution is available |
| `allowed_task_types` | Task types this worker accepts |
| `allowed_risk_levels` | Risk levels this worker accepts |
| `requires_synced_repo` | Worker needs `repo_ref` on the job |
| `forbidden` | Phrases/actions never allowed for this worker |

## Routing algorithm (coordinator)

1. Load active worker profiles and availability signals (Station1 heartbeat optional).
2. Filter profiles where:
   - `target_worker_profile` matches (if set)
   - `task_type` ∈ `allowed_task_types`
   - `risk_level` ∈ `allowed_risk_levels`
   - `repo_ref` present when `requires_synced_repo`
   - Job does not require local credentials/files for cloud profiles
   - Job does not request forbidden actions (deploy, push, migrations, …)
   - Profile is available (`always_on` or station online)
3. Rank eligible workers (prefer `always_on` when Station1 offline).
4. Assign job to selected worker queue.
5. Worker pulls job, **re-validates** capability, executes, submits result.

## Worker acceptance rules

Before claiming a job, each worker must re-run capability validation. The worker must refuse if:

- Job exceeds its `allowed_task_types` or `allowed_risk_levels`
- Cloud worker lacks `repo_ref`
- Job requires `local_cursor` but profile has `can_use_local_cursor: false`
- Prompt or `requested_actions` contain forbidden operations

## Execution gates

| Layer | Role |
|-------|------|
| Coordinator routing | Capability + availability filter |
| Worker accept | Re-validate before claim |
| Station1 local policy (v0.6) | Final auto-run gate for `station1-local` + Cursor |
| Cloud worker policy (future v0.8B) | Separate cloud policy — no local approve/run |

**Local v0.6 policy remains the final execution gate for Station1.** Cloud workers will define their own policy module in v0.8B; they must not call local approve/run endpoints.

## Station1 optional

`cloud-readonly` eligibility does **not** depend on `station1-local` being online. A low-risk `inspect_only` job with `repo_ref` can route to cloud while Tim's main computer is off.

`station1-local` is used when:

- Job requires local Cursor or local-only paths
- Tim's computer is on and profile is available
- Coordinator or client sets `target_worker_profile: station1-local`

## Result contract

`result_contract` describes what the client expects when polling `GET /station-jobs/:id`:

```json
{
  "format": "markdown_summary",
  "include_files_changed": false,
  "max_stdout_preview_chars": 500
}
```

Workers submit results via `POST /station-jobs/:id/result` (coordinator contract). Cloud workers include summary text and metadata only — not raw credential output.

## Not in v0.8A

- Coordinator deploy
- Cloud worker runtime
- Repo sync
- GPT Action schema update
- `always-on-home` / `cloud-edit-pr` profiles (documented as future only)

## Local validation

```bash
node scripts/worker-routing-smoke-test.js
```

Validates profile config and routing rules in-memory without network or Cursor.
