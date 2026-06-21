---
card_id: "<room-id>_identity_v0"
room_id: "<room-id>"
display_name: "<Human-readable room name>"
source_room: "<SOURCE_ROOM>"
active_lane: "<lane-id>"
lane_status: "<active|pending>"
created_at: "<YYYY-MM-DD>"
approved_by: "<Tim or pending>"
baseline_ref: "XiaoJu Ecosystem Program Development Baseline V6.0"
overlay_ref: "JUB / GSync Calibration Before 7/7"
registry_ref: "config/room-lanes.example.json#<room-id>"
---

# Room Identity Card — `<display_name>`

Use this card when opening a **new ChatGPT room** or continuing work in an existing room **without long chat memory**. Paste or attach this card at session start. Do not rely on JOA to restate identity each time.

## Identity (who is speaking)

| Field | Value |
|-------|-------|
| **room_id** | `<room-id>` |
| **source_room** | `<SOURCE_ROOM>` — canonical name for status packets and handoffs |
| **display_name** | `<Human-readable room name>` |
| **active_lane** | `<lane-id>` — this room's execution lane, not JOA unless this room *is* JOA |

## Execution (where work runs)

| Field | Value |
|-------|-------|
| **allowed_worker_profiles** | `<profile-list>` |
| **default target_worker_profile** | `<primary-profile>` |
| **repo_ref** | `<repo or per job>` |
| **workspace_ref** | `<path or per job>` |

## Scope

### Allowed paths

- `<path-or-pattern-1>`
- `<path-or-pattern-2>`

### Forbidden paths

- `<forbidden-1>`
- `<forbidden-2>`

## Status & handoff

| Field | Value |
|-------|-------|
| **status_surface** | `<bridge-status URL, CLI, or GSync registry path>` |
| **handoff_packet_template** | `<template path>` |

When posting job status to another room, include `source_room` and `active_lane` in the packet frontmatter (see [`status-packet.md`](./status-packet.md)).

## Guardrails

- `<guardrail-1>`
- `<guardrail-2>`

## No-impersonation rule

This room **must not** use JOA identity for its own work.

- Job `requested_by` must match this room's `room_id` or documented alias.
- Status packets must set `source: "<SOURCE_ROOM>"` and `active_lane: "<lane-id>"`.
- If work must temporarily route through JOA worker infrastructure, declare explicitly:

  ```
  source_room: <SOURCE_ROOM>
  active_lane: <lane-id>
  bridge_fallback: JOA
  bridge_reason: <why JOA hub is used temporarily>
  ```

## Example job payload (command-channel)

Replace placeholders. Do not copy JOA defaults unless this room is JOA.

```json
{
  "requested_by": "<room-id>",
  "repo_ref": "<repo_ref>",
  "workspace_ref": "<workspace_ref>",
  "target_worker_profile": "<profile>",
  "task_type": "supervised_implement",
  "risk_level": "low",
  "auto_run_requested": true,
  "prompt": "Task description.",
  "approval_required": true
}
```

## Continuing without chat memory

1. Load this card (or the matching entry from [`room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md)).
2. Load latest accepted GSync packets for this domain (if applicable).
3. Create jobs with explicit `repo_ref`, `workspace_ref`, and `target_worker_profile` — routing is **per job**, not per room memory.
4. Check bridge status or run `node scripts/command-channel-status.js` before assuming prior jobs completed.

## Related

- Registry: [`docs/command-channel/room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md)
- Routing policy: [`docs/command-channel-repo-routing.md`](../../docs/command-channel-repo-routing.md)
- Lane-opening checklist: same doc, § Lane-opening checklist
