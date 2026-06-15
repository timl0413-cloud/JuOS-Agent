# Cloud-Readonly Worker Runtime (v0.8B)

v0.8A defined **replaceable workers** and routing rules. v0.8B implements a **local POC runtime** for the `cloud-readonly` worker profile — proving that jobs can run from a **repo snapshot** without Station1, local Cursor, or Tim's main computer being on.

This is **not deployment**. It is a contract and runtime proof inside TimOS-Agent.

## Purpose

Demonstrate the path:

```
repo_ref → synced repo snapshot → cloud-readonly worker → inspect/summarize result
```

When hosted in the cloud (future v0.8C), the same runtime logic applies: the worker reads only from a pre-synced snapshot, never from `127.0.0.1` or Tim's local disk.

## How cloud-readonly differs from station1-local

| | `station1-local` | `cloud-readonly` |
|---|------------------|------------------|
| Location | Tim's PC | Cloud (POC: local fixture path) |
| Availability | when computer on | always on |
| Data source | Local workspace path | `repo_ref` → snapshot |
| Execution | Local Cursor via v0.6 policy | Read-only file inspection in snapshot |
| Station1 required | yes | **no** |

Main computer can be off because the worker never calls local TimOS-Agent API or reads Station1 filesystem paths.

## What is a repo snapshot?

A **repo snapshot** is a read-only copy of repository files at a point in time, identified by `repo_ref` and mapped in `config/repo-sources.json`.

In v0.8B POC:

- `repo_ref: timos-agent-snapshot` maps to `test/fixtures/repo-snapshots/timos-agent-mini/`
- Fixture is minimal and fake — not a copy of the real repo

In production (future):

- Coordinator stores `repo_ref`
- Sync pipeline refreshes cloud-hosted snapshot
- Worker reads snapshot path only

## Supported tasks (v0.8B POC)

| `task_type` | Behavior |
|-------------|----------|
| `inspect_only` | Walk snapshot (skipping forbidden paths); return file tree + basic metadata |
| `summarize_repo` | Build concise summary from README, package.json, docs where present |

## Explicitly unsupported

- Editing files
- Deploy, push, migrations
- Shell command execution
- Cursor / local API calls
- Reading local credentials (`.env`, secrets, tokens)
- Reading Station1-only paths or live workspace disks
- `propose_patch` execution (profile allows routing; POC runtime does not implement yet)

## Safety model

The runtime:

- Reads snapshot directory only (path confined under project root in POC)
- Skips hidden files and forbidden segments: `.git`, `node_modules`, `.env`, `credentials`, `secrets`, `tokens`
- Never executes shell commands
- Never modifies files
- Returns `safety` metadata in every result

Worker routing (`lib/worker-routing.js`) is validated before execution.

## Libraries and scripts

| Module | Role |
|--------|------|
| `lib/repo-sources.js` | Resolve `repo_ref` → snapshot path |
| `lib/cloud-readonly-worker.js` | Execute inspect/summarize against snapshot |
| `scripts/cloud-readonly-worker-smoke-test.js` | Local validation (no network) |

```bash
node scripts/cloud-readonly-worker-smoke-test.js
```

## Result shape

```json
{
  "status": "completed",
  "worker_profile": "cloud-readonly",
  "repo_ref": "timos-agent-snapshot",
  "task_type": "inspect_only",
  "files_seen": [{ "path": "README.md", "type": "file", "size_bytes": 120 }],
  "summary": "...",
  "safety": {
    "shell_commands_executed": false,
    "local_api_called": false,
    "cursor_called": false,
    "files_modified": false,
    "snapshot_only": true
  },
  "errors": []
}
```

## Future path (v0.8C+)

1. Deploy cloud coordinator (real queue, not filesystem stub)
2. Host cloud-readonly worker process that polls coordinator
3. Repo sync pipeline (GitHub → cloud snapshot storage)
4. Wire GPT Action to coordinator URL
5. Optional: `propose_patch`, `always-on-home`, `cloud-edit-pr` workers

v0.8B proves the worker runtime contract locally. v0.8C makes it reachable while Tim's main computer is off.
