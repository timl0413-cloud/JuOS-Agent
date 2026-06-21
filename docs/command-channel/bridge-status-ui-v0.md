# Bridge Status Interface v0

Read-only command-channel and worker bridge visibility for Travel Mode. Tim can see stranded, running, completed, and failed jobs without CLI.

## Control Tower (start here for motion)

**When Tim asks “what is happening now?”** use the Control Tower — not the full bucket tables.

| Question | Control Tower answer |
|----------|---------------------|
| Is anything running? | `motion_state`, `active_job_count`, **Running now** table |
| Is XiaoJu waiting on me? | `waiting_on: Tim`, `pending_approval_count` > 0 |
| Is a worker running? | `motion_state: running`, `active_job_count` ≥ 1 |
| Who acts next? | `next_action_owner`, `next_action_text` |
| Can another room start? | **Cross-room launch readiness** table + `lane_readiness_summary` |

Full Control Tower doc: [`control-tower-motion-v0.md`](./control-tower-motion-v0.md)

Cross-room handoff template: [`templates/command-channel/cross-room-readiness-packet.md`](../../templates/command-channel/cross-room-readiness-packet.md)

## Short names (recommended)

Remember three aliases — full detail in [`short-status-routes-v0.md`](./short-status-routes-v0.md):

| Alias | Purpose |
|-------|---------|
| `/tower` | Control Tower motion — running, next owner, lane readiness |
| `/watch` | Assistant Watcher — needs attention watchlist |
| `/status` | General Bridge Status — full bucket tables |

After `npm run server:command-channel`:

```powershell
start http://127.0.0.1:8790/status/preview
start http://127.0.0.1:8790/watch/preview
start http://127.0.0.1:8790/tower/preview
```

## Surfaces

| Surface | Data | How to open |
|---------|------|-------------|
| Static mock (legacy) | Sample | `docs/command-channel/bridge-status-ui-v0.html` |
| **Short preview** | Sample | `http://127.0.0.1:8790/status/preview` (also `/watch/preview`, `/tower/preview`) |
| API preview route (legacy path) | Sample | `http://127.0.0.1:8790/joa/bridge-status/preview` |
| **Short live route** | **Live** | `GET /status` with Bearer `remote-jobs:list` |
| API live route (legacy path) | **Live** | `GET /joa/bridge-status` with Bearer `remote-jobs:list` |
| **Short live JSON** | **Live** | `GET /status/summary` with Bearer `remote-jobs:list` (includes `control_tower` block) |
| API live JSON (legacy path) | **Live** | `GET /joa/bridge-status/summary` with Bearer `remote-jobs:list` |

CLI shortcuts: `npm run status:bridge`, `npm run status:watch`, `npm run status:tower`, `npm run status:command-channel:control-tower`.

External MacBook/phone path: see [`bridge-status-external-v0.md`](./bridge-status-external-v0.md).

## View the static mock (local file)

Open in a browser:

```
C:\projects\TimOS-Agent\docs\command-channel\bridge-status-ui-v0.html
```

Or from repo root:

```powershell
start docs\command-channel\bridge-status-ui-v0.html
```

## View via command-channel server

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/joa/bridge-status/preview
```

Live data (authenticated):

```powershell
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8790/joa/bridge-status -o bridge-status-live.html
```

## Sections

| Section | Purpose |
|---------|---------|
| Bridge summary | Counts: stranded, running, completed-needs-notification, failed/blocked |
| Stranded jobs | Approved + pending + unclaimed — includes recovery command |
| Running jobs | Claimed workers — do not assume completion |
| Completed needs notification | Finished jobs where room post is still required |
| Failed or blocked | Errors and next owner |
| Operating rules | approved ≠ running; pending ≠ handled; completed ≠ notified |
| Travel Mode readiness | Mobile-readable layout note; Station 4/5 workers later |

## Status mapping (from no-stranded-job v0)

| UI bucket | Status layer category | Detection |
|-----------|----------------------|-----------|
| Stranded | `pending_unclaimed` | `status=pending`, approved, `claimed_at` null |
| Running | `claimed_running` | `status=claimed` |
| Completed needs notification | `completed` | `status=completed` — verify room notified |
| Failed or blocked | `failed_or_blocked` | `failed`, `cancelled`, or blocked state |

See [`no-stranded-job-v0.md`](./no-stranded-job-v0.md) for CLI and recovery details.

## Sample data notes

The static HTML file uses illustrative jobs. The `/joa/bridge-status/preview` route serves the same sample shape via HTTP.

Live routes read from the command-channel store (filesystem local or Supabase when deployed). Refresh the live page to update; no client-side token or fetch.

## Intended lifecycle (v0)

```text
pending → (Tim approves) → worker claims → claimed/running → completed|failed
                                                                    ↓
                                              result visible here + status CLI (no terminal paste)
