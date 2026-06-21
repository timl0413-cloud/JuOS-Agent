# Completion Notification / Assistant Watcher v0

Tim multitasks. He should **not** have to remember job IDs or say `done` for XiaoJu/JOA to know a worker job finished. This v0 adds a **read-only assistant watchlist** on top of the existing time-aware status sweep.

## What this is

| Property | v0 behavior |
|----------|-------------|
| Purpose | Surface completed jobs that still need assistant review and report-back |
| Trigger | Operator or assistant runs one status command — **not** a background timer |
| Delivery | CLI text / JSON only — **no SMS, email, hosted cron, or push** |
| ChatGPT wake-up | **Not supported** — ChatGPT cannot be awakened by background events |

Whenever XiaoJu or JOA checks status, completed jobs appear in **COMPLETED — needs assistant review** without Tim saying `done`.

## One command (recommended)

From `C:\projects\TimOS-Agent`:

```powershell
npm run status:command-channel:watch
```

Equivalent:

```powershell
node scripts/command-channel-status.js --http --watch --profile joa
```

JSON (for assistant automation):

```powershell
node scripts/command-channel-status.js --http --watch --profile joa --json
```

The `--watch` flag implies `--time-sweep`. Output is watchlist-first (compact). Full time-sweep detail buckets remain available with `--time-sweep` without `--watch`.

## Watchlist categories

Each job appears in **exactly one** watchlist bucket:

| Category | Meaning | Tim action |
|----------|---------|------------|
| `completed_needs_assistant_review` | Worker finished; assistant must read `result` and post summary to room | **None** — do not need to say `done` |
| `failed_needs_attention` | Failed, cancelled, or blocked | Review with assistant if needed |
| `pending_or_stranded` | Awaiting Tim approval, or approved but unclaimed (incl. stranded) | Approve, or ensure worker loop is running |
| `running_too_long` | Claimed past runtime threshold (default 60 min) | Optional check-in |
| `no_action_needed` | Claimed within threshold — on track | None |

Each completed row includes a **REVIEW** line:

```text
REVIEW: node scripts/command-channel-status.js --http --job-id <uuid> --json
```

Assistant reads `result.summary`, `result.files_seen`, and `errors`; posts to the requesting room. No terminal paste from Tim.

## Assistant SOP (each status check)

1. Run `npm run status:command-channel:watch` (or `--watch --json`).
2. Read `swept_at` / `now_iso` — that is **now** for this check.
3. If `needs_attention_count > 0`, work top-down:
   - **Completed** → fetch job JSON, report back to room
   - **Failed** → triage with Tim
   - **Pending/stranded** → approval or worker loop / recovery
   - **Running too long** → optional status ping
4. Do **not** assume ChatGPT will remind later — suggest Tim or hub re-run watch before leaving Station 1.

## What this eliminates for Tim

| Before | After v0 |
|--------|----------|
| Remember job UUID after multitasking | Watch command lists all completions needing review |
| Say `done` so assistant knows to look | Completed jobs flagged automatically on every watch run |
| Paste terminal output | Assistant uses `--job-id … --json` and `result.summary` |

Tim may still say `done` or paste a job id — both remain valid shortcuts — but they are **optional**.

## What this is not (v0 limits)

| Gap | v0 | Future |
|-----|-----|--------|
| Background notification | Manual/assistant-initiated watch only | Task Scheduler, hub heartbeat, hosted cron |
| ChatGPT auto wake-up | Impossible in v0 — assistant must run watch | External alert channel (SMS, push, JuOS dashboard badge) |
| "Already reviewed" dedupe | Every completed job flagged each run until room post + ledger | Notification ledger marks assistant-reviewed |
| External alert delivery | CLI output only | Room packets, Bridge Status push, phone visibility |

## Implementation

| Piece | Location |
|-------|----------|
| Watchlist mapping | `lib/command-channel-time-sweep.js` — `WATCHLIST_CATEGORIES`, `buildAssistantWatchlist()` |
| CLI `--watch` | `scripts/command-channel-status.js` |
| npm script | `status:command-channel:watch` in `package.json` |

Watchlist is derived from time-sweep classification; no schema, auth, or DB changes.

## Related

- Time-aware sweep (detail buckets + thresholds): [`time-aware-status-sweep-v0.md`](./time-aware-status-sweep-v0.md)
- No-paste worker loop: [`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md)
- Stranded recovery: [`no-stranded-job-v0.md`](./no-stranded-job-v0.md)
- Station 4/5 hub: [`station-45-worker-hub-v0.md`](./station-45-worker-hub-v0.md)
