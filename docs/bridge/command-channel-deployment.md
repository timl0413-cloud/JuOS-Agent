# Command Channel Deployment

Production-shaped deployment for the no-paste XiaoJu command channel.

## Architecture

```
XiaoJu GPT Action
    |  Bearer: XIAOJU_ACTION_TOKEN
    |  POST/GET /remote-jobs
    v
Public coordinator API (HTTPS)
    |  Bearer: SUPABASE_SERVICE_ROLE_KEY (server-side only)
    v
Supabase command_channel_jobs table
    ^
    |  Bearer: WORKER_TOKEN
    |  GET /worker/jobs/next (outbound poll)
    |  POST /worker/jobs/{id}/result
    |
cloud-readonly worker runtime
    |
repo_ref → synced snapshot → inspect/summarize result
```

## Local vs deployed storage

| Backend | Use | Durable? |
|---------|-----|----------|
| `filesystem` (`data/command-channel/`) | Local smoke tests only | No — not for serverless/public deploy |
| `supabase` | Deployed coordinator API | Yes — Postgres via Supabase REST |

**Do not deploy** the filesystem JSON queue as production baseline. Ephemeral/serverless hosts lose local disk; multiple instances race on files.

The filesystem adapter remains for `node scripts/command-channel-smoke-test.js` without external dependencies.

## Required environment variables

### Coordinator API (deployed)

| Variable | Purpose |
|----------|---------|
| `COMMAND_CHANNEL_BACKEND` | `supabase` for deploy; `filesystem` for local default |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access (**never** expose to XiaoJu or worker clients) |
| `XIAOJU_ACTION_TOKEN` | GPT Action bearer token |
| `WORKER_TOKEN` | Worker polling bearer token |
| `COMMAND_CHANNEL_HOST` | Bind host (e.g. `0.0.0.0` on host) |
| `COMMAND_CHANNEL_PORT` | Port (e.g. `8790`) |

Alternative to env tokens: `config/auth.json` with `xiaoju-command-channel` and `cloud-readonly-worker` profiles (gitignored).

### Worker process

| Variable | Purpose |
|----------|---------|
| `COMMAND_CHANNEL_URL` | Public coordinator base URL |
| `WORKER_TOKEN` | Worker bearer token |

Worker does **not** receive Supabase keys.

## Token separation

| Caller | Token | Endpoints |
|--------|-------|-----------|
| XiaoJu | `XIAOJU_ACTION_TOKEN` | create, read, list |
| Worker | `WORKER_TOKEN` | claim, result |
| Coordinator server | `SUPABASE_SERVICE_ROLE_KEY` | Supabase REST (internal) |

Fail-closed: missing auth → 503; invalid → 401; wrong scope → 403.

No approve/run/operator endpoints on command channel API.

## Database migration

Apply `docs/sql/command-channel-jobs.sql` in Supabase SQL editor or migration pipeline before deploy.

RLS is optional. If enabled, deny direct client access; coordinator API uses service role server-side only.

## Deploy sequence

1. Run local contract tests:
   ```bash
   node scripts/command-channel-smoke-test.js
   node scripts/command-channel-supabase-contract-test.js
   ```
2. Create Supabase table via `docs/sql/command-channel-jobs.sql`
3. Set env vars on host (VPS, container, or platform service)
4. Set `COMMAND_CHANNEL_BACKEND=supabase`
5. Start API: `node scripts/server-command-channel.js`
6. Verify `GET /health` shows `backend: supabase`
7. Start worker polling: `node scripts/command-channel-worker.js --once --http` (then daemonize)
8. Smoke test create/read via curl or GPT Action

Do not deploy until local tests pass.

## GPT Action wiring sequence

1. Deploy coordinator to HTTPS URL
2. Edit `docs/openapi/xiaoju-command-channel.openapi.yaml` — replace `https://YOUR-COORDINATOR-URL`
3. Import **action-safe schema only** into XiaoJu GPT Action
4. Configure bearer auth: `XIAOJU_ACTION_TOKEN`
5. Test: create `inspect_only` job → poll `GET /remote-jobs/{id}` until `completed`
6. **Never** import `worker-command-channel.openapi.yaml` into GPT Action

## Worker polling sequence

1. Worker runs on always-on host (not Tim's main PC required)
2. Poll `GET /worker/jobs/next?worker_profile=cloud-readonly` with `WORKER_TOKEN`
3. Execute via `lib/cloud-readonly-worker.js` against repo snapshot
4. Submit `POST /worker/jobs/{id}/result`
5. Repeat on interval or `--once` for testing

Optional: `--job-id` to claim specific pending job.

## Rollback plan

1. Stop worker polling process
2. Stop coordinator API
3. Set `COMMAND_CHANNEL_BACKEND=filesystem` only on local dev — production should stay on supabase or be taken offline
4. Revert GPT Action schema URL or disable Action
5. Jobs remain in `command_channel_jobs` table for audit; no data loss
6. Re-deploy previous API version if needed

## Security notes

- Service role key stays on coordinator server only
- No secrets in git
- No tunnel-as-production-baseline
- Read-only task types only: `inspect_only`, `summarize_repo`, `risk_level: low`