```

| Stage | Bridge bucket | Tim action | Assistant / room action |
|-------|---------------|------------|-------------------------|
| Approved, not claimed | Stranded | Start JOA worker loop on Station 1 | `--recovery` or wait for claim |
| Running | Running | None | Wait; do not assume completion |
| Done | Completed needs notification | Optional: say job id only | Read `result.summary`; post to room |
| Blocked | Failed or blocked | Review with Tim | Read `errors`; no auto-retry |

Worker loop (Station 1): [`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md).

## Result visibility without terminal paste

Completed and failed jobs expose structured fields on the job record:

- **CLI:** `node scripts/command-channel-status.js --http --job-id <uuid> --packet`
- **JSON:** `node scripts/command-channel-status.js --http --job-id <uuid> --json` → `result`, `errors`
- **Live HTML:** stranded/running/completed rows on `/joa/bridge-status` (Bearer list token)
- **Live JSON:** `/joa/bridge-status/summary`

Tim should not paste worker terminal output when `result.summary` or `errors` are present. Paste is fallback only when status is still `claimed` with no result or command-channel is unreachable.

## Remaining gaps

| Gap | v0 mitigation |
|-----|----------------|
| Worker not auto-started by approval | `scripts/start-joa-worker-loop.ps1` on Station 1 |
| Completed ≠ room notified | Manual room post; UI flags "needs notification" |
| Phone / Travel Mode browser | Local bind only; JuOS deploy pending |
| Per-job recovery when loop down | `npm run status:command-channel:recovery` |
| Finalize path mismatches | [`finalize-exact-path-sop.md`](./finalize-exact-path-sop.md) |

## Intentionally not implemented

- Browser session auth (JuOS deploy — see external v0 doc)
- Server-side auto-dispatch from `auto_run_requested` (workers poll locally)
- Notification ledger (cannot detect if room already notified)
- Auth/token changes or public live job data
- Station 4/5 always-on workers

## Recommended next step (external Travel Mode)

1. Deploy `/joa/bridge-status` to JuOS with session auth — see [`bridge-status-external-v0.md`](./bridge-status-external-v0.md).
2. Optional: meta-refresh or polling on the JuOS-hosted page.
3. Optional: notification ledger to hide completed rows after room post.
4. Parallel: keep `start-joa-worker-loop.ps1` running on Station 1 until hosted worker exists.

## Related

- **Control Tower:** [`control-tower-motion-v0.md`](./control-tower-motion-v0.md) — motion, next owner, lane readiness
- **Short routes:** [`short-status-routes-v0.md`](./short-status-routes-v0.md) — `/tower`, `/watch`, `/status`
- No-paste SOP: [`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md)
- Finalize paths: [`finalize-exact-path-sop.md`](./finalize-exact-path-sop.md)
- Status CLI: `scripts/command-channel-status.js`
- Room packet template: [`templates/command-channel/status-packet.md`](../../templates/command-channel/status-packet.md)
- Room / lane registry: [`room-lane-identity-v0.md`](./room-lane-identity-v0.md) — `source_room`, `active_lane`
- Bridge overview: [`docs/bridge/xiaoju-command-channel.md`](../bridge/xiaoju-command-channel.md)
