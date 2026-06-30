# JUB Local Repo Init Decision v0

Phase 3C-15 records the decision packet for whether `C:\projects\JUB` should be initialized as a local-only Git repository.

**Status:** documentation only. This packet does not touch `C:\projects\JUB`, initialize any repository, add any remote, change registry configuration, change generated GPT Action schema, or alter runtime behavior.

## Decision Question for Tim

Should `C:\projects\JUB` be initialized as a local-only repo now?

## Recommendation

Likely yes: initialize `C:\projects\JUB` as a local-only repository to preserve the inert docs baseline and future extraction history.

Do not add a remote yet. Repo ownership, GitHub naming, branch policy, and remote destination should be decided separately before any remote is configured.

## Current Baseline

- `C:\projects\JUB` exists as an inert docs-first workspace.
- JUB remains shadow-only.
- No live registry profile `jub` exists.
- No GPT Action schema exposure exists for JUB.
- JUB registry dry-run passes.
- JUB currently has docs such as `README.md`, `docs\workspace-status.md`, `docs\non-live-guardrails.md`, `docs\extraction-map-placeholder.md`, and `docs\extraction-map-v0.md`.
- Worker writes to JUB may be blocked; Tim manual commands may be required.

## Manual Commands for Tim Later

These commands are for Tim to run manually later if he approves local-only initialization. They are not to be run automatically by workers during this packet.

```powershell
cd C:\projects\JUB
git init
git add README.md docs\*.md
git commit -m "Initialize inert JUB workspace docs"
git status --short
```

Do not add a remote.

## Pre-Init Checklist

Before Tim runs the manual commands:

- Inspect files under `C:\projects\JUB`.
- Ensure no protected-value files are present.
- Ensure no backend, runtime, or package files are present unless intentionally docs-only and separately approved.
- Confirm TimOS-Agent dry-run validation passes before initialization.
- Confirm the intended first snapshot includes only inert JUB docs.

## Post-Init Validation

After Tim runs the manual commands:

- `C:\projects\JUB` local repo status is clean.
- TimOS-Agent status is clean except for separately reviewed docs changes.
- JUB registry dry-run still passes.
- No live registry/profile/schema exposure exists for JUB.
- No remote is configured for JUB.

## No-Go Items

- No `git remote add`.
- No live routing.
- No backend runtime.
- No worker runtime.
- No TimFinance code copy.
- No protected-value files.
- No generated GPT Action schema exposure.
- No GPT UI changes.
- No deploy or release action.

## Separate Later Decision

A future branch/remote decision packet should be created as a separate later step. That packet should decide repository ownership, GitHub naming, default branch policy, allowed remotes, and when JUB is ready for remote publication.

## Safe Allowlist for This Packet

This Phase 3C-15 implementation is limited to:

- `docs/command-channel/jub-local-repo-init-decision-v0.md`

All other paths remain out of scope, including `C:\projects\JUB`, `config\juos-room-registry.json`, generated GPT Action schemas, GPT UI configuration, `C:\projects\TimFinance`, `C:\projects\JuCore`, backend code, worker runtime code, protected-value files, deployment files, and source-control write actions.
