# Station 4/5 Always-On Worker Hub Bootstrap v0

Move the JOA command-channel worker loop from **Station 1** (heavy graphics/3D workstation) to **Station 4 or 5** (lightweight always-on host). This v0 is **documentation + local preflight only** — no auth changes, no schema changes, no remote deploy.

## Purpose and scope

| In scope | Out of scope |
|----------|--------------|
| JOA lane persistent polling (`worker_profile=joa`) | Full six-profile hub (`start-worker-hubs.ps1`) unless Tim explicitly needs other lanes |
| Read-only status / time sweep verification | Editing `config/workspaces.json`, auth files, or token values |
| Manual operator setup tomorrow on Station 4/5 | Auto-routing, notification ledger, hosted cron |
| Preflight checks without printing secrets | Leaving Station 1 on overnight as permanent worker host |

**Hardware role:** Station 4/5 = lightweight always-on worker host. **Not** Station 1. Station 1 stays available for Cursor-heavy work; it should sleep when Tim is away once Station 4/5 passes preflight.

## Prerequisites checklist

Complete on **Station 4/5** before starting the worker loop.

| # | Check | Pass criteria |
|---|-------|---------------|
| 1 | **Node.js** | `node -v` succeeds (same major version family as Station 1) |
| 2 | **Repo checkout** | `C:\projects\TimOS-Agent` exists and is a git repo |
| 3 | **Git sanity** | `git status --short` — note dirty paths; do not commit from bootstrap unless intentional |
| 4 | **Token loading** | Same approved method as Station 1: **token-loaded supervisor shell** with `WORKER_TOKEN` **or** `config/auth.json` profile `cloud-readonly-worker`; for status reads also `XIAOJU_ACTION_TOKEN` **or** profile `xiaoju-command-channel` |
| 5 | **Optional env files** | If Station 1 uses them, copy **without editing values**: `config/command-channel-worker.env`, `.env.command-channel-worker`, `.env.juos.prod.local` (gitignored — copy securely, never paste into chat) |
| 6 | **Network** | Outbound HTTPS to `https://juos.vercel.app/api/command-channel` (default `COMMAND_CHANNEL_URL`) |
| 7 | **Cursor CLI** | `agent` / Cursor CLI available if jobs use `--cursor-agent` (default for JOA loop) |
| 8 | **Workspace path** | JOA default workspace: `C:\projects\TimOS-Agent` |

Run automated preflight (safe — no token values printed):

```powershell
cd C:\projects\TimOS-Agent
.\scripts\check-worker-hub-preflight.ps1
```

With live HTTP status probe:

```powershell
.\scripts\check-worker-hub-preflight.ps1 -RunStatusProbe
```

## Tomorrow setup sequence (Station 4/5)

Execute in order from a **token-loaded supervisor shell**.

### 1. Sync repo

```powershell
cd C:\projects\TimOS-Agent
git fetch origin
git status --short
```

Use the branch Tim expects (e.g. `main` or active feature branch). Do **not** assume `config/workspaces.json` matches Station 1 — bootstrap does not modify it.

### 2. Preflight

```powershell
.\scripts\check-worker-hub-preflight.ps1 -RunStatusProbe
```

All checks must pass before step 4. Fix token or network issues using the **same method Station 1 uses** (supervisor shell / copied env files / `config/auth.json`).

### 3. Command-channel status (read-only)

```powershell
node scripts/command-channel-status.js --http --time-sweep --profile joa
```

Confirm:

- `swept_at` is recent (captures **now**)
- `stranded` count is understood (0 is ideal before handoff)
- No unexpected `running_too_long` jobs

JSON variant for assistants:

```powershell
node scripts/command-channel-status.js --http --time-sweep --profile joa --json
```

### 4. Start JOA worker loop

```powershell
.\scripts\start-joa-worker-loop.ps1
```

Expected banner:

```text
Persistent polling hub active worker_profile=joa ...
Press Ctrl+C to stop.
```

Equivalent:

```powershell
.\scripts\start-juos-worker.ps1 -Profile joa -Loop
# or
npm run worker:joa:loop
```

Leave **this window open** on Station 4/5. Requires `WORKER_TOKEN` (or `cloud-readonly-worker` in `config/auth.json`).

### 5. Smoke test (approved low-risk job)

Use an approved job Tim already trusts — **low risk**, docs-only or read-only, `target_worker_profile=joa`, `auto_run_requested=true` after approval.

**Process:**

1. With loop running on Station 4/5, approve one small pending job (or create + approve via XiaoJu).
2. Within one poll interval (~5s, `COMMAND_CHANNEL_POLL_INTERVAL_MS`), run:

```powershell
node scripts/command-channel-status.js --http --time-sweep --profile joa
```

3. Confirm the job moves: `pending` → `claimed` → `completed` (or `failed` with `errors` populated).
4. Assistant lookup (no terminal paste):

```powershell
node scripts/command-channel-status.js --http --job-id <uuid> --json
```

**Do not** use production finalize or multi-repo jobs for first smoke test. Prefer `supervised_implement` / docs-only scope matching this bootstrap pattern.

### 6. Record host

