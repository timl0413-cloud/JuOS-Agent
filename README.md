# TimOS-Agent

Local coding worker router for TimOS v0.1 — register workspaces and workers, then create local jobs.

## Requirements

- Node.js 18+

No external dependencies. Jobs are stored as JSON files under `data/jobs/`.

## Configuration

- `config/workspaces.json` — registered code workspaces
- `config/workers.json` — possible job runners (`manual`, `cursor`, `codex`)

Workers are labels only in v0.1. No Cursor CLI or Codex CLI is invoked.

## CLI

```bash
node scripts/agent.js workspaces
node scripts/agent.js workers
node scripts/agent.js job:create timfinance manual "Check TimOS API action failure"
node scripts/agent.js jobs
node scripts/agent.js job:show <job-id>
```

Or via npm script:

```bash
npm run agent -- workspaces
npm run agent -- workers
npm run agent -- job:create timfinance manual "Your prompt here"
npm run agent -- jobs
npm run agent -- job:show <job-id>
```

## Job shape

Each job is a JSON file with:

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `workspace` | Workspace id |
| `workspace_path` | Absolute path on disk |
| `worker` | Worker id (`manual`, `cursor`, or `codex`) |
| `prompt` | Task description |
| `status` | Defaults to `queued` |
| `created_at` | ISO timestamp |
| `updated_at` | ISO timestamp |
| `result` | `null` until a runner fills it in |

## Scope (v0.1)

- Plain Node.js, no TypeScript
- No database, server, Supabase, Cursor CLI, Codex CLI, or GPT Actions
- Does not modify TimFinance or nova-reading
