# JUB Lane Contract and Registry Plan v0

Phase 3C-4 defines the JUB lane before any workspace creation, backend extraction, registry activation, or GPT Action schema change.

**Status:** documentation and planning only. JUB is not a valid command-channel execution target yet.

## Purpose

JUB is the planned hosted platform-operation layer for JuOS. Its future ownership boundary is:

| Area | JUB lane responsibility | Explicit non-goal |
|------|-------------------------|-------------------|
| Hosted platform operations | Own the hosted operational surface for JuOS command-channel and action services once extracted or assigned. | Not the local JOA worker runtime. |
| Command-channel backend | Own the hosted command-channel backend after a Tim-approved extraction or ownership move. | Not the Finance product domain. |
| GPT Actions backend | Own backend endpoints used by GPT Actions after route, token, and schema ownership are approved. | Not GPT UI configuration itself. |
| Profile routing and validation | Own registry-backed validation for JUB-owned hosted routes and profiles. | Not JuCore shared contracts or cross-repo shared libraries. |
| Registry coordination | Keep lane/profile/repo mappings visible before activation. | Not an implicit right to create `C:\projects\JUB`. |

JUB is not Finance product work, not JOA implementation identity, and not JuCore shared-contract ownership. JUB may coordinate with those lanes only through documented handoffs and approved registry entries.

## Current Transitional State

| Item | Current decision |
|------|------------------|
| JOA | Source of truth: `TimOS-Agent` at `C:\projects\TimOS-Agent`; worker profile `joa`. |
| Finance | Source of truth: `TimFinance` at `C:\projects\TimFinance`; worker profile `finance`. |
| OB alias | Legacy alias to TimFinance; remains there until deliberately retired. |
| JuCore | Source of truth: `JuCore` at `C:\projects\JuCore`; worker profile `jucore`. |
| GSync | Source of truth: `juos-knowledge-vault` at `C:\projects\juos-knowledge-vault`; worker profile `gsync`. |
| JUB | Documentation/coordination only; no real workspace and no valid worker profile yet. |

The hosted command-channel backend remains inside TimFinance for now. The `jub` profile is conceptual/planned unless a later validation task proves otherwise. The `ob` route must continue to be treated as a legacy TimFinance alias until Tim approves a retirement or migration plan.

Compact summary and diagnostics GPT Action operations are working in the current hosted setup; this doc does not change that setup.

## TimFinance Command-Channel Handling

`TimFinance-command-channel` is reference material only.

- It is not the source of truth for JUB.
- It must not be merged into JUB wholesale.
- It must not be reused as the base of a JUB repo without a separate inventory and approval.
- Any useful backend patterns must be listed as extraction candidates before code moves.
- TimFinance remains the temporary hosted location until ownership changes are approved.

## Prerequisites Before Creating `C:\projects\JUB`

Do not create `C:\projects\JUB` until all prerequisites below have an approved answer.

| Prerequisite | Required decision before creation |
|--------------|-----------------------------------|
| Clean target strategy | Decide whether JUB is a new repo, extracted repo, service-only repo, or documentation lane. Define initial path, remote naming, and migration boundary. |
| Registry entry | Add an approved registry row only after target repo/workspace/profile choices are known. |
| Backend validation support | Confirm backend accepts, rejects, and reports JUB route/profile payloads correctly before activation. |
| Worker profile route | Decide whether JUB needs a local worker profile, hosted-only role, or no worker route. |
| OpenAPI/GPT Action schema strategy | Decide whether JUB uses an existing generated JuOS schema, a separate schema, or no GPT Action exposure during setup. |
| Hosted service ownership | Decide when command-channel and GPT Actions backend ownership leaves TimFinance, if at all. |
| DB contract visibility | Document which tables, views, policies, and diagnostics JUB must see before it owns hosted operations. |

## Proposed Staged Sequence

