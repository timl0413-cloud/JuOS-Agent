# Bridge Status — External Reachability v0

Design path for serving JOA Bridge Status to MacBook/phone (Travel Mode) without local file browsing or CLI.

## What exists now (this repo)

| Surface | Data | Auth | Reachable from phone? |
|---------|------|------|------------------------|
| `docs/command-channel/bridge-status-ui-v0.html` | Sample/static | None | No — local file only |
| `GET /joa/bridge-status/preview` | Sample/static | None | No — binds `127.0.0.1:8790` by default |
| `GET /joa/bridge-status` | **Live** from command-channel store | Bearer `remote-jobs:list` | No — local bind + Bearer header |
| `GET /joa/bridge-status/summary` | **Live** JSON view-model | Bearer `remote-jobs:list` | No — same as above |
| `node scripts/command-channel-status.js --json` | Live | Token in env / `config/auth.json` | No — CLI only |

Server routes are implemented in `scripts/server-command-channel.js` and rendered by `lib/command-channel-bridge-status-page.js` using `lib/command-channel-status.js` classifiers.

**No auth, schema, or worker behavior changes were made.**

## View locally today

```powershell
# 1. Start command-channel API (from repo root)
npm run server:command-channel

# 2a. Preview — sample data, no token (browser OK on Station 1)
start http://127.0.0.1:8790/joa/bridge-status/preview

# 2b. Live HTML — requires XiaoJu list token (curl; not a casual browser bookmark)
curl -H "Authorization: Bearer <XIAOJU_ACTION_TOKEN>" http://127.0.0.1:8790/joa/bridge-status -o bridge-status-live.html
start bridge-status-live.html

# 2c. Live JSON for automation
curl -H "Authorization: Bearer <XIAOJU_ACTION_TOKEN>" http://127.0.0.1:8790/joa/bridge-status/summary
```

Optional filters: `?profile=joa`, `?status=pending`.

## Gap: external / Travel Mode

TimOS-Agent command-channel server defaults to `COMMAND_CHANNEL_HOST=127.0.0.1`. JuOS production API at `https://juos.vercel.app/api/command-channel` exposes JSON job endpoints only — **no HTML status route yet**.

Making the page reachable from MacBook/phone requires **platform work outside this task scope**:

1. **JuOS/Vercel route** — add `/joa/bridge-status` to the deployed JuOS app (or a thin Next.js/API route) that:
   - Authenticates Tim via existing JuOS session/cookie (not raw Bearer in browser JS)
   - Server-side calls Supabase job list (service role stays server-side)
   - Renders the same HTML via `command-channel-bridge-status-page.js` (shared module or copy)

2. **HTTPS + public host** — Vercel deployment already provides this for `juos.vercel.app`; no tunnel-as-baseline.

3. **Session auth layer** — browser cannot safely hold `XIAOJU_ACTION_TOKEN`. JuOS dashboard session → server-side token lookup is the correct pattern.

## Recommended deployment sequence (before 7/4)

### Phase A — JuOS read-only page (preferred)

```
Tim phone/Mac browser
    → https://juos.vercel.app/joa/bridge-status
    → JuOS session middleware (existing auth)
    → server-side listJobs (Supabase, service role internal)
    → renderBridgeStatusHtml(buildViewModel(...))
```

**Changes needed (JuOS repo, not TimOS-Agent):**

- One new page/route handler (read-only GET)
- Import or vendor `lib/command-channel-bridge-status-page.js` + `lib/command-channel-status.js`
- Wire to existing Supabase list — same data as `GET /remote-jobs`
- No new DB schema; no worker changes

### Phase B — Optional enhancements (post-v0)

- Auto-refresh every 60s (server-rendered meta refresh or small same-origin fetch)
- Notification ledger field to distinguish completed vs room-notified
- Station 4/5 worker status sections
- Push alert when `stranded_count > 0`

### Phase C — Not recommended

- Exposing `XIAOJU_ACTION_TOKEN` in URL or client JS
- Public unauthenticated live job list
- ngrok/tunnel as production baseline

## Security checklist

| Risk | Mitigation |
|------|------------|
| Token in browser | Server-side session only; never embed Bearer in HTML/JS |
| Public job leakage | Live routes require auth; preview uses fake sample data only |
| Write/claim from UI | Read-only routes only; no POST/claim on status page |
| Service role exposure | Supabase key stays on JuOS server, not client |

## Acceptance mapping

| Criterion | Status |
|-----------|--------|
| No-code page concept for external viewing | Preview route + design path to JuOS |
| Static vs live clearly labeled | Badge + `data_mode` in JSON |
| No local file as final model | HTTP routes; JuOS deploy is next step |
| No auth/schema/worker changes | Satisfied in TimOS-Agent scope |
| Read-only if route added | GET only; list scope reused |

## Files to port to JuOS (Phase A)

- `lib/command-channel-status.js`
- `lib/command-channel-bridge-status-page.js`
- Route wiring pattern from `scripts/server-command-channel.js` (`joa-bridge-status*` handlers)

## Related

- UI mock: [`bridge-status-ui-v0.md`](./bridge-status-ui-v0.md)
- Status CLI: [`no-stranded-job-v0.md`](./no-stranded-job-v0.md)
- Deploy baseline: [`../bridge/command-channel-deployment.md`](../bridge/command-channel-deployment.md)
