# TimOS-Agent

Local coding worker router — register workspaces and workers, queue jobs, and run them through local agents.

## Requirements

- Node.js 18+
- Cursor Agent installed locally (see `config/runtime.json`)

No external npm dependencies. Jobs are stored as JSON files under `data/jobs/`.

## Configuration

| File | Purpose |
|------|---------|
| `config/workspaces.json` | Registered code workspaces |
| `config/workers.json` | Job runners (`manual`, `cursor`, `codex`) |
| `config/runtime.json` | Cursor Agent paths and safety settings |

### Runtime safety defaults

- `allowed_workspace_root` — jobs may only run under this path (`C:\projects`)
- `require_confirm_execution` — cursor jobs refuse to run without `--confirm-execution`

## CLI (v0.1)

```bash
node scripts/agent.js workspaces
node scripts/agent.js workers
node scripts/agent.js job:create timfinance manual "Check TimOS API action failure"
node scripts/agent.js jobs
node scripts/agent.js job:show <job-id>
```

## CLI (v0.2 — job runner)

```bash
node scripts/agent.js job:run-next --confirm-execution
node scripts/agent.js job:run <job-id> --confirm-execution
node scripts/agent.js job:complete <job-id> "<result>"
node scripts/agent.js job:fail <job-id> "<error>"
```

### Worker behavior

| Worker | `job:run` behavior |
|--------|-------------------|
| `manual` | Refuses — use `job:complete` or `job:fail` |
| `codex` | Refuses — not available on this machine |
| `cursor` | Runs Cursor Agent via configured `node_path` + `index_path` |

Cursor jobs wrap the user prompt with TimOS-Agent safety rules before execution. After the agent exits, the job stores stdout, stderr, exit code, git status/diff, and sets status to `completed` or `failed`.

## CLI (v0.2.1 — Cursor headless read-only)

The cursor runner uses Cursor Agent headless mode for the first safe test:

- `--print` — non-interactive/script use
- `--output-format text` — plain text output
- `--mode ask` — read-only mode (no file edits)
- `--trust` — workspace trust in headless mode
- `--workspace <path>` — target workspace

The runner passes `--trust` only. It never passes `--yolo`, `-f`, `--force`, or sandbox-disabling flags.

### Safe read-only test (run when ready)

```bash
node scripts/agent.js job:create timfinance cursor "Inspect the repository and summarize the app structure. Do not modify files."
node scripts/agent.js job:run <job-id> --confirm-execution
node scripts/agent.js job:show <job-id>
```

## Job shape

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `workspace` | Workspace id |
| `workspace_path` | Absolute path on disk |
| `worker` | Worker id |
| `prompt` | Task description |
| `status` | `queued`, `running`, `completed`, or `failed` |
| `created_at` | ISO timestamp |
| `updated_at` | ISO timestamp |
| `result` | `null` until finished; cursor jobs include stdout/stderr/git capture |

## Scope

- Plain Node.js, no TypeScript, no external npm packages
- No database, server, Supabase, or GPT Actions
- Does not modify TimFinance or nova-reading
- Never auto-commits, pushes, or deploys
