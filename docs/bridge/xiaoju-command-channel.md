# XiaoJu No-Paste Command Channel

Tim should **only talk to XiaoJu**. XiaoJu creates jobs through an authenticated Action/API. Workers execute. XiaoJu reads results. Tim must not paste prompts between XiaoJu and Cursor/workers anymore.

## Flow

```
Tim  -->  XiaoJu (phone/GPT)
              |
              |  Bearer: XIAOJU_ACTION_TOKEN
              |  POST /remote-jobs
              |  GET /remote-jobs/{id}
              v
         Command channel coordinator
              ^
              |  Bearer: WORKER_TOKEN
              |  GET /worker/jobs/next (outbound poll)
              |  POST /worker/jobs/{id}/result
              |
         cloud-readonly worker
              |
              v
         repo_ref → synced snapshot → inspect/summarize result
```

## First capability (read-only)

| `task_type` | Description |
|-------------|-------------|
| `inspect_only` | File tree + metadata from repo snapshot |
| `summarize_repo` | Summary from README / package.json / docs |

Later: patch proposals, PR creation, Cursor Cloud Agent — not in this MVP.

## Security boundary

| Token | Endpoints | Scopes |
|-------|-----------|--------|
| **XiaoJu action** | `POST /remote-jobs`, `GET /remote-jobs`, `GET /remote-jobs/{id}` | create, read, list only |
| **Worker** | `GET /worker/jobs/next`, `POST /worker/jobs/{id}/result` | claim, result only |

**Not exposed to XiaoJu:**

- claim / result endpoints
- approve / run / operator endpoints
- local TimOS-Agent API (`127.0.0.1:8787`)

Auth is **fail-closed**: missing or wrong token → 401/503; wrong scope → 403.

## Worker model

- Workers **poll outbound** — no inbound tunnel to Tim's machine required
- `cloud-readonly` operates from `repo_ref` snapshot — **Station1 can be off**
- No Cursor, no shell commands, no file modifications in worker runtime

## Local MVP

Filesystem-backed coordinator under `data/command-channel/` for local contract tests. API shape matches future cloud deploy.

| Component | Script |
|-----------|--------|
| HTTP server | `node scripts/server-command-channel.js` |
| Worker (local) | `node scripts/command-channel-worker.js --once` |
| Worker (HTTP) | `node scripts/command-channel-worker.js --once --http` |
| E2E smoke test | `node scripts/command-channel-smoke-test.js` |

## GPT Action import

Use **action-safe schema only**:

```
docs/openapi/xiaoju-command-channel.openapi.yaml
```

Never import `docs/openapi/worker-command-channel.openapi.yaml` into XiaoJu GPT Action.

## Auth setup

Environment variables (production-shaped):

```bash
set XIAOJU_ACTION_TOKEN=your-xiaoju-secret
set WORKER_TOKEN=your-worker-secret
```

Or `config/auth.json` with profiles:

- `xiaoju-command-channel` — `remote-jobs:create`, `remote-jobs:read`, `remote-jobs:list`
- `cloud-readonly-worker` — `remote-jobs:claim`, `remote-jobs:result`

## Making phone usable (after local tests pass)

1. Deploy coordinator API to a public HTTPS host
2. Set `XIAOJU_ACTION_TOKEN` and `WORKER_TOKEN` on the host
3. Import `xiaoju-command-channel.openapi.yaml` into XiaoJu GPT Action
4. Run worker polling process against deployed URL
5. Test create/read result from XiaoJu on phone

Do not deploy until `node scripts/command-channel-smoke-test.js` passes locally.
