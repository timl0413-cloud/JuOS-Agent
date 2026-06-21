# Parallel Lane Readiness v0

Operator guide for reaching **2–3 simultaneous active jobs** safely. Read-only documentation — no runtime activation, no auto-routing, no auth or schema changes.

## Target and safe model

| Item | Value |
|------|-------|
| **Safe parallel target** | **2–3 simultaneous active jobs** |
| **Current active writer lanes** | **1** — JOA local loop on Station 1 |
| **Parallelism model** | **One writer per repo/workspace**; scale by separate lanes with distinct `workspace_ref` and `target_worker_profile` |
| **Unsafe** | Multiple workers writing the **same** repo/workspace concurrently without locks, queueing, or explicit Tim approval |

```
Tim approves jobs
    |
    +-- JOA loop        --> C:\projects\TimOS-Agent     (active now)
    +-- Nova hub        --> C:\projects\NovaUniverse    (ready to test)
    +-- Finance hub     --> C:\projects\TimFinance      (ready to test)
    +-- SpaceA hub      --> per-job workspace targets   (ready to test)
    +-- Ministry hub    --> per-job workspace targets   (ready to test)
    +-- JuCore hub      --> C:\projects\JuCore          (ready to test when hub runs)
```

**Rule:** Each parallel lane owns its workspace. JOA must not become the identity or execution host for every room. See [`room-lane-identity-v0.md`](./room-lane-identity-v0.md).

## Readiness categories (Control Tower v0)

| Category | Meaning | Can start dev jobs? |
|----------|---------|---------------------|
| **Active now** | Worker loop running; lane approved; smoke-tested or in production use | Yes — for that lane's workspace |
| **Ready to test** | Profile and workspace mapped; hub script exists; Tim approval + smoke test remain | Not yet — complete smoke test first |
| **Pending setup** | Lane identity, host bootstrap, or Room Identity Card still incomplete | No |
| **Blocked** | External gate (auth, coordination path) prevents direct execution | No — use documented fallback |
| **Not safe yet** | Would require same-workspace concurrency or missing guardrails | No — do not enable |

## Lane inventory (v0)

| Room | `source_room` | `active_lane` | Profile | Workspace | Readiness | Parallel slot |
|------|---------------|---------------|---------|-----------|-----------|---------------|
| **JOA** | `JOA` | `joa-dev` | `joa` | `C:\projects\TimOS-Agent` | **Active now** | **Slot 1 (in use)** |
| **NovaBridge (NB)** | `NovaBridge` | `nova-dev` | `nova` | `C:\projects\NovaUniverse` | **Ready to test** | **Slot 2 candidate** |
| **Finance / JFA** | `JFA` | `finance-dev` | `finance` | `C:\projects\TimFinance` | **Ready to test** | **Slot 2–3 candidate** |
| **SpaceA** | `SpaceA` | `spacea-bridge` | `spacea` | per job | **Ready to test** | Slot 3 when hub runs |
| **MinistryOps** | `MinistryOps` | `ministry-bridge` | `ministry` | per job | **Ready to test** | Slot 3 when hub runs |
| **GSync (direct dev)** | `GSync` | `gsync-dev` | `gsync` | `C:\projects\juos-knowledge-vault` | **Ready to test** | Writes `gsync/**` only — [gsync-direct-execution-path-v0.md](./gsync-direct-execution-path-v0.md) |
| **GSync / JuCore** | `GSync` | `gsync-registry` | `jucore` | `C:\projects\JuCore` | **Ready to test** | Separate JuCore scaffold lane |
| **Station 4 / 5** | — | — | `joa` (host) | TimOS-Agent host | **Pending setup** | Moves JOA off Station 1 |
| **JUB / OB** | `JUB` | `jub-coordination` | _(none)_ | GSync packets only | **Blocked** | Not a writer lane in v0 |
| **JEX** | `JEX` | `jex-handoff` | _(none)_ | handoff only | **Pending setup** | No worker profile yet |

Full registry fields: [`config/room-lanes.example.json`](../../config/room-lanes.example.json).

## Next lane to open first

**NovaBridge (NB)** — best first parallel slot after JOA.

