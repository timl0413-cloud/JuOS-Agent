# JUB Workspace Access Boundary v0

Phase 3C-13 records the current `C:\projects\JUB` state after inert workspace creation and the local access boundary observed from TimOS-Agent worker control sessions.

**Status:** documentation only. `C:\projects\JUB` exists locally as an inert, shadow-only, docs-first workspace. It has no backend runtime, no worker runtime, no live registry route, and no GPT Action schema exposure.

## Current JUB Baseline

`C:\projects\JUB` currently contains these manually created baseline files:

```text
C:\projects\JUB\
  README.md
  docs\
    workspace-status.md
    non-live-guardrails.md
    extraction-map-placeholder.md
```

The baseline is intentionally non-executable:

- No hosted backend runtime.
- No local worker runtime.
- No `jub` profile in `config\juos-room-registry.json`.
- No generated GPT Action schema enum or path exposure for `jub`.
- No protected-value files, tokens, environment files, deploy scripts, DB migrations, or service start scripts.

## Worker Access Boundary

Workers operating from a TimOS-Agent control session may not be able to write inside `C:\projects\JUB`. The observed Phase 3C boundary blocked worker writes to JUB, so Tim performed the initial inert file creation manually.

Until workspace permissions are explicitly changed later, future workers must treat `C:\projects\JUB` as a manual-write target. Do not assume that a TimOS-Agent worker can create, edit, delete, or move files in JUB.

## Manual-Write Protocol

When a future approved JUB docs update requires files inside `C:\projects\JUB`, the worker should give Tim exact file paths and exact commands or content blocks, then validate from `C:\projects\TimOS-Agent`.

Template for Tim-directed manual commands:

```powershell
Set-Location C:\projects\JUB

# Example only: replace paths and content with the approved file list for the job.
New-Item -ItemType Directory -Force -Path docs
Set-Content -Path docs\<approved-file>.md -Value @'
<approved content>
'@

git status --short
```

After Tim completes the manual write, rerun these from `C:\projects\TimOS-Agent`:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Interpretation:

- JUB registry dry-run must confirm JUB remains shadow-only and non-live.
- Action doctor must confirm generated GPT Action schema remains aligned with live profiles and does not expose `jub`.
- Station doctor should be rerun when the change could affect station or route status reporting; use `-ReportOnly`.
- `git status --short` in TimOS-Agent must remain clean or show only the approved TimOS-Agent documentation files for the active job.

## Future Allowed Work

Allowed future JUB work remains limited to documentation and inventory unless a separate approval gate changes scope:

- Docs/status inventory.
- Extraction maps.
- Dependency classification.
- Guardrail and validation notes that keep JUB shadow-only.

## No-Go Items

Do not perform any of these under the current boundary:

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No TimFinance code copy into JUB.
- No protected-value files, tokens, secrets, or environment files.
- No backend runtime until a separate approval gate names the exact runtime scope, validation, rollback, and owner.
- No worker runtime or hub startup path for `jub`.
- No changes to TimFinance, JuCore, generated OpenAPI schemas, GPT UI Action configuration, deployment settings, DB schema, or release state.

## Safe Allowlist for Phase 3C-13

Allowed TimOS-Agent changes for Phase 3C-13 are limited to inert documentation under `docs\command-channel\` and narrow status cross-links from existing docs.

Allowed JUB state remains the existing manual docs baseline only. Any future JUB file changes must follow the manual-write protocol unless worker workspace permissions are explicitly changed and approved later.

## Related

- [`jub-workspace-creation-plan-v0.md`](./jub-workspace-creation-plan-v0.md)
- [`jub-registry-dry-run-plan-v0.md`](./jub-registry-dry-run-plan-v0.md)
- [`jub-lane-contract-v0.md`](./jub-lane-contract-v0.md)
- [`../command-channel-repo-routing.md`](../command-channel-repo-routing.md)
