# Room / Lane Identity Registry v0

Scaffold for distributing development load across explicit lanes **without impersonating JOA** and **without Tim re-explaining identity in every chat**.

**Scope:** documentation and example config only. **No runtime activation**, no worker auto-routing changes, no new profiles enabled.

## Problem

JOA became the bottleneck: too many rooms routed development work through JOA identity and JOA's chat context. The fix is **explicit lane identity** plus a safe sequence for opening direct command-channel lanes — not impersonation.

## Concepts

| Term | Meaning |
|------|---------|
| **source_room** | Who originated the request (ChatGPT room identity). Audit and handoff metadata. |
| **active_lane** | Named execution lane for this room (e.g. `nova-dev`, `spacea-bridge`). Distinct from worker profile id. |
| **target_worker_profile** | Runtime worker that claims the job (`joa`, `finance`, `nova`, …). Set on **each job payload**. |
| **repo_ref / workspace_ref** | Where the worker executes. Per job; not implied by room name alone. |

```
ChatGPT room (source_room)
    |
    |  Room Identity Card + job payload
    |  source_room, active_lane, repo_ref, workspace_ref, target_worker_profile
    v
Command-channel coordinator  (unchanged routing — per job payload)
    v
Worker hub (profile-specific)
    v
Target repo / workspace
```

**Routing principle (unchanged):** see [`command-channel-repo-routing.md`](../command-channel-repo-routing.md). Room identity is **not** a routing key; job fields are.

## Registry files

