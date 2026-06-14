# TimOS-Agent

Local coding worker router and XiaoJu bridge — register workspaces and workers, queue jobs, approve them, and run through local agents.

## Requirements

- Node.js 18+
- Cursor Agent installed locally (see `config/runtime.json`)

No external npm dependencies. Jobs are stored as JSON files under `data/jobs/`.

## Configuration

| File | Purpose |
|------|---------|
| `config/workspaces.json` | Registered code workspaces |
| `config/workers.json` | Job runners (`manual`, `cursor`, `codex`) |
| `config/runtime.json` | Cursor Agent paths and safety settings |
| `config/auth.json.example` | Example bearer token config (copy to `config/auth.json`) |
| `config/auto-run-policy.json.example` | Example auto-run policy (copy to `config/auto-run-policy.json`) |

Copy `config/auth.json.example` to `config/auth.json` and set a local secret before using protected API endpoints. `config/auth.json` is gitignored.

### Runtime safety defaults

- `allowed_workspace_root` — jobs may only run under this path (`C:\projects`)
- `require_confirm_execution` — cursor jobs refuse to run without explicit confirmation

## CLI (v0.1)

```bash
node scripts/agent.js workspaces
node scripts/agent.js workers
node scripts/agent.js job:create timfinance manual "Check TimOS API action failure"
node scripts/agent.js jobs
node scripts/agent.js job:show <job-id>
```

## CLI (v0.2 — job runner)

```bash
node scripts/agent.js job:run-next --confirm-execution
node scripts/agent.js job:run <job-id> --confirm-execution
node scripts/agent.js job:complete <job-id> "<result>"
node scripts/agent.js job:fail <job-id> "<error>"
```

CLI-created jobs use `status: "queued"` and can be run directly with `--confirm-execution`.

### Worker behavior

| Worker | `job:run` behavior |
|--------|-------------------|
| `manual` | Refuses — use `job:complete` or `job:fail` |
| `codex` | Refuses — not available on this machine |
| `cursor` | Runs Cursor Agent via configured `node_path` + `index_path` |

## CLI (v0.2.1 — Cursor headless read-only)

The cursor runner uses Cursor Agent headless mode:

- `--print` — non-interactive/script use
- `--output-format text` — plain text output
- `--mode ask` — read-only mode (no file edits)
- `--trust` — workspace trust in headless mode
- `--workspace <path>` — target workspace

The runner passes `--trust` only. It never passes `--yolo`, `-f`, `--force`, or sandbox-disabling flags.

## HTTP API (v0.3 — approval gate)

Start the local API:

```bash
node scripts/server.js
```

Default bind: `127.0.0.1:8787`

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Service health and version |
| GET | `/jobs` | List all jobs |
| GET | `/jobs/:id` | Show one job |
| POST | `/jobs` | Create job (requires approval before run) |
| POST | `/jobs/:id/approve` | Approve a pending job |
| POST | `/jobs/:id/run` | Run an approved job |

### Create job

```http
POST /jobs
Content-Type: application/json

{
  "workspace": "timfinance",
  "worker": "cursor",
  "prompt": "Inspect the repository and summarize the app structure. Do not modify files.",
  "requested_by": "xiaoju",
  "mode": "read_only"
}
```

API-created jobs default to `status: "needs_approval"` with an `approval` object. They cannot run until Tim approves them.

### Approve job

```http
POST /jobs/:id/approve
Content-Type: application/json

{
  "approved_by": "tim",
  "approval_note": "Approved read-only inspection"
}
```

Sets `status` to `"approved"`.

### Run job

```http
POST /jobs/:id/run
Content-Type: application/json

{
  "confirm_execution": true
}
```

Refuses unless the job is `approved`, `approval.approved` is true, and `confirm_execution` is true. Does not run `queued` or `needs_approval` jobs.

### Safety (v0.3)

- Jobs created via API require Tim approval before execution
- No approval means no run
- Pushed: false by default — do not use for deploy or migration yet
- Local bind only (`127.0.0.1`) — not exposed to the network by default

## HTTP API (v0.4 — bearer auth)

Protected endpoints require:

```http
Authorization: Bearer <token>
```

`GET /health` remains public. All other endpoints require a valid token from `config/auth.json`.

### Setup

```bash
copy config\auth.json.example config\auth.json
```

