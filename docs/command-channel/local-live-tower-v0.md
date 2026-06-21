# Local Live /tower v0

Tim's primary **real** Control Tower view on Station 1 / Station 4 / 5 — without confusing sample preview data with live system state.

## One URL to remember

| URL | Data | When to use |
|-----|------|-------------|
| **`http://127.0.0.1:8790/tower`** | **LIVE DATA** | Real motion, running jobs, next owner |
| `http://127.0.0.1:8790/tower/preview` | **SAMPLE DATA ONLY** | Layout / UX testing — fake jobs |

Same pattern for `/watch` and `/status`.

## How to tell live vs sample

Every page shows a badge at the top:

| Badge | Meaning |
|-------|---------|
| **LIVE DATA · local browser (127.0.0.1)** | Real command-channel store — opened in browser on loopback |
| **LIVE DATA · authenticated read-only** | Real data — Bearer token or curl |
| **SAMPLE DATA ONLY · not real system state** | Preview route — do not use for decisions |

The meta line also shows `Mode: live` or `Mode: sample`.

## Start local live tower (recommended)

From a **token-loaded supervisor shell** (auth already in that session — do not paste tokens into the browser):

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower
```

Server must bind loopback (`COMMAND_CHANNEL_HOST=127.0.0.1`, default). Auth must be configured in the server process (`config/auth.json` or env). No Bearer header is needed in the browser on 127.0.0.1.

### CLI alternative (no server)

```powershell
npm run status:tower
```

Reads the local job store directly. Same live data, text output.

## Local live bridge (how it works)

When **all** of these are true, `/tower`, `/watch`, and `/status` serve live HTML/JSON without a browser Bearer header:

1. Server binds to `127.0.0.1` (or `localhost`)
2. Request comes from loopback (`127.0.0.1` / `::1`)
3. Command-channel auth is configured in the server process
4. No `Authorization: Bearer` header was sent (normal browser visit)

The server uses its in-process auth configuration as proof the supervisor shell is trusted. **Token values are never sent to the browser**, logged, or embedded in HTML/JSON.

If auth is missing, the browser gets a setup landing page (not sample data) with links to preview and CLI commands.

## Troubleshooting: raw `{ "error": "auth_not_configured" }`

If you see raw JSON instead of the setup page:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{ "error": "auth_not_configured" }` in browser | Server started without auth in this process | Restart from token-loaded supervisor shell (below) |
| Same JSON from `curl` with `Accept: application/json` | Expected — explicit JSON/API request | Use browser, or add Bearer token for API access |
| Setup page shows but live still fails after restart | Auth still not visible to Node in that shell | Confirm `config/auth.json` exists or env vars are set **before** `npm run server:command-channel` |

### Correct restart (Station 1 / 4 / 5)

From a **token-loaded supervisor shell** (auth already in that session — do not paste tokens into chat):

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower
```

On startup the server logs whether the local live bridge is available:

- `Local live bridge: available (auth loaded in this process)` — open `http://127.0.0.1:8790/tower` for **LIVE DATA**
- `Local live bridge: unavailable — auth not configured in this process` — browser shows setup page at the same URL until restart

Token values are never printed in logs, HTML, or JSON errors.

### What you should see

| State | Browser at `/tower` | Badge |
|-------|---------------------|-------|
| Auth missing | Setup page: "This is not live yet" | Not live — setup required |
| Auth loaded | Control Tower with real job data | **LIVE DATA · local browser (127.0.0.1)** |
| Preview route | Fake sample jobs | **SAMPLE DATA ONLY** |

## Preview routes stay sample-only

```powershell
start http://127.0.0.1:8790/tower/preview
```

Always **SAMPLE DATA ONLY**. Never upgraded to live, even when auth is loaded.

## External / hosted behavior (unchanged)

| Condition | Behavior |
|-----------|----------|
| Server not on loopback | Bearer token required — no local bridge |
| Non-loopback client | Bearer token required |
| Legacy `/joa/bridge-status` | Bearer token required (unchanged) |
| Job mutation routes | Bearer token required (unchanged) |

No auth settings or protected values were changed in this v0.

## Related aliases

| Live | Sample preview |
|------|----------------|
| `/tower` | `/tower/preview` |
| `/watch` | `/watch/preview` |
| `/status` | `/status/preview` |

See also:

- [`short-status-routes-v0.md`](./short-status-routes-v0.md) — full route map
- [`control-tower-motion-v0.md`](./control-tower-motion-v0.md) — motion fields and states
- [`bridge-status-external-v0.md`](./bridge-status-external-v0.md) — phone / JuOS path (future)

## Remaining before phone / external access

| Blocker | v0 mitigation |
|---------|----------------|
| Server binds `127.0.0.1` only | Local live bridge for browser on Station 1 |
| Phone cannot reach loopback | Deploy to JuOS with session auth |
| No push / SMS / background wake-up | Open `/tower` or run `npm run status:tower` manually |
| Short aliases not on JuOS yet | Deploy same route map when hosting command-channel |
