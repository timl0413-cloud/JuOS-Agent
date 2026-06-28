# JUB Registry Dry-Run Validation Plan v0

Phase 3C-8 defines how a future JUB profile/workspace addition must be validated before any live registry, runtime, backend, schema, or GPT Action change.

**Status:** documentation and planning only. `jub` is not a valid command-channel execution target, `C:\projects\JUB` does not exist, and live routing remains unchanged.

## Current Immutable Routing Baseline

The current live registry source is `config/juos-room-registry.json`. For this phase, these mappings are immutable:

| Profile | repo_ref | workspace_ref | Baseline rule |
|---------|----------|---------------|---------------|
| `joa` | `TimOS-Agent` | `C:\projects\TimOS-Agent` | JOA work stays in TimOS-Agent. |
| `finance` | `TimFinance` | `C:\projects\TimFinance` | Finance work stays in TimFinance. |
| `ob` | `TimFinance` | `C:\projects\TimFinance` | OB remains a legacy TimFinance alias. |

Other existing registry profiles must also remain unchanged during JUB dry-run planning: `gsync`, `jucore`, `stuf`, and `nova`. The current backend contract in `lib/command-channel-core.js` does not include `jub` in `ALLOWED_WORKER_PROFILES`, and the generated GPT Action schema must continue to omit `jub` until a separate approved activation task.

Room identity is not execution authority. `requested_by: jub`, `source_room: JUB`, or `active_lane: jub-coordination` may describe coordination context, but they must not make a job claimable by a JUB worker.

## Proposed Dry-Run Model

The future dry-run should use a **shadow registry entry**: a candidate `jub` mapping stored outside the live `profiles` object or passed to a validation-only command. It must be readable by dry-run tooling but invisible to worker hubs, backend live validators, claim routes, and generated schema operations.

Candidate shape:

```json
{
  "profile": "jub",
  "repo_ref": "JUB",
  "workspace_ref": "C:\\projects\\JUB",
  "status": "shadow",
  "live_claim_enabled": false,
  "schema_exposed": false
}
```

Dry-run principles:

- No live claim route exists for `target_worker_profile: jub` until workspace creation, validator support, worker startup safety, backend compatibility, and schema strategy all pass.
- Validation must fail closed while `C:\projects\JUB` is absent. A missing workspace is a blocker, not a warning, for any proposed active or dry-run executable JUB entry.
- The shadow entry must not be loaded by `scripts\start-juos-worker-hub.ps1` or `scripts\start-worker-hubs.ps1` as a live hub profile.
- The dry-run may prove that a future entry is structurally valid, but it must still prove that live job creation rejects `target_worker_profile: jub` until activation is separately approved.
- Finance and OB mappings are not part of the JUB experiment and must remain mapped to TimFinance.

## Exact Dry-Run Checks

| Check area | Required check | Expected Phase 3C-8 result |
|------------|----------------|----------------------------|
| Registry shape | Candidate has exactly one profile id, `repo_ref`, `workspace_ref`, status, and explicit non-live flags. It is not inside live `profiles` unless activation is approved. | Pass only as documentation or validation input. |
| Workspace existence | `Test-Path C:\projects\JUB` is checked before any worker or claim validation. | Fail closed today because the workspace is absent. |
| Profile-to-repo consistency | `profile=jub`, `repo_ref=JUB`, and `workspace_ref=C:\projects\JUB` must match exactly after path normalization. | Candidate only; no live acceptance. |
| Worker startup refusal/safety | Hub startup must not start a `jub` loop from a shadow entry. If a future script sees a candidate with missing workspace or `live_claim_enabled=false`, it must skip or fail before claiming. | No worker code change in this phase. |
| Backend validator compatibility | Live create-job validation must reject `target_worker_profile: jub` until `ALLOWED_WORKER_PROFILES`, profile task types, repo/workspace contract, and hosted validators are intentionally updated together. | `jub` remains rejected. |
| GPT Action schema impact | `scripts\juos-action-doctor.ps1` should verify generated schema enums match live profiles. Shadow JUB must not appear in `docs/openapi/juos-actions.generated.openapi.yaml`. | No schema generation or GPT UI import. |
| Existing route preservation | `joa`, `finance`, and `ob` resolve to their current workspaces. | Required pass. |
| Command-channel profile expectations | `requested_by` and `source_room` remain audit metadata. Execution is controlled by `target_worker_profile`, `repo_ref`, and `workspace_ref`. | Required pass. |

## Future Sequence

1. Add this doc-only dry-run plan in TimOS-Agent.
2. After explicit Tim approval, create an inert `C:\projects\JUB` workspace with docs-only contents. Do not add runtime, deploy, DB, schema, token, or worker files.
3. Add registry dry-run mode in a separate approved implementation. It should read either a shadow candidate file or explicit candidate arguments, never mutate `config/juos-room-registry.json` by default. Phase 3C-9 adds `scripts\juos-jub-registry-dry-run.ps1` for this report-only validation.
4. Validate the shadow JUB candidate without live routing:
   - registry shape passes
   - workspace exists
   - `repo_ref` and `workspace_ref` match the candidate
   - live backend still rejects `target_worker_profile: jub`
   - worker hubs do not claim JUB work
   - generated schema still omits `jub`
   - `joa`, `finance`, and `ob` behavior is unchanged
