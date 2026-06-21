# Short Bridge Status Routes v0

Tim asked for three memorable names instead of long Bridge Status URLs. Remember only:

| Alias | Answers |
|-------|---------|
| **`/tower`** | Control Tower / motion — what is running, who owns next, lane readiness |
| **`/watch`** | Assistant Watcher — completed-needs-review, failed, pending/stranded, running-too-long |
| **`/status`** | General Bridge Status — stranded, running, completed, failed buckets |

## Live vs sample (read this first)

| URL | Data |
|-----|------|
| **`http://127.0.0.1:8790/tower`** | **LIVE DATA** — real command-channel state |
| `http://127.0.0.1:8790/tower/preview` | **SAMPLE DATA ONLY** — fake jobs for layout testing |

Every page shows a top badge: **LIVE DATA** or **SAMPLE DATA ONLY**. See [`local-live-tower-v0.md`](./local-live-tower-v0.md).

## Local live browser (Station 1 / 4 / 5)

Start the server from a **token-loaded supervisor shell**, then open in browser — no Bearer header needed on loopback:

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower
```

Default bind: `http://127.0.0.1:8790`

## HTTP routes

| Route | Data | Auth |
|-------|------|------|
| `GET /status` | **Live** Bridge Status HTML | Local loopback browser **or** Bearer `remote-jobs:list` |
| `GET /status/preview` | **Sample** Bridge Status HTML | None |
| `GET /status/summary` | **Live** Bridge Status JSON | Local loopback **or** Bearer |
| `GET /watch` | **Live** Assistant Watcher HTML | Local loopback browser **or** Bearer |
| `GET /watch/preview` | **Sample** watchlist HTML | None |
| `GET /watch/summary` | **Live** watchlist JSON | Local loopback **or** Bearer |
| `GET /tower` | **Live** Control Tower motion HTML | Local loopback browser **or** Bearer |
| `GET /tower/preview` | **Sample** motion HTML | None |
| `GET /tower/summary` | **Live** motion JSON | Local loopback **or** Bearer |

Legacy long paths remain unchanged (`/joa/bridge-status`, etc.). Short aliases support **local live bridge** on `127.0.0.1` only. Legacy paths and non-loopback hosts still require Bearer.

### Sample preview (not live)

```powershell
start http://127.0.0.1:8790/tower/preview
start http://127.0.0.1:8790/watch/preview
start http://127.0.0.1:8790/status/preview
```

### Live via curl (Bearer)

```powershell
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8790/tower -o tower-live.html
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8790/watch -o watch-live.html
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8790/status -o status-live.html
start tower-live.html
```

Optional query filters (all three aliases): `?profile=joa`, `?status=claimed`, `?requested_by=xiaoju`

## CLI equivalents

When the server is not running, use npm scripts from repo root:

| Remember | Command | Shows |
|----------|---------|-------|
| `/status` | `npm run status:bridge` | Full Bridge Status text report (local store) |
| `/watch` | `npm run status:watch` | Assistant watchlist (local store, JOA profile) |
| `/tower` | `npm run status:tower` | Control Tower motion summary (local store, JOA profile) |

For hosted Supabase/JuOS data, add `--http` or use the existing `status:command-channel:*` scripts.

Examples:

```powershell
npm run status:tower
npm run status:watch
npm run status:bridge

node scripts/command-channel-status.js --http --tower --profile joa
node scripts/command-channel-status.js --local --watch --json
```

## What each alias shows

See [`control-tower-motion-v0.md`](./control-tower-motion-v0.md).

### `/tower` — Control Tower motion

Derived from command-channel job data + time sweep thresholds:

- **System motion** — `idle`, `running`, `needs_attention`, `blocked`, or `review_pending`
- **Who owns next** — Tim (awaiting approval), worker loop (stranded), or in-progress worker
- **Running now** — claimed jobs with age
- **Room / lane readiness** — counts per worker profile

Does not auto-start workers or cross-room launch. Read-only v0.

### `/watch` — Assistant Watcher

Same watchlist buckets as `npm run status:command-channel:watch`:

- Completed · needs assistant review
- Failed · needs attention
- Pending / stranded
- Running too long (default ≥ 60 min after claim)
- No action needed

See [`completion-notification-v0.md`](./completion-notification-v0.md).

### `/status` — Bridge Status

Same HTML/JSON as `/joa/bridge-status`:

- Stranded, running, completed-needs-notification, failed/blocked tables
- Recovery commands on stranded rows

See [`bridge-status-ui-v0.md`](./bridge-status-ui-v0.md).

## Auth and safety

| Route type | Auth |
|------------|------|
| `*/preview` | None — **SAMPLE DATA ONLY** |
| Live short aliases on `127.0.0.1` | Local loopback browser bridge when auth loaded in server process, **or** Bearer `remote-jobs:list` |
| Live on non-loopback / legacy paths | Bearer `remote-jobs:list` (unchanged) |

Local live bridge never exposes token values in HTML, JSON, logs, or errors. No auth settings were changed in this v0.

## Remaining blockers before phone / external access

| Blocker | v0 mitigation |
|---------|----------------|
| Server binds `127.0.0.1` only | Open `/tower` in browser after `npm run server:command-channel` |
| Bearer header awkward on phone browser | Deploy to JuOS with session auth — see [`bridge-status-external-v0.md`](./bridge-status-external-v0.md) |
| Short aliases not on JuOS yet | Deploy same route map when hosting command-channel |
| No push / SMS / background wake-up | Run `/watch` or `npm run status:watch` when checking status |
| Notification ledger missing | Completed rows stay visible until room post |

## Related

- Bridge Status UI: [`bridge-status-ui-v0.md`](./bridge-status-ui-v0.md)
- External deploy: [`bridge-status-external-v0.md`](./bridge-status-external-v0.md)
- Completion watcher: [`completion-notification-v0.md`](./completion-notification-v0.md)
- Time sweep: [`time-aware-status-sweep-v0.md`](./time-aware-status-sweep-v0.md)
- Local live tower: [`local-live-tower-v0.md`](./local-live-tower-v0.md)
- Server: `scripts/server-command-channel.js`
- Renderers: `lib/command-channel-short-status-page.js`, `lib/command-channel-bridge-status-page.js`
