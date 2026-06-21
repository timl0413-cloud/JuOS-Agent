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
parallel_capacity_checked: true
---

# Summary

One-line answer for **`<TARGET_ROOM>`**: can this room start command-channel development work now?

| Answer | When to use |
|--------|-------------|
| **Ready** | Lane is **Active now**; worker hub running; smoke test passed; no blocking stranded jobs |
| **Pending** | Lane is **Ready to test** or **Pending setup** — complete checklist before first job |
| **Blocked** | Lane is **Blocked** or motion is `blocked`; critical stranded jobs on shared infrastructure |

- Target room: `<TARGET_ROOM>`
- Target `source_room`: `<SOURCE_ROOM>` (use on every job — not JOA unless JOA lane)
- Target `active_lane`: `<ACTIVE_LANE>` (from registry)
- Target profile: `<profile or none>`
- Readiness category: `<Active now|Ready to test|Pending setup|Blocked|Not safe yet>`
- Control Tower motion: `<motion_state>` · waiting on: `<waiting_on>`

# Parallel capacity snapshot

Fill from `GET /tower/summary` → `parallel_capacity` or [`parallel-lane-readiness-v0.md`](../../docs/command-channel/parallel-lane-readiness-v0.md):

| Field | Value |
|-------|-------|
| Active writer lanes now | |
| Safe parallel target | 2–3 |
| Slots available | |
| This room's category | |

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

Readiness categories: **Active now** · **Ready to test** · **Pending setup** · **Blocked** · **Not safe yet**

| Room | source_room | active_lane | Profile | Readiness | Can start? | Notes |
|------|-------------|-------------|---------|-----------|------------|-------|
| JOA | `JOA` | `joa-dev` | `joa` | Active now | yes | Station 1 JOA loop — slot 1 |
| NovaBridge (NB) | `NovaBridge` | `nova-dev` | `nova` | Ready to test | no | Smoke test + start `nova` hub |
| Finance / JFA | `JFA` | `finance-dev` | `finance` | Ready to test | no | Start `finance` hub + smoke test |
| SpaceA | `SpaceA` | `spacea-bridge` | `spacea` | Ready to test | no | Per-job repo_ref + workspace_ref |
| MinistryOps | `MinistryOps` | `ministry-bridge` | `ministry` | Ready to test | no | Per-job repo_ref + workspace_ref |
| GSync / JuCore | `GSync` | `gsync-registry` | `jucore` | Ready to test | no | Registry active; hub when running |
| Station 4 / 5 | — | — | `joa` (host) | Pending setup | no | JOA always-on host bootstrap |
| JUB | `JUB` | `jub-coordination` | _(none)_ | Blocked | no | GSync publish only |
| JEX | `JEX` | `jex-handoff` | _(none)_ | Pending setup | no | Handoff only |

Registry reference: [`room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md) · [`parallel-lane-readiness-v0.md`](../../docs/command-channel/parallel-lane-readiness-v0.md)

# Job payload language for `<TARGET_ROOM>`

Use exact fields on every job (example — adjust per registry row):

```yaml
source_room: <SOURCE_ROOM>
active_lane: <ACTIVE_LANE>
target_worker_profile: <profile>
repo_ref: <repo>
workspace_ref: <absolute workspace path>
requested_by: <room id — not joa unless JOA lane>
```

**NovaBridge example:**

```yaml
source_room: NovaBridge
active_lane: nova-dev
target_worker_profile: nova
repo_ref: NovaUniverse
workspace_ref: C:\projects\NovaUniverse
requested_by: nova
```

**Finance example:**

```yaml
source_room: JFA
active_lane: finance-dev
target_worker_profile: finance
repo_ref: TimFinance
workspace_ref: C:\projects\TimFinance
requested_by: finance
```

**JOA bridge fallback** (temporary only — when pending lane must use JOA infrastructure):

```yaml
source_room: <actual room>
active_lane: <actual lane>
bridge_fallback: JOA
bridge_reason: <explicit reason>
target_worker_profile: joa
```

# Prerequisites before `<TARGET_ROOM>` can start

- [ ] Lane readiness is **Active now** (not merely Ready to test)
- [ ] Room Identity Card pasted at session start ([`room-identity-card.md`](./room-identity-card.md))
- [ ] `source_room` and `active_lane` set on every job payload (not JOA identity unless JOA lane)
- [ ] `target_worker_profile` matches an approved lane profile
- [ ] `repo_ref` and `workspace_ref` explicit on the job — **different workspace from other active parallel jobs**
- [ ] Worker hub running for that profile in a **separate** loop (one loop per profile)
- [ ] Smoke test (`inspect_only`) passed per [`room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md)
- [ ] Control Tower shows no blocking stranded jobs

# Recommended checks

```powershell
npm run server:command-channel
start http://127.0.0.1:8790/tower

# Live (hosted):
npm run status:command-channel:control-tower
```

# Next action

| If | Then |
|----|------|
| Readiness **Ready to test** | Complete smoke test; Tim approves lane active; start profile hub — do not auto-launch |
| Readiness **Pending setup** | Complete lane setup per [`room-lane-identity-v0.md`](../../docs/command-channel/room-lane-identity-v0.md) |
| Readiness **Blocked** | Use GSync or documented fallback; do not direct-action |
| Target **Active now** but hub down | Start profile worker loop; re-check `/tower` |
| JOA `needs_attention` / stranded | Resolve stranded jobs before opening parallel slot |
| Ready | Tim approves first job with correct `source_room`, `active_lane`, `target_worker_profile` |

# Room guidance

- Control Tower is read-only — it does **not** launch workers or route jobs
- `approved ≠ running` — verify `active_job_count` before assuming work is in progress
- **One writer per repo/workspace** — parallel jobs require separate lanes (see parallel-lane-readiness-v0)
- Other rooms must not impersonate JOA — declare true `source_room` on every job
- No auto-routing between rooms in v0
