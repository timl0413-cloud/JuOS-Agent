# Control Tower / Motion v0

Operator-facing **motion summary** for the XiaoJu command channel. Tim answers four questions in one place:

1. **What is happening now?** — motion state + current focus + running jobs
2. **Who owns the next action?** — Tim, worker loop, in-progress worker, or assistant
3. **What is next?** — next action text + job id when applicable
4. **What other rooms can start?** — cross-room launch readiness (static registry v0)

Read-only v0. Does **not** auto-start workers, auto-route jobs, or launch cross-room work.

## Where to look

Start the local command-channel server from a token-loaded supervisor shell:

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower
```

| Surface | Route / command | Data | Auth |
|---------|-----------------|------|------|
| **Control Tower HTML (recommended)** | `GET /tower` | **LIVE DATA** | Local loopback browser or Bearer |
| Preview (sample only) | `GET /tower/preview` | **SAMPLE DATA ONLY** | None |
| Control Tower JSON | `GET /tower/summary` | **LIVE DATA** | Local loopback or Bearer |
| Bridge Status JSON (includes compact block) | `GET /status/summary` | **LIVE DATA** | Local loopback or Bearer |
| CLI — local store | `npm run status:tower` | **LIVE DATA** | None (reads local job store) |
| CLI — hosted Supabase/JuOS | `npm run status:command-channel:control-tower` | **LIVE DATA** | Uses server env token |
| CLI JSON with `control_tower` | `node scripts/command-channel-status.js --local --tower --json` | **LIVE DATA** | None |

See [`local-live-tower-v0.md`](./local-live-tower-v0.md) for live vs sample badges and local live bridge rules.

Preview in browser (sample only — not real state):

```powershell
start http://127.0.0.1:8790/tower/preview
```

Live HTML in browser (real state, no Bearer header on 127.0.0.1):

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower
```

## Motion states

Derived from command-channel job buckets + time-sweep watchlist (existing data only):

| `motion_state` | Meaning | Typical `waiting_on` |
|----------------|---------|----------------------|
| `idle` | No active work; nothing queued that needs action | `none` |
| `running` | At least one job is `claimed` / in progress | worker profile or `claimed_by` |
| `needs_attention` | Stranded (approved, unclaimed) and/or awaiting Tim approval | `Tim` or `{profile} worker loop` |
| `blocked` | Failed or cancelled jobs need review | `Tim + JOA` |
| `review_pending` | Completed jobs need assistant review / room post | `assistant / Tim` |

### How Tim knows XiaoJu is waiting vs a worker is running

| Signal | XiaoJu / coordinator waiting | Worker running |
|--------|------------------------------|----------------|
| `motion_state` | `needs_attention` or `idle` with pending approval | `running` |
| `waiting_on` | `Tim` (approval) or `worker loop` (stranded approved job) | `joa`, `nova`, etc. or `claimed_by` value |
| `active_job_count` | `0` | `≥ 1` |
| **Running now** table | empty | rows with job id, profile, claimed time |
| `next_action_owner` | `Tim` or `{profile} loop` | worker profile / `claimed_by` |

**Rule:** `approved ≠ running`. If `active_job_count` is 0 but `pending_or_stranded_count` > 0, XiaoJu has approved work but no worker has claimed it yet — start the worker loop on Station 1.

## Compact Control Tower block

Included in `/tower/summary`, `/status/summary`, and `--tower --json` CLI output:

| Field | Description |
|-------|-------------|
| `now` | ISO timestamp when the summary was generated |
| `swept_at` | ISO timestamp of the time-aware sweep |
| `motion_state` | `idle`, `running`, `needs_attention`, `blocked`, `review_pending` |
| `active_job_count` | Claimed / running jobs |
| `pending_approval_count` | Jobs waiting for Tim approval |
| `pending_or_stranded_count` | Time-sweep watchlist: pending / stranded |
| `completed_needs_review_count` | Completed jobs needing assistant review |
| `failed_count` | Failed or blocked jobs |
| `current_focus` | Human-readable headline of what matters now |
| `waiting_on` | Who the system is blocked on |
| `next_action_owner` | Who should act next |
| `next_action_text` | What they should do |
| `lane_readiness_summary` | One-line cross-room launch readiness |

Example JSON fragment (`GET /status/summary`):

```json
{
  "stranded_count": 0,
  "running_count": 1,
  "control_tower": {
    "now": "2026-06-21T08:00:00.000Z",
    "swept_at": "2026-06-21T08:00:00.000Z",
    "motion_state": "running",
    "active_job_count": 1,
    "pending_approval_count": 0,
    "pending_or_stranded_count": 0,
    "completed_needs_review_count": 0,
    "failed_count": 0,
    "current_focus": "Bridge Status UI mock — supervised_implement in progress",
    "waiting_on": "joa",
    "next_action_owner": "joa",
    "next_action_text": "Finish in-progress job",
    "lane_readiness_summary": "JOA:ready profile=joa; Station 4 / 5:bootstrap_pending profile=joa; ..."
  }
}
```

## Cross-room launch readiness

The Control Tower HTML page includes a **Cross-room launch readiness** table (static v0 registry aligned with [`room-lane-identity-v0.md`](./room-lane-identity-v0.md)):

| Room | v0 status | Can other rooms start dev work? |
|------|-----------|----------------------------------|
| **JOA** | `active` | Yes — primary TimOS-Agent lane on Station 1 |
| **Station 4 / 5** | `bootstrap_pending` | No — worker hub panels not always-on yet |
| **NovaBridge (NB)** | `pending` | No — lane setup + Room Identity Card required |
| **JUB** | `pending` | No — GSync publish/consume only until lane opened |
| **GSync** | `active` | Yes — registry; `jucore` when JuCore hub runs |
| **SpaceA / MinistryOps / Finance** | `active` | Yes — per-job `repo_ref` + `workspace_ref` required |

For a handoff packet when a room asks “can we start?”, use [`templates/command-channel/cross-room-readiness-packet.md`](../../templates/command-channel/cross-room-readiness-packet.md).

**This v0 does not auto-launch other rooms.** Readiness is informational only.

## Related surfaces

| Alias | Purpose |
|-------|---------|
| `/tower` | Control Tower — motion, next owner, readiness (this doc) |
| `/watch` | Assistant Watcher — completed-needs-review, failed, stranded, running-too-long |
| `/status` | Full Bridge Status — bucket tables + recovery commands |

See also:

- [`short-status-routes-v0.md`](./short-status-routes-v0.md) — route map and CLI equivalents
- [`bridge-status-ui-v0.md`](./bridge-status-ui-v0.md) — Bridge Status overview
- [`time-aware-status-sweep-v0.md`](./time-aware-status-sweep-v0.md) — sweep thresholds
- [`completion-notification-v0.md`](./completion-notification-v0.md) — assistant watcher buckets

## Remaining blockers before phone / external visibility

| Blocker | v0 mitigation |
|---------|----------------|
| Server binds `127.0.0.1:8790` only | Open `/tower` in browser — local live bridge on loopback |
| Bearer token awkward in phone browser | Deploy to JuOS with session auth — [`bridge-status-external-v0.md`](./bridge-status-external-v0.md) |
| `/tower` not on JuOS yet | Deploy same route map when hosting command-channel |
| No push / SMS / background wake-up | Check `/tower` or `npm run status:tower` manually |
| Cross-room launch is doc-only | Fill cross-room readiness packet; no auto-routing |

## Intentionally not in v0

- Auth or schema changes
- Automatic cross-room job launch
- SMS, email, or hosted cron alerts
- Station 4/5 always-on worker panels
- Notification ledger (completed rows stay visible until room post)