1. **Inert contract docs** - Capture lane purpose, no-go items, and registry requirements in TimOS-Agent docs only.
2. **JUB workspace creation plan** - Write the path/repo/service strategy, including whether `C:\projects\JUB` is needed. See [`jub-workspace-creation-plan-v0.md`](./jub-workspace-creation-plan-v0.md).
3. **Registry/profile addition** - Add any `jub` room/profile entries only after Tim approves the target strategy.
4. **Backend extraction candidate inventory** - Inventory hosted command-channel, GPT Action, validation, schema, and DB contract files without moving code.
5. **Dry-run validation** - Prove inspect-only route/profile/schema behavior without file changes or production ownership changes.
6. **Final move after Tim approval** - Create/move/extract only after Tim approves the exact change set and rollback plan.

## Validation Checklist

Before JUB can become an active command-channel lane:

- [ ] Tim has approved the JUB target strategy.
- [ ] `C:\projects\JUB` creation is explicitly approved, if needed.
- [ ] Registry source of truth lists JUB with exact `repo_ref`, `workspace_ref`, and profile state.
- [ ] Backend validation can distinguish conceptual JUB from valid worker targets.
- [ ] Any `target_worker_profile: jub` route is rejected until activation is approved.
- [ ] OB alias behavior remains mapped to TimFinance or is retired by a separate approved task.
- [ ] OpenAPI/GPT Action schema exposure is documented before generation or import.
- [ ] Hosted service ownership and DB visibility boundaries are written down.
- [ ] Inspect-only dry run passes with no file changes in target workspaces.
- [ ] `scripts\juos-action-doctor.ps1` passes or has documented expected warnings.
- [ ] `scripts\juos-station-doctor.ps1 -ReportOnly` passes or has documented expected warnings.

## No-Go Items

- Do not create `C:\projects\JUB`.
- Do not route jobs to `target_worker_profile: jub`.
- Do not treat `requested_by: jub` or `source_room: JUB` as execution authorization.
- Do not move hosted backend code out of TimFinance.
- Do not edit generated OpenAPI schemas for JUB.
- Do not import or modify GPT UI Actions for JUB.
- Do not change registry JSON for JUB until the registry/profile addition stage is approved.
- Do not merge or copy `TimFinance-command-channel` wholesale.
- Do not change database schema, policies, tokens, env files, or protected values.
- Do not retire `ob` until a separate deliberate retirement task is approved.

## Decision Table

| Decision | Current answer | Next required approval |
|----------|----------------|------------------------|
| Is JUB a valid command-channel target today? | No. | Add profile/route only after registry and backend validation plan. |
| Should `C:\projects\JUB` exist now? | No. | Approve clean target strategy first. |
| Where does hosted command-channel live today? | TimFinance. | Approve extraction or ownership move. |
| Is `jub` a real worker profile? | Not yet; conceptual/planned. | Validate backend, hub need, registry entry, and profile route. |
| What is `ob` today? | Legacy alias to TimFinance. | Separate retirement or migration approval. |
| Can TimFinance-command-channel seed JUB? | Reference only. | Inventory candidates; no wholesale reuse. |
| Who owns Finance product behavior? | Finance lane. | No JUB claim without explicit boundary change. |
| Who owns JOA worker runtime? | JOA lane in TimOS-Agent. | JUB must not impersonate JOA. |
| Who owns JuCore contracts? | JuCore lane. | Shared contract changes require JuCore path/approval. |
| Can OpenAPI/GPT Action schema change now? | No. | Decide schema strategy first. |

## Safe Allowlist for This Phase

For Phase 3C-4, safe changes are limited to inert documentation under `docs/` that explains the JUB lane contract and links to existing coordination docs. Runtime files, backend code, generated schemas, registry JSON, GPT UI configuration, environment files, and external repositories are out of scope.

## Related

- [`room-lane-identity-v0.md`](./room-lane-identity-v0.md)
- [`jub-workspace-creation-plan-v0.md`](./jub-workspace-creation-plan-v0.md)
- [`parallel-lane-readiness-v0.md`](./parallel-lane-readiness-v0.md)
- [`../command-channel-repo-routing.md`](../command-channel-repo-routing.md)
- [`../command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml)