| Reason | Detail |
|--------|--------|
| Isolated workspace | `NovaUniverse` is separate from TimOS-Agent — no same-repo concurrency risk |
| Profile confirmed | `nova` in [`command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml) |
| Clear domain | Knowledge Vault / NovaUniverse work should not route through JOA identity |
| Low blast radius | Docs and Nova-scoped changes do not collide with TimOS-Agent jobs |

**Second parallel slot:** **Finance** (`TimFinance` workspace) — same isolation pattern once Nova smoke test passes.

**Optional later:** **JUB** — only after lane identity, workspace mapping, and OB auth gates are resolved; until then GSync publish/consume only.

## Blockers before 2–3 jobs run simultaneously

| # | Blocker | Affects | Resolution |
|---|---------|---------|------------|
| 1 | **Single JOA loop** | Only 1 active writer today | Start additional profile hubs (`nova`, `finance`, …) in **separate** shells — never two loops on same profile |
| 2 | **Station 4/5 not always-on** | JOA tied to Station 1 | Complete [`station-45-worker-hub-v0.md`](./station-45-worker-hub-v0.md) bootstrap + smoke test |
| 3 | **Pending lane smoke tests** | NB, Finance marked ready-to-test only | Run `inspect_only` checklist per [`room-lane-identity-v0.md`](./room-lane-identity-v0.md#4-smoke-test-required) |
| 4 | **Worker hubs not running** | Ready lanes cannot claim | `scripts/start-worker-hubs.ps1` or profile-specific loop — Tim starts after approval |
| 5 | **Room Identity Cards** | Rooms may impersonate JOA | Paste cards from [`templates/command-channel/room-identity-card.md`](../../templates/command-channel/room-identity-card.md) |
| 6 | **Tokens on new hosts** | Station 4/5 cannot claim | Copy approved token setup — never paste values into chat |
| 7 | **JUB OB auth** | JUB direct action | Stay on GSync packet path until gate cleared |
| 8 | **Duplicate loops** | Same profile on two machines | One loop per profile; document host in Station 4/5 SOP |

## What is unsafe (do not do)

- Two JOA loops claiming jobs against `C:\projects\TimOS-Agent` at the same time
- Nova or Finance jobs routed with `target_worker_profile: joa` and JOA workspace (unless explicit `bridge_fallback: JOA` with reason)
- Auto-starting NB, Finance, or JUB lanes without Tim approval and smoke test
- Treating registry `active` status as "hub is running" — **Active now** requires a live worker loop

## Job payload language (cross-room)

Every job must declare true origin and execution target:

```yaml
source_room: NovaBridge          # who originated (ChatGPT room)
active_lane: nova-dev            # lane id from registry
target_worker_profile: nova      # worker that claims
repo_ref: NovaUniverse
workspace_ref: C:\projects\NovaUniverse
requested_by: nova               # or room-specific id — not joa for NB work
```

JOA lane (unchanged):

```yaml
source_room: JOA
active_lane: joa-dev
target_worker_profile: joa
repo_ref: TimOS-Agent
workspace_ref: C:\projects\TimOS-Agent
requested_by: joa
```

Handoff packet for "can we start?": [`templates/command-channel/cross-room-readiness-packet.md`](../../templates/command-channel/cross-room-readiness-packet.md).

## Where to see capacity

| Surface | What it shows |
|---------|---------------|
| `GET /tower` | Motion + **Parallel lane capacity** table with readiness categories |
| `GET /tower/summary` | JSON including `lane_registry[].readiness_category` and `parallel_capacity` |
| `npm run status:tower` | CLI motion report with lane readiness summary |
| This doc | Full lane inventory and blockers |

See [`control-tower-motion-v0.md`](./control-tower-motion-v0.md) for route map.

## Activation sequence (per new parallel lane)

1. Tim approves lane move from ready-to-test → active after smoke test
2. Room Identity Card in target ChatGPT room
3. Start **one** worker loop for that profile (separate PowerShell window)
4. Create approved `inspect_only` job with correct `source_room`, `active_lane`, `workspace_ref`
5. Confirm job claims on **new** hub, not JOA loop (unless bridge fallback declared)
6. Verify no unintended file changes in target workspace
7. Update cross-room readiness packet for that room

**No runtime code activation in this v0 task** — operational steps only.

## Related

- [`room-lane-identity-v0.md`](./room-lane-identity-v0.md) — identity registry and smoke test
- [`control-tower-motion-v0.md`](./control-tower-motion-v0.md) — `/tower` motion and readiness UI
- [`station-45-worker-hub-v0.md`](./station-45-worker-hub-v0.md) — JOA host handoff off Station 1
- [`command-channel-repo-routing.md`](../command-channel-repo-routing.md) — routing policy
- [`no-paste-worker-loop-v0.md`](./no-paste-worker-loop-v0.md) — worker loop SOP
