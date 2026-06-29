# JUB Workspace Creation Plan v0

Phase 3C-5 defines the proposed `C:\projects\JUB` creation plan without creating the workspace, moving backend code, changing registry JSON, or changing hosted command-channel behavior.

**Status as of Phase 3C-13:** `C:\projects\JUB` now exists locally as an inert docs-first workspace created by manual Tim write. JUB remains non-executable and shadow-only: no `jub` worker profile, no live backend runtime, no worker runtime, no live registry route, and no GPT Action schema exposure.

See [`jub-workspace-access-boundary-v0.md`](./jub-workspace-access-boundary-v0.md) for the current baseline files, worker access boundary, manual-write protocol, and Phase 3C-13 allowlist.

## Phase 3C-10 Approval Packet

This packet is the required approval plan for a future inert `C:\projects\JUB` workspace creation job. It does not approve or perform creation by itself.

### Exact Tim Approval Question

Tim must answer this exact question before any workspace creation command is run:

> Do you approve creating `C:\projects\JUB` as an inert docs-first workspace only, with README/docs/lane-contract materials and no backend runtime, no worker runtime, no protected-value files, no live registry/profile/schema exposure, no TimFinance edits, no JuCore edits, no generated GPT Action schema edits, no GPT UI changes, no deploy actions, and no source-control commit/push?

Acceptable answer: an explicit yes approving the exact inert creation scope above. Any broader, ambiguous, or conditional answer requires a revised approval packet before proceeding.

### Pre-Create Checklist

All items must be true immediately before the future creation step:

- `TimOS-Agent` working tree is clean or contains only the approved creation-job documentation changes.
- `TimFinance` working tree state is understood and not touched.
- JuCore local-only commit note is acknowledged before any nearby contract or shared-boundary discussion.
- `scripts\juos-jub-registry-dry-run.ps1` passes, including fail-closed treatment of absent `C:\projects\JUB`.
- `C:\projects\JUB` is absent.
- Tim has approved the exact question in this packet for the current job.

### Proposed Commands - Do Not Run Yet

The following commands are proposed for the future approved creation job only. They are not part of Phase 3C-10 and must not be run until Tim approves the exact approval question above.

```powershell
# Future approved job only - do not run during planning.
Test-Path C:\projects\JUB
New-Item -ItemType Directory -Path C:\projects\JUB
New-Item -ItemType Directory -Path C:\projects\JUB\docs
Set-Location C:\projects\JUB
git init
New-Item -ItemType File -Path README.md
New-Item -ItemType File -Path docs\lane-contract.md
New-Item -ItemType File -Path docs\hosted-ownership-boundary.md
New-Item -ItemType File -Path docs\validation-gates.md
git status --short
```

If `C:\projects\JUB` already exists, stop instead of reusing, deleting, or overwriting it.

### Initial Workspace Contents

The approved inert workspace should contain only:

