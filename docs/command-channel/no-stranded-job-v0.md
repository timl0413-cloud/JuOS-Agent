# No-Stranded-Job Status Layer v0

Minimal read-only visibility for command-channel jobs so approved work does not sit silently unclaimed and completed/failed work does not leave rooms waiting.

## Operating rules

| Assumption | Reality |
|------------|---------|
| approved | ≠ running |
| pending | ≠ handled |
| completed | ≠ notified |

Rooms (JUB, GSync, SpaceA, MinistryOps) must **not** assume execution until `claimed_at` or a terminal `result` proves it.

## Status categories

| Category | Detection |
|----------|-----------|
| `pending_unclaimed` | `status=pending`, `claimed_at` null, approval satisfied |
| `pending_awaiting_approval` | `status=pending`, `approval_required=true`, not approved |
| `claimed_running` | `status=claimed` |
| `completed` | `status=completed` — post room notification |
| `failed_or_blocked` | `status=failed` or `cancelled`, or other blocked state |

**Stranded job** = `pending_unclaimed` (approved but no worker claim yet).

## Commands

From `C:\projects\TimOS-Agent`:

```powershell
# Full status report (HTTP when COMMAND_CHANNEL_URL is set)
node scripts/command-channel-status.js

# Force local filesystem backend
node scripts/command-channel-status.js --local

# Force remote HTTP list (read-only, XiaoJu token)
node scripts/command-channel-status.js --http

# Filter by worker profile
node scripts/command-channel-status.js --profile joa

# JSON output for automation
node scripts/command-channel-status.js --json

# Room-facing packet for one job
node scripts/command-channel-status.js --job-id <uuid> --packet --target-room GSync
```

## Recovery for stranded jobs

When status shows **STRANDED — approved + pending + unclaimed**, claim explicitly by profile + job id:

```powershell
.\scripts\start-juos-worker.ps1 -Profile joa -JobId <job-uuid>
```

Node equivalent:

```powershell
node scripts/command-channel-worker.js --http --once --worker-profile joa --job-id <job-uuid> --cursor-agent
```

Do **not** rely on lane claim (`--allow-lane`) for approved supervised jobs unless the hub is confirmed running for that profile.

## Room-facing status packet

Template: [`templates/command-channel/status-packet.md`](../../templates/command-channel/status-packet.md)

Generate a filled packet:

```powershell
node scripts/command-channel-status.js --job-id <uuid> --packet --target-room JUB
```

Packet types map to status categories: `pending_unclaimed`, `claimed_running`, `completed`, `failed_or_blocked`.

## Auth and backend

- **HTTP mode** uses `GET /remote-jobs` with `XIAOJU_ACTION_TOKEN` or `config/auth.json` profile `xiaoju-command-channel`. Read-only list; no claim or result submit.
- **Local mode** uses `lib/command-channel-store` (`filesystem` or `supabase` via env). No new routes or schema.

## Limitations (v0)

- **No notification ledger** — completed jobs are flagged as "verify room notified" but the system cannot detect whether JUB/GSync already received the summary.
- **Approval fields in payload** — approval metadata may live in Supabase `payload`; the status layer merges top-level and payload fields.
- **No auto-recovery** — this layer reports and prints recovery commands only; it does not start workers.
- **List filters** — remote list supports `status` and `target_worker_profile` query params only (existing API). Full scan may require multiple calls or unfiltered list.
- **Awaiting approval** — jobs with `approval_required=true` and no approval stay out of the stranded bucket until Tim approves.

## Next step before 7/4 (always-on)

1. Add `command-channel-status.js` to a scheduled check (Task Scheduler or hub startup banner) every 5–15 minutes.
2. Run `scripts/start-worker-hubs.ps1` (or profile-specific hubs) persistently so approved jobs are claimed without manual recovery.
3. Optionally wire JOA to emit a GSync/JUB packet when `stranded_count > 0` (manual or scripted `--json` + packet template).
4. After worker completion, require a one-line room post with job id + summary (operating habit until notification tracking exists).

## Related

- Worker startup: `scripts/start-juos-worker.ps1`, `scripts/start-worker-hubs.ps1`
- Repo routing: `docs/command-channel-repo-routing.md`
- Bridge overview: `docs/bridge/xiaoju-command-channel.md`