Note which machine hosts the loop (e.g. "Station 4, window title JOA worker loop"). Assistants use this when cross-checking [Time-Aware Status Sweep v0](./time-aware-status-sweep-v0.md) triggers.

## Stop / start SOP

### Stop (Station 4/5)

1. Focus the worker loop PowerShell window.
2. Press **Ctrl+C**.
3. Confirm process exited (no lingering `node ... command-channel-worker.js` for JOA).

### Start (Station 4/5)

1. Open token-loaded supervisor shell.
2. `cd C:\projects\TimOS-Agent`
3. Optional: `.\scripts\check-worker-hub-preflight.ps1 -RunStatusProbe`
4. `.\scripts\start-joa-worker-loop.ps1`

### Stop (Station 1) after handoff

1. Confirm Station 4/5 loop is running and smoke test passed.
2. Ctrl+C on Station 1 loop window **only after** Station 4/5 is claimable.
3. Run time sweep from either machine to confirm no new stranded jobs:

```powershell
node scripts/command-channel-status.js --http --time-sweep --profile joa
```

## Sleep / night SOP

| Step | Station 1 | Station 4/5 |
|------|-----------|-------------|
| Before sleep | **Off** (or loop stopped) — not the always-on host | **On** only after preflight + smoke test pass |
| Worker loop | Stopped after handoff | Running in dedicated window |
| Status check | Optional morning verify from phone/assistant | Time sweep if stranded suspected |

**Rule:** Do not leave Station 1 on overnight **for worker duty**. Station 4/5 carries the loop once setup passes.

**Before sleep on Station 1 (while still primary host tonight):**

```powershell
node scripts/command-channel-status.js --http --time-sweep --profile joa
```

If `stranded > 0`, start loop or run recovery before sleep. See [no-paste-worker-loop-v0.md](./no-paste-worker-loop-v0.md).

## Time-aware sweep integration

Use the sweep whenever checking whether Station 4/5 setup is **triggered now**:

```powershell
node scripts/command-channel-status.js --http --time-sweep --profile joa
```

| Sweep signal | Action |
|--------------|--------|
| `stranded > 0` and Station 1 about to sleep | Start loop on Station 4/5 tonight **or** keep Station 1 loop until tomorrow bootstrap |
| Leaving Station 1 **> 2–3 hours** | Loop must run somewhere — prefer Station 4/5 after bootstrap |
| `running_too_long > 0` | Investigate before handoff; do not migrate host mid-job without Tim |
| `completed_needs_notification` | Room post still required (unchanged v0 rule) |

Full categories and TimOS task rules: [`time-aware-status-sweep-v0.md`](./time-aware-status-sweep-v0.md).

## Escalation / fallback

| Situation | Fallback |
|-----------|----------|
| Station 4/5 not ready tomorrow | Keep Station 1 loop running **only while Tim is at the desk**; do not use as overnight host |
| Preflight fails (no Node / no repo) | Install Node, clone repo, copy token setup from Station 1 — no auth schema changes |
| Token missing on Station 4/5 | Copy approved env/auth using same supervisor method; never paste tokens into chat |
| HTTP status probe fails | Check network/VPN; verify `COMMAND_CHANNEL_URL`; compare with Station 1 |
| Smoke test job never claims | Confirm `WORKER_TOKEN` in **same shell** as loop; check profile `joa`; see recovery in [no-stranded-job-v0.md](./no-stranded-job-v0.md) |
| Cursor CLI missing on Station 4/5 | Install Cursor CLI or use `-NoCursorAgent` only if Tim explicitly accepts non-agent execution |

Per-job recovery when loop is down:

```powershell
node scripts/command-channel-status.js --http --recovery --profile joa
.\scripts\start-juos-worker.ps1 -Profile joa -JobId <uuid>
```

## What remains before Station 4/5 is trusted always-on

| Gap | v0 state | Needed for trust |
|-----|----------|------------------|
| Manual bootstrap | This doc + preflight script | One successful smoke test + overnight run |
| No heartbeat / auto-restart | Operator restarts loop after reboot | Task Scheduler or service wrapper (future) |
| No push if loop dies | Time sweep shows stranded | Tim or assistant re-runs sweep periodically |
| Single JOA window | One PowerShell session | Document host name; avoid duplicate loops on two machines |
| Bridge Status not on phone | CLI / curl on desktop | [bridge-status-external-v0.md](./bridge-status-external-v0.md) (future) |
| Reboot persistence | Manual start after login | Logon script or scheduled task (future, out of v0) |

**Trust criteria (v0):** Preflight passes, smoke test job completes on Station 4/5, one intentional sleep cycle with Station 1 off and zero stranded jobs in morning sweep.

## Related

- Worker loop SOP: [`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md)
- Time-aware sweep: [`time-aware-status-sweep-v0.md`](./time-aware-status-sweep-v0.md)
- Stranded recovery: [`no-stranded-job-v0.md`](./no-stranded-job-v0.md)
- Preflight script: `scripts/check-worker-hub-preflight.ps1`
- Launchers: `scripts/start-joa-worker-loop.ps1`, `scripts/start-juos-worker.ps1`