- `README.md` describing JUB as an inert docs-first platform-operations workspace.
- `docs\` for planning and validation documents.
- A lane contract copy or pointer to `C:\projects\TimOS-Agent\docs\command-channel\jub-lane-contract-v0.md`.
- No backend runtime.
- No worker runtime.
- No protected-value files.
- No generated GPT Action schema treated as source of truth.
- No deployment scripts, service start scripts, DB migrations, env files, tokens, or credential material.

### Post-Create Inert Validation Checklist

Run these checks after the future approved inert creation job:

- `git status --short` in `C:\projects\TimOS-Agent` shows only approved planning or creation-job docs changes.
- `git status --short` in `C:\projects\JUB` shows only the expected new inert docs scaffold.
- `scripts\juos-jub-registry-dry-run.ps1` still passes from `C:\projects\TimOS-Agent`.
- No live registry profile, worker profile, backend validator, or generated GPT Action schema exposes `jub`.
- Existing command-channel operations for `joa`, `finance`, `ob`, `jucore`, `gsync`, `nova`, `spacea`, and `ministry` still work as before.
- No TimFinance, JuCore, backend, registry, generated schema, GPT UI, protected-value, deploy, or release files were touched.

### Stop Conditions and No-Go Items

Stop before or during the future creation job if any condition is true:

- Tim has not explicitly approved the exact approval question in this packet.
- `C:\projects\JUB` already exists.
- `TimOS-Agent` has unexplained or unrelated working tree changes.
- `TimFinance` would need to be edited, cleaned, committed, or otherwise changed.
- JuCore local-only commit context is not acknowledged where shared contracts are discussed.
- `scripts\juos-jub-registry-dry-run.ps1` fails for any reason other than the expected documented fail-closed absent-workspace behavior.
- Any step requires changes to `config\juos-room-registry.json`, worker code, backend code, generated GPT Action schema, GPT UI configuration, protected-value files, deployment settings, DB schema, tokens, or release state.
- A proposed file would make `jub` claimable, executable, schema-visible, or treated as a live worker profile.
- A credential value would need to be read, copied, documented, or printed.

### Next Jobs After Approved Workspace Creation

After the approved inert creation job, the next jobs should be:

1. Maintain the inert `C:\projects\JUB` docs baseline through manual Tim writes unless worker workspace permissions are explicitly changed later.
2. Build an inventory extraction map from TimFinance into JUB docs, inspect-only unless Tim separately approves edits.
3. Classify dependencies and ownership boundaries for future extraction candidates.
4. Add a shadow registry candidate file only if Tim explicitly approves that file, location, shape, and validation behavior.

## Recommended Creation Strategy

| Option | Decision | Rationale |
|--------|----------|-----------|
| Empty/new repo at `C:\projects\JUB` | **Recommended, after Tim approval** | Gives JUB a clean platform-operations boundary without inheriting Finance product code, old experiments, generated schemas, or protected runtime assumptions. |
| Copy subset from TimFinance | Reject for initial creation | TimFinance currently hosts command-channel backend pieces, but it also owns Finance product behavior. Copying subsets before inventory risks moving product files, credentials assumptions, or stale service boundaries. |
| Copy or merge `TimFinance-command-channel` | Reject for initial creation | That workspace is reference-only and not source of truth. Useful patterns must be inventoried as candidates, not copied wholesale. |
| Scaffold from JuCore/TimFinance docs | Use as documentation input only | JuCore can inform shared contract boundaries and TimFinance can inform extraction candidates, but JUB should start as an inert docs-first repo, not as a mixed scaffold. |

Recommended creation strategy: create `C:\projects\JUB` later as an empty/new repo with docs-first content, then add extracted backend runtime only after a separate Tim-approved extraction gate passes. The initial repo should be inert: it may describe hosted ownership, contracts, and validation plans, but it must not run or deploy command-channel services.

## Source Inventory Required Before Creation

Complete this inventory before any `C:\projects\JUB` directory is created.

| Inventory area | Source today | Required output |
|----------------|--------------|-----------------|
| Hosted command-channel backend files | `C:\projects\TimFinance` | Exact list of API routes, server modules, validation helpers, DB access helpers, deployment config references, tests, and docs that currently implement or support hosted command-channel behavior. Mark each item as extract, duplicate as reference, leave in Finance, or discard. |
| GPT Action schema/docs | `C:\projects\TimOS-Agent` | Exact list of current OpenAPI schema files and bridge docs, including `docs/openapi/*command-channel.openapi.yaml`, `docs/bridge/xiaoju-command-channel.md`, and command-channel routing docs. Mark generated schemas as reference-only until schema ownership is approved. |
| Shared contract candidates | `C:\projects\JuCore` plus TimOS-Agent docs | Candidate schemas, type definitions, route contracts, status packet formats, lane/profile vocabulary, and DB contract docs that should belong in JuCore instead of JUB. |
| Worker/runtime pieces | `C:\projects\TimOS-Agent` | JOA-owned scripts, worker hubs, local polling/runtime code, status tooling, doctor scripts, and local workspace validators that must remain in JOA unless a separate worker-runtime extraction is approved. |
| Finance product exclusions | `C:\projects\TimFinance` | Explicit denylist of Finance product app code, UI, domain models, product routes, finance-specific DB objects, finance docs, and finance deployment settings that must not be copied into JUB. |

The inventory must include file paths, ownership decision, reason, and required approval for each extraction candidate. It must not include credential values.

## Proposed Initial JUB Workspace Contents

Initial `C:\projects\JUB` contents, if Tim approves creation:

```text
C:\projects\JUB\
  README.md
  docs\
    lane-contract.md
    hosted-ownership-boundary.md
    command-channel-extraction-inventory.md
    gpt-action-schema-strategy.md
    registry-profile-plan.md
    validation-gates.md
  package.json                 # optional; only if needed for docs lint/check scripts
  scripts\
    validate-docs.ps1           # optional inert docs validation only
```

Initial contents must not include:

- Live backend runtime routes or server entrypoints.
- Generated OpenAPI schema copies treated as source of truth.
- GPT UI configuration.
- Registry JSON changes.
- Worker hub code or JOA runtime scripts.
- TimFinance product source.
- Environment files, tokens, deployment config with secrets, or protected values.

Minimal package/tooling is optional and should be added only if there is a concrete docs validation command. No service start script, deploy script, DB migration, queue worker, or hosted API runtime should exist until the extraction gate passes.

## Registry and Profile Plan

Initial state must remain unchanged:

- `JUB` is documentation/coordination only.
- `C:\projects\JUB` exists locally as an inert docs-first workspace after explicit Tim approval and manual Tim write.
- `target_worker_profile: jub` is invalid and must continue to be rejected.
- `requested_by: jub` or `source_room: JUB` remains audit/handoff metadata only, not routing authorization.
- `finance` continues to route to `TimFinance`.
- `ob` remains a legacy alias to TimFinance.
- Hosted command-channel backend remains in TimFinance.
- `TimFinance-command-channel` remains reference-only.

Eventual registry/profile changes, after separate approval:

| Future entry | Possible value | Gate |
|--------------|----------------|------|
| `repo_ref` | `JUB` | Tim-approved workspace creation and source inventory complete. |
| `workspace_ref` | `C:\projects\JUB` | Local directory exists as inert repo and passes post-create checks. |
| `active_lane` | `jub-coordination` or successor lane id | Room/lane identity card reviewed and accepted. |
| `target_worker_profile` | none initially; possible `jub` later | Backend validation, worker need, hub startup plan, and smoke test approved. |
| Action schema exposure | existing JuOS schema, separate JUB schema, or no direct Action | Schema strategy approved before generation/import. |

Preserving Finance and OB aliases:

- Do not change `finance` profile mapping while JUB is created.
- Do not retire or redirect `ob` as part of JUB workspace creation.
- If `ob` is ever retired or remapped, handle it as a separate migration with Tim approval, compatibility notes, rollback, and no implied Finance behavior change.

## Validation Gates

### Pre-create checks

- Confirm no `C:\projects\JUB` directory exists.
- Confirm Tim has approved the exact creation job and allowlist.
- Confirm source inventory is complete and reviewed.
- Confirm no TimFinance files are being touched.
- Confirm no registry JSON, generated OpenAPI schema, GPT UI, protected-value files, or backend code are in scope.
- Run current TimOS-Agent checks: `scripts\juos-action-doctor.ps1` and `scripts\juos-station-doctor.ps1 -ReportOnly`.

### Post-create inert checks

- Confirm `C:\projects\JUB` contains docs and optional docs-only tooling only.
- Confirm no server entrypoint, live API route, deploy command, DB migration, queue worker, or worker hub exists.
- Confirm no generated schema is copied as source of truth.
- Confirm no credential-bearing files exist.
- Confirm `git status --short` in TimOS-Agent only shows approved docs changes for the planning job.

### No hosted behavior change checks

- Confirm hosted command-channel endpoints still resolve from current TimFinance-owned backend.
- Confirm compact summary and diagnostics Action behavior is unchanged.
- Confirm no deployment, environment, DB schema, token, or policy changes occurred.
- Confirm `TimFinance-command-channel` was not edited or promoted.

### GPT Action schema checks

- Confirm generated OpenAPI schema files in TimOS-Agent were not edited.
- Confirm any JUB schema strategy is documented only.
- Confirm no GPT UI Action import or configuration change occurred.
- Confirm future schema ownership is gated before generation or import.

### Worker routing checks

- Confirm `target_worker_profile: jub` remains invalid until activation.
- Confirm `requested_by: jub` and `source_room: JUB` do not bypass routing validation.
- Confirm `joa`, `finance`, `jucore`, `gsync`, `nova`, `spacea`, and `ministry` behavior is unchanged.
- Confirm `finance` and `ob` still resolve to TimFinance semantics.

## Rollback and No-Go Rules

Stop immediately if any of these are true:

- The job requires creating `C:\projects\JUB` without explicit Tim approval.
- Source inventory cannot distinguish backend extraction candidates from Finance product files.
- Any required step needs TimFinance edits, backend edits, generated schema edits, GPT UI changes, registry JSON changes, protected-value files, or release actions.
- A proposed change would make `jub` a valid worker profile before backend validation and smoke tests.
- A proposed change would redirect `finance` or `ob`.
- A credential value would need to be read, copied, documented, or exposed.

Files and repos not to touch during planning:

- `C:\projects\JUB`
- `C:\projects\TimFinance`
- `C:\projects\TimFinance-command-channel`
- Backend code in any repo
- Generated OpenAPI schema files
- GPT UI configuration
- Registry JSON
- Environment, token, secret, or protected-value files
- Deployment or release configuration

Approval points requiring Tim:

1. Approval to create `C:\projects\JUB`.
2. Approval of the source inventory and extraction candidate list.
3. Approval of any registry/profile addition.
4. Approval of any schema generation or GPT Action import.
5. Approval of any backend extraction from TimFinance.
6. Approval of any hosted service ownership move.
7. Approval of any `ob` alias retirement or remapping.

Rollback for an approved inert creation is deletion of the new inert `C:\projects\JUB` workspace before any runtime, registry, schema, hosted, or DB changes exist. Once runtime extraction begins, rollback must be defined by that separate extraction job.

## Next Job Breakdown

### Job 1: Inventory TimFinance backend extraction candidates

Scope: inspect-only inventory of TimFinance hosted command-channel implementation. Output a path-by-path extraction matrix with ownership decision, dependencies, tests, and Finance product exclusions. Do not edit TimFinance.

### Job 2: Draft inert JUB repo scaffold plan

Scope: create a file-by-file scaffold proposal for `C:\projects\JUB`, including README outline, docs list, optional docs tooling, and no-runtime verification checklist. Do not create the workspace.

### Job 3: Add registry dry-run validation only

Scope: propose or implement Tim-approved dry-run validation that can prove `JUB`/`jub` payload behavior without adding active registry entries. It must preserve `finance` and `ob`, reject `target_worker_profile: jub`, and avoid generated schema or hosted behavior changes.

## Safe Allowlist for Phase 3C-5

Safe changes are limited to inert documentation under `docs/command-channel/` and narrow cross-links from existing docs. Do not modify runtime code, backend code, generated OpenAPI schemas, registry JSON, GPT UI configuration, environment files, protected-value files, external repositories, or deployment settings.

## Safe Allowlist for Phase 3C-13

Safe changes are limited to TimOS-Agent documentation that records the current JUB state and access boundary. Future JUB-side edits are manual-write only unless workspace permissions are later changed under a separate approval.

Current allowed JUB planning work:

- Docs/status inventory.
- Extraction maps.
- Dependency classification.

Current no-go items:

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No TimFinance code copy.
- No protected-value files.
- No backend runtime or worker runtime until a separate approval gate.

## Related

- [`jub-lane-contract-v0.md`](./jub-lane-contract-v0.md)
- [`jub-registry-dry-run-plan-v0.md`](./jub-registry-dry-run-plan-v0.md)
- [`jub-workspace-access-boundary-v0.md`](./jub-workspace-access-boundary-v0.md)
- [`room-lane-identity-v0.md`](./room-lane-identity-v0.md)
- [`../command-channel-repo-routing.md`](../command-channel-repo-routing.md)
- [`../command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml)
