# Time-Aware Status Sweep v0

ChatGPT and room assistants have **no background timer**. Each status check must capture **now**, compare timestamps on jobs/tasks, and classify what needs attention immediately versus what is on track.

This v0 layer is **read-only and operator-facing**. It does not schedule cron jobs, send push notifications, or auto-start workers.

## Why this exists

| Problem | v0 mitigation |
|---------|----------------|
| Approved jobs sit unclaimed | Time sweep flags **stranded** after threshold |
| Claimed jobs hang silently | **Running too long** after claim threshold |
| Completed jobs never reach rooms | **Completed needs assistant review** (watchlist) |
| TimOS tasks slip past due dates | Documented TimOS compare logic (manual/query) |
| Station 1 goes offline | **Station 4/5 setup triggers** documented |

## Command-channel sweep (implemented)

Each run records `swept_at` (ISO timestamp = now) and classifies every listed job.

### Categories

**Assistant watchlist (top-level, one bucket per job):**

| Category | Meaning |
|----------|---------|
| `completed_needs_assistant_review` | `status=completed` — assistant must read result and report to room |
| `failed_needs_attention` | Failed, cancelled, or blocked |
| `pending_or_stranded` | Awaiting approval, or approved + unclaimed (incl. stranded) |
| `running_too_long` | Claimed past runtime threshold |
| `no_action_needed` | Claimed within threshold — on track |

**Time-sweep detail buckets (below watchlist in full sweep output):**

| Category | Meaning | Default trigger |
|----------|---------|-----------------|
| `trigger_now` | Union of all items needing operator attention now | yes |
| `stranded` | Approved + pending + unclaimed, age ≥ 5 min since approval | yes |
| `running_too_long` | Claimed, age ≥ 60 min since `claimed_at` | yes |
| `completed_needs_notification` | `status=completed` — room post still required | yes |
| `awaiting_approval` | Pending, not approved | yes |
| `failed` | Failed, cancelled, or blocked | yes |
| `on_track` | Claimed within runtime threshold | no |

Fresh approved-unclaimed jobs (< 5 min) appear as `trigger_now` (not yet `stranded`) so the operator knows claim should happen soon.

### Commands

From `C:\projects\TimOS-Agent`:

```powershell
# Completion watcher — watchlist-first (recommended for XiaoJu/JOA)
npm run status:command-channel:watch

# Or explicitly:
node scripts/command-channel-status.js --http --watch --profile joa

# Time-aware sweep (HTTP production board) — watchlist + detail buckets
node scripts/command-channel-status.js --http --time-sweep

# Filter JOA lane
node scripts/command-channel-status.js --http --time-sweep --profile joa

# JSON for assistant automation (includes time_sweep block)
node scripts/command-channel-status.js --http --time-sweep --json

# Combine with standard status report fields when using --json without --time-sweep
node scripts/command-channel-status.js --http --json --time-sweep
```

Implementation: `lib/command-channel-time-sweep.js`, wired via `--time-sweep` on `scripts/command-channel-status.js`.

### Thresholds (v0 defaults)

| Setting | Default | Reference timestamp |
|---------|---------|-------------------|
| Stranded | 5 minutes | `approved_at`, else `created_at` |
| Running too long | 60 minutes | `claimed_at` |

Thresholds are constants in `lib/command-channel-time-sweep.js` for v0. No env vars or schema changes.

## TimOS task sweep logic (documented, not wired to DB)

When TimOS task records are available (JuOS API, export, or local JSON), compare **now** against task fields:

| Field | Use |
|-------|-----|
| `date` / `scheduled_date` | When work should start |
| `target_completion` / `due_at` | When work should finish |
| `status` | `todo`, `in_progress`, `done`, etc. |
| `completed_at` | Actual finish time |

### Classification

| TimOS category | Rule |
|----------------|------|
| `trigger_now` | Scheduled start reached (`now >= date`) and not active/done |
| `delayed` | `now > target_completion` and not done |
| `on_track` | Active, or not yet due |
| `ahead` | Done before `target_completion` |
| `done` | Completed (no trigger) |

Helper: `classifyTimosTask()` in `lib/command-channel-time-sweep.js` (for scripts/tests; no TimOS DB query in v0).

## Station 4/5 setup triggers

Run through this checklist when **any** trigger applies. Goal: JOA worker loop (or full hubs) stays claimable when Station 1 sleeps or travels.

| Trigger | Action |
|---------|--------|
| Leaving Station 1 **> 2–3 hours** | Start `.\scripts\start-joa-worker-loop.ps1` if not already running; note window/host |
| **Before sleep** (Station 1) | Confirm loop window open; run time sweep; fix stranded count |
| **Before Travel Mode** | Same as sleep + record which machine hosts the loop |
| **Worker loop needs always-on host** | Plan Station 4/5 (or Mac mini) as persistent host; copy token-loaded supervisor setup |
| **Time sweep shows stranded > 0** | Start loop or per-job recovery before leaving |

Station 4/5 v0 is **documentation + manual setup** only. No remote deploy or auth changes in this sweep.

**Bootstrap playbook:** [`station-45-worker-hub-v0.md`](./station-45-worker-hub-v0.md) — prerequisites, tomorrow setup sequence, preflight script, smoke test, sleep SOP.

Preflight (no token values printed):

```powershell
cd C:\projects\TimOS-Agent
.\scripts\check-worker-hub-preflight.ps1 -RunStatusProbe
```

### Minimum Station 1 command (JOA loop)

```powershell
cd C:\projects\TimOS-Agent
.\scripts\start-joa-worker-loop.ps1
```

Requires `WORKER_TOKEN` (or worker profile in `config/auth.json`) in the supervisor shell.

## Assistant SOP (each status check)

1. Run watch or time sweep (`--watch`, `--time-sweep`, or `npm run status:command-channel:watch`).
2. Read `swept_at` — that is **now** for this check.
3. Check watchlist `needs_attention_count`; work **completed-needs-assistant-review** first (Tim need not say `done`).
4. If `trigger_now_count > 0`, list detail items and next action (recovery, notify room, Tim approval).
5. If leaving Station 1 soon, cross-check Station 4/5 triggers above.
6. Do **not** assume ChatGPT will remind later — suggest Tim run watch again or keep worker loop running.

See also: [`completion-notification-v0.md`](./completion-notification-v0.md).

## What remains before true automatic timed reminders

| Gap | v0 | Future |
|-----|-----|--------|
| No background scheduler | Manual/assistant-initiated sweep only | Task Scheduler, hub heartbeat, or hosted cron |
| No push notifications | CLI/watchlist output | Notification ledger + room packets |
| TimOS tasks not queried | Documented classify logic | JuOS task API integration |
| No "last notified" / reviewed tracking | Completed flagged every watch run | Dedupe with notification ledger |
| No ChatGPT background wake-up | Assistant runs watch when checking status | External alert (SMS, push, dashboard) |
| Thresholds fixed in code | Edit lib constants | Env/config profile |

## Related

- Completion watcher: [`completion-notification-v0.md`](./completion-notification-v0.md)
- Station 4/5 bootstrap: [`station-45-worker-hub-v0.md`](./station-45-worker-hub-v0.md)
- Worker loop: [`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md)
- Stranded detection: [`no-stranded-job-v0.md`](./no-stranded-job-v0.md)
- Status CLI: `scripts/command-channel-status.js`
- Time sweep lib: `lib/command-channel-time-sweep.js`
