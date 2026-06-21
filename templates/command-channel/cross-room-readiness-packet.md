---
packet_id: "<room-id>_readiness_<yyyy-mm-dd>"
title: "Cross-Room Launch Readiness"
packet_type: "cross-room-readiness"
domain: "command-channel"
status: "<ready|pending|blocked>"
freshness: "current"
source: "JOA"
source_room: "JOA"
active_lane: "joa-dev"
target: "<NovaBridge|JUB|GSync|SpaceA|MinistryOps|Finance|Station4|Station5>"
owner: "Tim"
created_at: "<iso>"
control_tower_checked_at: "<iso from GET /tower/summary or npm run status:tower>"
motion_state: "<idle|running|needs_attention|blocked|review_pending>"
---

# Summary

One-line answer for **`<TARGET_ROOM>`**: can this room start command-channel development work now?

| Answer | When to use |
|--------|-------------|
| **Ready** | Lane is `active` in registry; worker hub requirements met; no blocking JOA jobs |
| **Pending** | Lane setup, Room Identity Card, or Station bootstrap still required |
| **Blocked** | JOA motion is `blocked` or critical stranded jobs affect shared infrastructure |

- Target room: `<TARGET_ROOM>`
- Target profile: `<profile or none>`
- Control Tower motion: `<motion_state>` · waiting on: `<waiting_on>`

# Control Tower snapshot

Fill from `GET /tower/summary`, `GET /status/summary` → `control_tower`, or `npm run status:tower`:

| Field | Value |
|-------|-------|
| `motion_state` | |
| `active_job_count` | |
| `pending_approval_count` | |
| `pending_or_stranded_count` | |
| `current_focus` | |
| `waiting_on` | |
| `next_action_owner` | |
| `next_action_text` | |
| `lane_readiness_summary` | |

# Lane readiness (v0 registry)

| Room | Lane status | Launch ready | Notes |
|------|-------------|--------------|-------|
| JOA | active | yes | Station 1 JOA worker loop |
| Station 4 / 5 | bootstrap_pending | no | Worker hub panels planned |
| NovaBridge (NB) | pending | no | Room Identity Card + Tim approval |
| JUB | pending | no | GSync publish only until lane opened |
| GSync | active | yes | Registry; jucore when JuCore hub runs |
| SpaceA | active | yes | Per-job repo_ref + workspace_ref |
| MinistryOps | active | yes | Per-job repo_ref + workspace_ref |
| Finance / JFA | active | yes | Finance worker hub must be running |

Registry reference: [`docs/command-channel/room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md)

# Prerequisites before `<TARGET_ROOM>` can start

- [ ] Room Identity Card pasted at session start ([`room-identity-card.md`](./room-identity-card.md))
- [ ] `source_room` and `active_lane` set on every job payload (not JOA identity unless JOA lane)
- [ ] `target_worker_profile` matches an **active** lane profile
- [ ] `repo_ref` and `workspace_ref` explicit on the job
- [ ] Worker hub running for that profile (or JOA bridge fallback declared)
- [ ] JOA Control Tower shows no blocking stranded jobs on shared TimOS-Agent infrastructure

# Recommended checks

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower/preview

# Live (hosted):
npm run status:command-channel:control-tower
```

# Next action

| If | Then |
|----|------|
| Target lane `pending` | Complete lane setup per [`room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md); do not auto-launch |
| Target lane `active` but worker hub down | Start profile worker loop; re-check `/tower` |
| JOA `needs_attention` / stranded | Resolve stranded jobs on Station 1 before handing off |
| Ready | Tim approves first job with correct `source_room`, `active_lane`, `target_worker_profile` |

# Room guidance

- Control Tower is read-only — it does **not** launch workers or route jobs
- `approved ≠ running` — verify `active_job_count` before assuming work is in progress
- Other rooms must not impersonate JOA — declare true `source_room` on every job
- No auto-routing between rooms in v0