5. Add a live `jub` profile only after a separate approval that names the exact registry change, backend validator change, worker startup behavior, schema strategy, tests, rollback, and owner.

## No-Go Items

- Do not change `config/juos-room-registry.json` for JUB in this phase.
- Do not create `C:\projects\JUB`.
- Do not add `jub` to `ALLOWED_WORKER_PROFILES`, profile task types, worker launch defaults, or generated OpenAPI enums.
- Do not route or claim jobs with `target_worker_profile: jub`.
- Do not redirect `joa`, `finance`, or `ob`.
- Do not move hosted command-channel backend ownership out of TimFinance.
- Do not touch TimFinance, JuCore, generated OpenAPI schema, GPT UI Action configuration, deployment settings, DB schema, tokens, env files, or protected values.
- Do not treat JUB room identity as permission to execute local worker tasks.

## Stop Conditions

Stop the future dry-run or activation task if any condition is true:

| Condition | Stop reason |
|-----------|-------------|
| `C:\projects\JUB` is absent when validating an executable JUB profile | Missing workspace must fail closed. |
| The candidate entry would be loaded by a live worker hub | Shadow validation would become live routing. |
| Backend accepts `target_worker_profile: jub` before activation approval | Validator opened a live route too early. |
| Generated schema exposes `jub` before schema approval | GPT Action could submit unsupported routes. |
| `finance` or `ob` changes away from TimFinance | JUB work is affecting unrelated live routing. |
| A step requires TimFinance, JuCore, backend, protected-value, GPT UI, deploy, or DB edits | Out of scope for dry-run planning. |
| A credential value must be read, copied, documented, or printed | Security boundary violation. |

## Decision Table

| Decision | Current answer | Future activation requirement |
|----------|----------------|-------------------------------|
| Is `jub` a valid worker profile today? | No. | Separate approval plus registry, backend, worker, and schema validation. |
| Should JUB be added to live registry now? | No. | Dry-run tooling and inert workspace must exist first. |
| Can a shadow JUB entry be documented? | Yes. | It must remain outside live routing and schema exposure. |
| Should validation pass while `C:\projects\JUB` is absent? | No. | Missing workspace is a blocker for executable validation. |
| Should live backend accept JUB during dry-run? | No. | Acceptance only after activation approval. |
| Should GPT Action schema include JUB during dry-run? | No. | Schema strategy and import require separate approval. |
| Can JUB inherit Finance or OB routing? | No. | Finance and OB stay TimFinance unless separately migrated. |
| Can JUB use JOA worker runtime identity? | No. | JUB must have its own approved profile or remain coordination-only. |
| Can JuCore contracts be changed for JUB here? | No. | JuCore changes require a separate JuCore-scoped approval. |

## Safe Allowlist for Phase 3C-8

Allowed changes for this phase are limited to inert documentation under `docs/command-channel/`. Validation commands may be run from `C:\projects\TimOS-Agent` without modifying files.

Disallowed files and locations include `config/juos-room-registry.json`, worker code, backend code, generated OpenAPI files, GPT UI configuration, protected-value files, `C:\projects\JUB`, `C:\projects\TimFinance`, and `C:\projects\JuCore`.

## Safe Allowlist for Phase 3C-9

Allowed changes for Phase 3C-9 are limited to:

- `scripts\juos-jub-registry-dry-run.ps1`
- `docs\command-channel\jub-registry-dry-run-plan-v0.md`

The dry-run script reads the live registry and generated GPT Action schema, validates a shadow JUB candidate in memory, and exits without writing registry, schema, worker, backend, GPT UI, protected-value, or external workspace files.

## Validation Commands

Run these after dry-run tooling or doc updates:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Expected interpretation:

- JUB dry-run should pass only when `joa`, `finance`, and `ob` still match the immutable baseline; `jub` is absent from the live registry and generated action schema; the candidate is `status=shadow`; `live_claim_enabled` and `schema_exposed` are false; and `C:\projects\JUB` absence is treated as a fail-closed non-executable route.
- Action doctor should pass with no `jub` enum required because `jub` is not live.
- Station doctor should remain report-only and should not check `C:\projects\JUB` until a future dry-run candidate is intentionally supplied.
- Git status should show only approved Phase 3C-9 script and documentation changes.

Optional explicit candidate arguments:

```powershell
scripts\juos-jub-registry-dry-run.ps1 `
  -CandidateProfile jub `
  -CandidateRepoRef JUB `
  -CandidateWorkspaceRef C:\projects\JUB `
  -CandidateStatus shadow
```

Do not pass `-LiveClaimEnabled` or `-SchemaExposed` during dry-run. Either flag is a failure because it would make the candidate claimable or visible to GPT Action schema expectations before activation approval.

## Related

- [`jub-lane-contract-v0.md`](./jub-lane-contract-v0.md)
- [`jub-workspace-creation-plan-v0.md`](./jub-workspace-creation-plan-v0.md)
- [`backend-validation-alignment-plan.md`](./backend-validation-alignment-plan.md)
- [`room-lane-identity-v0.md`](./room-lane-identity-v0.md)
- [`../command-channel-repo-routing.md`](../command-channel-repo-routing.md)