| File | Role |
|------|------|
| [`config/room-lanes.example.json`](../../config/room-lanes.example.json) | Machine-readable lane entries (example only; not loaded by runtime in v0) |
| [`templates/command-channel/room-identity-card.md`](../../templates/command-channel/room-identity-card.md) | Paste-at-session-start card for new or memory-less ChatGPT rooms |
| [`command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml) | Existing worker profile and GPT room capabilities |
| [`gsync/registry/routes.yaml`](../../gsync/registry/routes.yaml) | GSync cross-room route metadata (JUB → GSync → JEX) |

To activate a local copy after Tim approval: copy `room-lanes.example.json` → `room-lanes.json` (still documentation-side until explicitly wired).

## Lane list (v0)

| room_id | display_name | source_room | active_lane | lane_status | target profile(s) |
|---------|--------------|-------------|-------------|-------------|---------------------|
| `joa` | JOA | JOA | `joa-dev` | **active** | `joa` |
| `jub` | JUB / OB | JUB | `jub-coordination` | **pending** | _(none — GSync publish only)_ |
| `gsync` | GSync | GSync | `gsync-dev` | **ready to test** | `gsync` (direct dev in `juos-knowledge-vault`) |
| `gsync` | GSync | GSync | `gsync-registry` | **active** | `jucore` (JuCore scaffold when hub running) |
| `novabridge` | NB / NovaBridge | NovaBridge | `nova-dev` | **pending** | `nova` |
| `jex` | JEX | JEX | `jex-handoff` | **pending** | _(none in v0)_ |
| `spacea` | SpaceA | SpaceA | `spacea-bridge` | **active** | `spacea` |
| `ministryops` | MinistryOps | MinistryOps | `ministry-bridge` | **active** | `ministry` |
| `finance` | Finance / JFA | JFA | `finance-dev` | **active** | `finance` |

Full field definitions (paths, guardrails, templates): [`config/room-lanes.example.json`](../../config/room-lanes.example.json).

### Continuing as JOA, JUB, NB, or GSync without long chat memory

1. Open the room's **Room Identity Card** ([template](../../templates/command-channel/room-identity-card.md)) or the lane row above.
2. For **JUB**: load GSync accepted packets (`gsync/packets/accepted/`); publish/consume via packet IDs — not JOA dev identity.
3. For **GSync**: direct development via `target_worker_profile: gsync`, workspace `juos-knowledge-vault`, writes under `gsync/**`; registry + optional `jucore` jobs against `JuCore`; `requested_by: gsync`.
4. For **NovaBridge**: use `target_worker_profile: nova` and `source_room: NovaBridge` when lane is approved; until then, document-only.
5. For **JOA**: only TimOS-Agent scoped work with `target_worker_profile: joa`.

## No-impersonation rule

Rooms **must not** use JOA identity for their own domain work.

| Wrong | Right |
|-------|-------|
| Nova room posts as "JOA" | `source_room: NovaBridge`, `active_lane: nova-dev` |
| Finance room uses `requested_by: joa` | `requested_by: finance` or `jfa`, profile `finance` |
| SpaceA task described as "JOA implementing STUF" | `source_room: SpaceA`, `active_lane: spacea-bridge`, profile `spacea` |

**JOA bridge fallback** (temporary only): when a pending lane must use JOA worker infrastructure, the handoff **must** declare:

```yaml
source_room: <actual room>
active_lane: <actual lane>
bridge_fallback: JOA
bridge_reason: <explicit reason>
```

Bridge status and status packets should preserve `source_room` and `active_lane` so Tim can see true origin vs execution profile.

## Bridge Status integration

Future and current bridge status surfaces should display or filter by:

- **`source_room`** — originating room (from job `requested_by` or status packet `source`)
- **`active_lane`** — lane id from registry (status packet frontmatter or job metadata when added)

Existing surfaces:

- [`bridge-status-ui-v0.md`](./bridge-status-ui-v0.md) — HTML/API buckets (stranded, running, completed, failed)
- [`bridge-status-external-v0.md`](./bridge-status-external-v0.md) — Travel Mode deploy path
- [`templates/command-channel/status-packet.md`](../../templates/command-channel/status-packet.md) — includes `source_room` and `active_lane` fields

Generate status packets with explicit source:

```powershell
node scripts/command-channel-status.js --job-id <uuid> --packet --target-room GSync --source-room SpaceA
```

(If `--source-room` is not yet on CLI, set `source_room` and `active_lane` manually in packet frontmatter per template.)

Recommended view-model fields for a future bridge status revision:

```json
{
  "job_id": "...",
  "source_room": "SpaceA",
  "active_lane": "spacea-bridge",
  "target_worker_profile": "spacea",
  "repo_ref": "STUF",
  "workspace_ref": "C:\\projects\\SpaceA\\STUF-Website"
}
```

## Lane-opening checklist

Complete **before** marking a `pending` lane as **active** for direct command-channel use.

### 1. Identity

- [ ] Room Identity Card filled from [`room-identity-card.md`](../../templates/command-channel/room-identity-card.md)
- [ ] Entry added or updated in `room-lanes.example.json` (or approved `room-lanes.json`)
- [ ] Tim approved `lane_status: active` for this room
- [ ] `source_room` and `active_lane` documented and communicated to the ChatGPT room instructions

### 2. Execution contract

- [ ] `target_worker_profile` exists in [`command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml)
- [ ] Worker hub script exists and Tim knows startup command (`scripts/start-worker-hubs.ps1`)
- [ ] `repo_ref` and `workspace_ref` validated for the lane (or per-job rules documented for bridges)
- [ ] `allowed_paths` / `forbidden_paths` reviewed

### 3. No-impersonation

- [ ] Room instructions forbid claiming JOA identity
- [ ] Fallback path documents `bridge_fallback: JOA` when needed
- [ ] Status packet template uses correct `source_room` / `active_lane`

### 4. Smoke test (required)

Goal: prove end-to-end flow with **no unintended file changes**. Same bar as [`command-channel-repo-routing.md`](../command-channel-repo-routing.md#room-smoke-test-checklist).

1. **Create job** — From the room (or Tim on its behalf), create supervised `inspect_only` with correct `requested_by`, `repo_ref`, `workspace_ref`, and `target_worker_profile`.
2. **Tim approve** — `approval_required: true`; wait for `approval_status: approved`.
3. **Hub auto-claim** — Matching worker hub running; job reaches `claimed`.
4. **Cursor result completed** — Poll until `status: completed` with result summary.
5. **No file changes** — Target workspace working tree unchanged.
6. **Status packet** — Generate packet; verify `source_room` and `active_lane` match registry, not JOA (unless lane is JOA).

### 5. Handoff

- [ ] GSync packet or Identity Card linked in room custom instructions
- [ ] Bridge status checked after first real job

## How this reduces the JOA bottleneck

| Before | After (v0 scaffold) |
|--------|---------------------|
| Tim re-explains which repo, profile, and scope in every room | Room Identity Card + registry row |
| Non-JOA work labeled as JOA | Explicit `source_room` + `active_lane` |
| All development questions routed to JOA chat | Each lane owns its guardrails and handoff template |
| Bridge status shows profile only | Future UI can show origin room vs execution profile |

JOA remains the **TimOS-Agent primary dev lane**, not the identity for every other room.

## Before first non-JOA lane activation

1. **Tim approval** — lane moved from `pending` to `active` in registry.
2. **Worker hub running** — e.g. `nova`, `finance`, `spacea`, `ministry`, or `jucore` as applicable.
3. **Room Identity Card** — attached to ChatGPT custom instructions.
4. **Smoke test passed** — inspect_only checklist complete.
5. **No runtime code changes required for v0** — activation is operational (hub + room config), not registry file load.
6. **Optional later** — wire `room-lanes.json` into status CLI / bridge status view-model (out of v0 scope).

### Pending lanes — specific gates

| Lane | Gate |
|------|------|
| **JUB/OB** | OB route auth (see GSync `2026-06-19_005`); coordination via GSync only until direct action approved |
| **NovaBridge** | Room Identity Card in NB instructions; confirm Nova hub operational |
| **JEX** | GSync → JEX route used for handoffs; no worker until profile defined and approved |

## config/workspaces.json

No change in v0. Current file lists TimOS-Agent, TimFinance, NovaUniverse only. SpaceA and MinistryOps targets live in [`config/workspace-targets.json`](../../config/workspace-targets.json). If a future `workspaces.json` consolidation is desired, document in a Tim-approved task — do not auto-edit.

## Blockers / risks

| Risk | Mitigation |
|------|------------|
| Rooms continue impersonating JOA | Identity Card + no-impersonation rule; Tim review of `requested_by` |
| Registry mistaken for runtime routing | `$schema_note` in example JSON; this doc states no auto-load in v0 |
| Pending lanes activated without smoke test | Checklist §4 mandatory |
| Bridge status lacks `active_lane` today | Template updated; CLI option may follow; manual frontmatter OK |
| JUB/OB direct action blocked | Stay on GSync packet path until auth resolved |
| Profile/hub drift vs registry | Single source for profiles: `command-channel-room-capabilities.yaml` |

## Related

- [`command-channel-repo-routing.md`](../command-channel-repo-routing.md)
- [`command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml)
- [`no-stranded-job-v0.md`](./no-stranded-job-v0.md)
- [`gsync/README.md`](../../gsync/README.md)