Edit `config/auth.json` and set secrets for both token profiles (`xiaoju-action-create-read` and `tim-local-operator`).

Start the server:

```bash
node scripts/server.js
```

### Auth errors

| Status | Error | Meaning |
|--------|-------|---------|
| 503 | `auth_not_configured` | `config/auth.json` is missing |
| 401 | `invalid_token` | Missing or wrong bearer token |
| 403 | `insufficient_scope` | Token lacks required scope |

### Token scopes

| Endpoint | Required scope |
|----------|----------------|
| GET `/jobs` | `jobs:read` |
| GET `/jobs/:id` | `jobs:read` |
| POST `/jobs` | `jobs:create` |
| POST `/jobs/:id/approve` | `jobs:approve` |
| POST `/jobs/:id/run` | `jobs:run` |

### GPT Action readiness (v0.4)

OpenAPI schema (operator/internal): `docs/openapi/timos-agent-action.openapi.yaml`

- Replace `https://YOUR-TUNNEL-URL` with your tunnel or deployed coordinator URL
- Configure bearer auth using the operator token locally
- ChatGPT cannot call `127.0.0.1` directly — use a tunnel or deployed coordinator later
- Do not expose the API without auth

## HTTP API (v0.5 — action-safe GPT permissions)

Split token profiles so XiaoJu GPT Action cannot approve or run jobs.

| Token profile | Scopes | Use |
|---------------|--------|-----|
| `xiaoju-action-create-read` | `jobs:read`, `jobs:create` | GPT Action only |
| `tim-local-operator` | all four scopes | Tim / local operator only |

### GPT Action import

Use the action-safe schema only:

```
docs/openapi/timos-agent-action-safe.openapi.yaml
```

**Never** import the full operator schema (`timos-agent-action.openapi.yaml`) into XiaoJu GPT Action.

- Put the `xiaoju-action-create-read` token in GPT Action bearer auth
- Keep the `tim-local-operator` token local with Tim
- Approval and run remain local/operator only

See `docs/security/action-safety.md` for the full safety boundary.

### Action-safe smoke test

```bash
node scripts/server.js
node scripts/api-action-safe-smoke-test.js
```

Verifies the action token can create/read but receives `403 insufficient_scope` on approve and run.

### Operator smoke test (does not run Cursor by default)

```bash
node scripts/server.js
node scripts/api-auth-smoke-test.js
```

The legacy `api-smoke-test.js` is deprecated in v0.4. Use `api-auth-smoke-test.js`.

Pass `--run` to the auth smoke test only when you intend to execute Cursor:

```bash
node scripts/api-auth-smoke-test.js --run
```

## HTTP API (v0.6 — supervised auto-run policy)

Reduce Tim's manual bridge burden: XiaoJu can request low-risk inspect-only jobs with `auto_run_requested: true`, and TimOS-Agent evaluates local policy to auto-approve and auto-run eligible jobs. High-risk jobs still require operator approval.

### Principles

- **XiaoJu action token stays read/create only** — no `jobs:approve` or `jobs:run` scope
- **TimOS-Agent local policy controls auto-run** — see `config/auto-run-policy.json.example`
- **Low-risk inspect-only jobs can auto-run** when all policy fields match (station, worker, mode, task_type, risk_level, workspace allowlist, prompt phrases)
- **High-risk or mismatched jobs remain `needs_approval`**
- **Phone/GPT Action still needs a reachable endpoint later** — tunnel or cloud coordinator; do not expose full operator schema/token to GPT Action

### Auto-run policy setup

```bash
copy config\auto-run-policy.json.example config\auto-run-policy.json
```

Edit rules locally. `config/auto-run-policy.json` is gitignored. If missing or disabled, auto-run is off and all API jobs require approval.

### Create job with auto-run request

```http
POST /jobs
Authorization: Bearer <xiaoju-action-create-read token>
Content-Type: application/json

{
  "station": "station1",
  "workspace": "TimOS-Agent",
  "worker": "cursor",
  "mode": "read_only",
  "task_type": "inspect_only",
  "risk_level": "low",
  "auto_run_requested": true,
  "requested_by": "xiaoju",
  "prompt": "Inspect this repository and summarize the current structure. Do not modify files."
}
```

When policy matches:

- `status` is `auto_running` in the create response
- `approval.approved_by` is `policy:<policy_id>`
- TimOS-Agent starts Cursor **asynchronously** after responding (non-blocking)
- Poll `GET /jobs/:id` for `running`, then `completed` or `failed`
- Audit record written under `data/audit/`

When policy does not match:

- `status` remains `needs_approval`
- `policy_result` explains why
- Tim approves/runs locally with operator token as before

### Auto-run smoke test

Dry run (validates config, does not execute Cursor):

```bash
node scripts/server.js
node scripts/api-auto-run-smoke-test.js
```

Execute Cursor (requires policy file and `--run`):

```bash
node scripts/api-auto-run-smoke-test.js --run
```

The smoke test polls job status until completion. Auto-run uses a non-blocking Cursor path so `/health` and `/jobs/:id` stay responsive while the job runs.

## HTTP API (v0.7 — coordinator bridge stub)

Phone and ChatGPT cannot reach `127.0.0.1`. v0.7 adds the **first phone-reachable connection path design** without exposing the local TimOS-Agent API directly.

### Preferred architecture

**Cloud coordinator / queue + Station1 polling worker**

```
XiaoJu / phone  -->  cloud coordinator  <--  Station1 poll worker  -->  local TimOS-Agent (127.0.0.1)
   action token         queue                  station worker token        action token only
```

- XiaoJu/phone talks to the **coordinator**, not local API
- Station1 **pulls** jobs outbound (no inbound tunnel to local approve/run)
- Local auto-run policy (v0.6) remains the execution authority
- Operator token stays local only

Contract: `docs/bridge/coordinator-contract.md`

### Local stub (test before cloud deploy)

Filesystem queue under `data/coordinator-stub/`:

| Folder | Purpose |
|--------|---------|
| `inbox/` | Pending station jobs (simulates coordinator queue) |
| `claimed/` | Jobs claimed by Station1 worker |
| `completed/` | Finished with result + `local_job_id` |
| `failed/` | Validation/policy/execution failures |

JSON job files are gitignored; `.gitkeep` files remain tracked.

### Scripts

Create a test packet in the stub inbox (no Cursor):

```bash
node scripts/create-coordinator-stub-job.js
node scripts/create-coordinator-stub-job.js --preview
```

Station1 polling worker (stub mode — reads inbox, calls local API with action-safe token only):

```bash
node scripts/server.js
node scripts/station-poll-worker.js --once
node scripts/station-poll-worker.js --once --job-id <station-job-uuid>
```

Coordinator stub smoke test:

```bash
node scripts/coordinator-stub-smoke-test.js
node scripts/coordinator-stub-smoke-test.js --run
```

Dry run validates stub folders, auth token, and auto-run policy. `--run` processes the stub job it just created via `--job-id` (older pending inbox jobs are left untouched).

The stub inbox may contain old pending jobs from earlier tests. `coordinator-stub-smoke-test.js --run` always targets its own newly created job id. Manual worker runs without `--job-id` still claim the oldest pending job for the station.

### v0.7 not included yet

- Cloud coordinator deploy
- Tunnel / public local API exposure
- GPT Action wiring to coordinator URL
- High-risk jobs without operator approval

## Job shape

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `workspace` | Workspace id |
| `workspace_path` | Absolute path on disk |
| `worker` | Worker id |
| `prompt` | Task description |
| `status` | `queued`, `needs_approval`, `approved`, `auto_running`, `running`, `completed`, or `failed` |
| `created_at` | ISO timestamp |
| `updated_at` | ISO timestamp |
| `result` | `null` until finished; cursor jobs include stdout/stderr/git capture |
| `requested_by` | API only — who requested the job |
| `mode` | API only — e.g. `read_only` |
| `station` | API only — target station for policy (e.g. `station1`) |
| `task_type` | API only — e.g. `inspect_only` |
| `risk_level` | API only — e.g. `low` |
| `auto_run_requested` | API only — request local policy auto-run evaluation |
| `policy_result` | API only — policy decision when `auto_run_requested` is true |
| `approval` | API only — approval gate metadata |

## Scope

- Plain Node.js, no TypeScript, no external npm packages
- No Supabase or GPT Actions integration in this repo yet
- Does not modify TimFinance or nova-reading
- Never auto-commits, pushes, or deploys
