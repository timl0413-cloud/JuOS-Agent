# JUB Workspace Creation Plan v0

Phase 3C-5 defines the proposed `C:\projects\JUB` creation plan without creating the workspace, moving backend code, changing registry JSON, or changing hosted command-channel behavior.

**Status:** planning and documentation only. JUB remains non-executable: no local workspace, no `jub` worker profile, no live backend runtime, and no GPT Action schema change.

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
- `C:\projects\JUB` does not exist until explicit Tim approval.
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

## Related

- [`jub-lane-contract-v0.md`](./jub-lane-contract-v0.md)
- [`jub-registry-dry-run-plan-v0.md`](./jub-registry-dry-run-plan-v0.md)
- [`room-lane-identity-v0.md`](./room-lane-identity-v0.md)
- [`../command-channel-repo-routing.md`](../command-channel-repo-routing.md)
- [`../command-channel-room-capabilities.yaml`](../command-channel-room-capabilities.yaml)
