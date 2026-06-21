---
packet_id: "<job-id-prefix>_<status-category>"
title: "Command Channel <status-category>"
packet_type: "command-channel-status"
domain: "command-channel"
status: "<pending_unclaimed|claimed_running|completed|failed_or_blocked>"
freshness: "current"
source: "<SOURCE_ROOM>"
source_room: "<SOURCE_ROOM>"
active_lane: "<lane-id>"
target: "<JUB|GSync|SpaceA|MinistryOps|room>"
owner: "<SOURCE_ROOM>"
job_id: "<uuid>"
target_worker_profile: "<profile>"
repo_ref: "<repo>"
workspace_ref: "<path>"
bridge_fallback: "<JOA or empty>"
created_at: "<iso>"
approved_at: "<iso or empty>"
claimed_at: "<iso or empty>"
completed_at: "<iso or empty>"
blocker_flag: <true|false>
recovery_command: "<powershell or node recovery command>"
---

# Summary

One-line state for the requesting room. Use the category-specific sentence:

| status | Summary line |
|--------|----------------|
| `pending_unclaimed` | Job approved but not yet claimed by worker hub. |
| `claimed_running` | Job claimed; worker is running — do not assume completion. |
| `completed` | Job finished — result available; confirm room was notified. |
| `failed_or_blocked` | Job failed or blocked — Tim review required. |

- Job `<uuid>` | profile `<profile>` | task `<task_type>`
- Lane: `<source_room>` / `<active_lane>` | Repo: `<repo_ref>` | Workspace: `<workspace_ref>`

# Timestamps

- created: `<created_at>`
- approved: `<approved_at>`
- claimed: `<claimed_at>`
- completed: `<completed_at>`

# Next Action

| status | Action |
|--------|--------|
| `pending_unclaimed` | Run recovery: `.\scripts\start-juos-worker.ps1 -Profile <profile> -JobId <uuid>` |
| `claimed_running` | Wait for worker; poll status or `GET /remote-jobs/<uuid>`. |
| `completed` | Post result summary to target room; include files changed if present. |
| `failed_or_blocked` | Escalate to Tim; do not auto-retry. |

# Room Guidance

- approved != running
- pending != handled
- completed != notified
- Do not assume execution until `claimed_at` or `result` is present
- `source_room` and `active_lane` must reflect the originating room, not JOA, unless this lane is JOA
- If `bridge_fallback: JOA`, state why in the summary line

# Generate filled packet

```powershell
node scripts/command-channel-status.js --job-id <uuid> --packet --target-room GSync
```
