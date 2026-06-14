# TimOS-Agent Cloud Coordinator Contract (v0.7)

This document defines the public HTTP contract for a **cloud coordinator** that sits between XiaoJu/GPT Action (phone) and local Station1 workers. It is the preferred phone-reachable path: Station1 pulls work outbound; the local TimOS-Agent API stays on `127.0.0.1`.

## Architecture

```
Phone / ChatGPT (XiaoJu GPT Action)
        |
        |  HTTPS + action-safe bearer token
        v
Cloud coordinator (queue)
        ^
        |  HTTPS outbound poll + station worker token
        |
Station1 polling worker  --->  Local TimOS-Agent API (127.0.0.1:8787)
                               action-safe token only (jobs:read, jobs:create)
                               local auto-run policy decides execution
```

## Why not a raw tunnel?

- Exposes the full local API surface (including operator endpoints if misconfigured)
- Harder to enforce action-safe token boundaries at the network edge
- Station pull model keeps approve/run local and unreachable from the phone

## Token profiles

| Profile | Used by | Scopes | Must NOT receive |
|---------|---------|--------|------------------|
| `xiaoju-action-create-read` | GPT Action → coordinator | create/read station jobs | operator token, approve/run |
| `station1-worker` | Station1 → coordinator | claim next job, submit result | jobs:approve, jobs:run, operator token |

The coordinator never stores or forwards the `tim-local-operator` token.

## Station job object

```json
{
  "id": "uuid",
  "correlation_id": "uuid-or-string",
  "project_profile_id": "optional-workspace-alias",
  "workspace": "TimOS-Agent",
  "station": "station1",
  "worker": "cursor",
  "mode": "read_only",
  "task_type": "inspect_only",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Inspect this repository and summarize the current structure. Do not modify files.",
  "requested_by": "xiaoju",
  "status": "pending | claimed | completed | failed",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "result": null
}
```

Either `workspace` or `project_profile_id` must identify the target workspace. v0.7 local stub uses `workspace`.

## Endpoints

### POST /station-jobs

**Caller:** XiaoJu / GPT Action  
**Auth:** `xiaoju-action-create-read` bearer token

Creates a station job request queued for the named station.

**Request body**

| Field | Required | Notes |
|-------|----------|-------|
| `workspace` or `project_profile_id` | one required | Registered workspace id |
| `station` | yes | e.g. `station1` |
| `worker` | yes | e.g. `cursor` |
| `mode` | yes | e.g. `read_only` |
| `task_type` | yes | e.g. `inspect_only` |
| `risk_level` | yes | e.g. `low` |
| `auto_run_requested` | yes | Coordinator stores intent; Station1 local policy decides |
| `prompt` | yes | Task text |
| `requested_by` | no | e.g. `xiaoju` |
| `correlation_id` | no | Client trace id |

**Response `201`**

Returns the created station job with `status: pending`.

**Safety**

- Does not call local TimOS-Agent directly
- Does not expose operator token
- Does not execute Cursor

---

### GET /station-jobs/next?station=station1

**Caller:** Station1 polling worker  
**Auth:** `station1-worker` bearer token

Returns the oldest pending job for the station and marks it `claimed`.

**Response `200`**

```json
{
  "job": { "...station job..." }
}
```

**Response `204`**

No pending jobs.

---

### POST /station-jobs/:id/result

**Caller:** Station1 polling worker  
**Auth:** `station1-worker` bearer token

Submits execution result after Station1 finishes local processing.

**Request body**

| Field | Required | Notes |
|-------|----------|-------|
| `local_job_id` | yes | TimOS-Agent job uuid |
| `status` | yes | `completed` or `failed` |
| `stdout_preview` | no | Truncated stdout |
| `stdout_length` | no | Full stdout length |
| `error` | no | Error message if failed |
| `exit_code` | no | Cursor exit code |
| `policy_result` | no | Local policy decision |
| `correlation_id` | no | Echo from request |

**Response `200`**

Returns updated station job with final status.

---

### GET /station-jobs/:id

**Caller:** XiaoJu / GPT Action  
**Auth:** `xiaoju-action-create-read` bearer token

Reads station job status and result summary.

**Response `200`**

Returns full station job including `result` when finished.

**Response `404`**

Unknown id.

## Station1 worker responsibilities (local)

1. Poll coordinator (or local stub inbox in v0.7)
2. Validate action-safe / auto-run-eligible shape
3. Create local TimOS-Agent job via `POST /jobs` using **action-safe token only**
4. Poll `GET /jobs/:id` until terminal status
5. Submit result to coordinator via `POST /station-jobs/:id/result`
6. **Never** call `POST /jobs/:id/approve` or `POST /jobs/:id/run`

Local auto-run policy (v0.6) is the only authority for whether Cursor executes.

## Local stub (v0.7)

Before cloud deploy, TimOS-Agent includes a filesystem stub:

| Path | Purpose |
|------|---------|
| `data/coordinator-stub/inbox/` | Pending station jobs |
| `data/coordinator-stub/claimed/` | Jobs claimed by worker |
| `data/coordinator-stub/completed/` | Successful results |
| `data/coordinator-stub/failed/` | Failed/rejected jobs |

Scripts:

- `scripts/create-coordinator-stub-job.js` — enqueue test packet
- `scripts/station-poll-worker.js` — pull one job and bridge to local API
- `scripts/coordinator-stub-smoke-test.js` — dry-run or `--run` integration test

## Not in v0.7 scope

- Cloud coordinator deploy
- Tunnel / public exposure of local API
- GPT Action schema wiring to coordinator URL
- High-risk job execution without operator approval
