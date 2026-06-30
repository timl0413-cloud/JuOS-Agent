# JuCore Remote Ownership Decision v0

Phase 3C-20 records the decision packet for whether the local JuCore workspace should receive a remote before more shared command-channel contract work accumulates only on one machine.

**Status:** documentation only. This packet does not touch `C:\projects\JuCore`, add any remote, run any remote command, change registry configuration, change generated GPT Action schema, alter GPT UI configuration, change backend code, change worker runtime code, alter protected-value files, commit, push, deploy, or release.

## Current JuCore State

| Item | Current note |
|------|--------------|
| Local repo path | `C:\projects\JuCore` |
| Known local commit context | TimOS-Agent planning docs record JuCore shared command-channel contract material at local commit `627de9c`. This must be verified inside JuCore before any remote work because this packet does not inspect or touch `C:\projects\JuCore`. |
| Remote state | TimOS-Agent planning docs record that JuCore has no configured remote. Verify with `git remote -v` inside JuCore before any remote decision is executed. |
| Important local content | Shared command-channel contract docs and command-channel package layout docs are recorded as local JuCore materials. Inspect the exact docs before any publication. |
| Mixing risk | Unrelated local GSync changes may exist and must not be mixed with JuCore command-channel contract docs or remote setup work. |

## Decision Question for Tim

Should `C:\projects\JuCore` get a remote now, and if yes, under what repository name and owner?

The decision should name the GitHub owner or organization, the repository name, the intended default branch, and whether the first remote snapshot contains only reviewed JuCore shared-contract/package-layout materials.

## Options

| Option | What it means | Benefits | Risks / blockers | When to choose |
|--------|---------------|----------|------------------|----------------|
| Keep local-only for now | Leave JuCore without a configured remote. | No publication risk; avoids mixing unrelated local work. | Shared contracts continue to accumulate only locally; recovery and cross-room handoff remain weak. | Choose if JuCore status is unclear or unrelated GSync work cannot yet be separated. |
| Create GitHub remote named `JuCore` | Create or attach a remote repository named `JuCore` under Tim-approved ownership. | Gives shared contracts durable history and a clear repo identity. | Requires clean inventory, protected-value check, owner/name approval, and explicit remote command approval. | Choose after JuCore status is reviewed and only intended docs/package-layout files are staged or committed. |
| Fold into another JuOS mono-repo later | Do not create a standalone JuCore remote; reserve contracts for a future JuOS mono-repo. | May reduce repo sprawl if JuOS consolidates platform contracts later. | Delays durable remote history; may blur contract ownership with runtime/backend repos. | Choose if Tim wants a single platform repo and accepts local-only JuCore risk until then. |
| Defer pending GSync ownership cleanup | Pause remote setup until GSync/JuCore local ownership boundaries are cleaned up. | Reduces chance that GSync-local changes leak into JuCore contract publication. | Keeps JuCore unbacked by a remote for longer. | Choose if `git status --short` shows unrelated GSync or mixed-domain files in JuCore. |

## Recommendation

Likely create or attach a JuCore remote, but only after the local JuCore status is cleanly inventoried and unrelated GSync changes are separated.

Do not mix command-channel contract docs with unrelated GSync work. The first remote snapshot should be a reviewed JuCore-only baseline: shared command-channel contracts, package layout docs, and any directly supporting docs that Tim approves.

## Manual Approval Gates

- Tim approves the repository owner and exact repo name.
- Tim reviews local JuCore status before any remote is added.
- Tim confirms the intended files contain no protected-value files, token material, environment files, credentials, local auth files, deploy secrets, or machine-only state.
- Tim approves the exact `git remote add ...` command before it is run.
- Tim approves any initial branch naming or branch rename before it is run.
- Tim approves the first push separately from remote creation.

## Validation Checklist Before Any Remote Work

Run these inside `C:\projects\JuCore` only after a separate JuCore-scoped approval permits inspecting that workspace:

```powershell
git status --short
git log --oneline -5
git remote -v
```

Also inspect the relevant docs files, including the shared command-channel contract docs and package layout docs. Confirm no protected-value files are staged or present in the intended initial snapshot.

Expected interpretation:

- `git status --short` shows either a clean tree or only reviewed JuCore-owned docs changes.
- `git log --oneline -5` confirms the local commit sequence and whether `627de9c` is still the relevant local commit note.
- `git remote -v` confirms no remote exists, or identifies any existing remote that Tim must approve before use.
- Docs inspection confirms the first publication is contract/package-layout material only.
- Protected-value scan confirms no secrets, env files, auth files, generated credential material, or deploy-only files are staged.

## Repo Relationship Boundaries

| Repo / lane | Relationship to JuCore |
|-------------|------------------------|
| JuCore | Candidate owner for shared command-channel contracts, route/profile vocabulary, status/completion packet shapes, package layout docs, and later cross-repo contract materials. |
| JUB | Local-only inert docs-first repo today. Future owner candidate for hosted platform-operation/backend extraction, but not the current home of shared contract docs. |
| TimFinance | Current live hosted command-channel backend owner. JuCore is not the hosted backend and must not receive TimFinance runtime or protected-value material by copy. |
| TimOS-Agent | Current JOA worker/runtime owner and GPT Action schema tooling owner. JuCore is not the worker runtime and not the GPT Action UI configuration source. |
| GSync | Knowledge-continuity and direct development lane. GSync ownership cleanup must stay separate from JuCore command-channel contract publication. |

## No-Go Items

- No edits to `C:\projects\JuCore` from this TimOS-Agent-scoped packet.
- No remote commands.
- No `git remote add` without Tim approving the exact command.
- No commit, push, release, deploy, or source-control write action.
- No changes to `config\juos-room-registry.json`.
- No generated GPT Action schema changes.
- No GPT UI changes.
- No TimFinance edits.
- No JUB edits.
- No backend code changes.
- No worker runtime code changes.
- No protected-value files, token files, environment files, credentials, local auth files, deploy secrets, or DB secrets.
- No mixing command-channel contract docs with unrelated GSync work.

## Next Recommended Jobs After Decision

1. JuCore local inventory packet: inspect `git status --short`, `git log --oneline -5`, `git remote -v`, and relevant docs; report without modifying files.
2. JuCore protected-value and snapshot review: identify the exact files eligible for the first remote baseline.
3. JuCore remote command approval packet: propose owner, repo name, remote URL, default branch, and exact manual commands for Tim approval.
4. JUB remote and ownership decision packet: decide whether JUB remains local-only or receives its own remote after JuCore ownership is resolved.
5. Shared-contract extraction plan: decide which TimOS-Agent/TimFinance/JUB docs should later move or be mirrored into JuCore, without copying runtime or protected-value material.

## Safe Allowlist for This Packet

Allowed change:

- `docs\command-channel\jucore-remote-ownership-decision-v0.md`

Allowed validation commands from `C:\projects\TimOS-Agent`:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Everything else is out of scope for Phase 3C-20 unless a later approved job expands the scope.
