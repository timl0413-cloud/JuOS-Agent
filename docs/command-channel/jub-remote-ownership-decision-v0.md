# JUB Remote Ownership Decision v0

Phase 3C-28 updates the Phase 3C-27 decision packet after Tim completed the approved remote setup for the inert JUB workspace.

**Status:** documentation only. This packet does not touch `C:\projects\JUB`, run remote commands, rename a branch, change registry configuration, change generated GPT Action schema, alter GPT UI configuration, change backend code, change worker runtime code, alter protected-value files, commit, push, deploy, or release.

## Current JUB State

| Item | Current note |
|------|--------------|
| Local path | `C:\projects\JUB` |
| Repository posture | Remote-backed, inert, docs-first repo. |
| Remote state | Remote now exists: `origin https://github.com/timl0413-cloud/JUB.git`. |
| Branch state | Local branch `main` tracks `origin/main`. |
| Working tree | Clean at time of handoff after first remote sync. |
| Key commit | `06f4ff1` Initialize inert JUB workspace docs. |
| Live state | Not live. JUB remains shadow-only. |
| Backend/runtime state | No backend runtime in JUB and no worker runtime in JUB. |
| Registry/schema state | No live registry profile `jub` and no GPT Action schema exposure for JUB. |
| Protected-value state | Protected-value files must not be added to JUB. |

Plain-language summary: JUB exists locally as an inert documentation workspace at `C:\projects\JUB` and is now backed by private GitHub repo `timl0413-cloud/JUB` at `https://github.com/timl0413-cloud/JUB.git`. The remote does not change live routing. JUB is not exposed through the live command-channel registry, not exposed through GPT Actions, and not running backend or worker code.

## Decision Questions for Tim

1. Should JUB get a GitHub remote now?
2. Which owner should hold the repo: account `timl0413-cloud` or a future JuOS org?
3. What should the repo be named?
4. Should the repo be private or public?
5. Should the branch name be `main`?

Decision outcome: yes. Tim created private GitHub repo `timl0413-cloud/JUB` at `https://github.com/timl0413-cloud/JUB.git`; local `main` tracks `origin/main`; first remote sync completed.

## Superseded Recommendation

The Phase 3C-27 recommendation was to create a private GitHub repo named `JUB` under `timl0413-cloud`, use `main` as the branch name, and keep JUB shadow-only after any remote connection.

Completed in Phase 3C-28: JUB is now backed by private GitHub repo `timl0413-cloud/JUB`.

Continue to keep JUB shadow-only: no live registry profile, no GPT Action schema exposure, no backend runtime, no worker runtime, and no live routing change from the JUB remote.

## Manual Approval Gates

Before any future JUB remote or activation command is run manually, Tim should confirm:

- Owner, repo name, visibility, and branch policy.
- Local `C:\projects\JUB` status is clean.
- No protected-value files are present.
- Exact remote URL or activation target to use.

Any uncertainty on protected values, ownership, branch state, remote URL, or activation scope blocks future JUB changes until reviewed.

## Manual Command Packet

These commands are preserved as historical context from Phase 3C-27. They have been completed by Tim for `https://github.com/timl0413-cloud/JUB.git` and are not to be run automatically by workers during this packet.

```powershell
# Status checks in C:\projects\JUB
cd C:\projects\JUB
git status --short
git remote -v
git branch --show-current
git log --oneline -5

# Branch check / rename to main if Tim approves and current branch is not main
git branch -m main
git status --short

# Add remote only after Tim approves the exact URL
git remote add origin <TIM_APPROVED_JUB_REMOTE_URL>
git remote -v

# First remote sync only after Tim approves the exact URL and local status is clean
git push -u origin main

# Verify remote, status, and recent log
git remote -v
git status --short
git log --oneline -5
```

The approved URL used for Phase 3C-28 was `https://github.com/timl0413-cloud/JUB.git`. Do not infer or auto-generate future JUB remote or activation targets inside a worker job.

## Validation Snapshot

Latest observed JUB state:

- Local path: `C:\projects\JUB`.
- Remote: `origin https://github.com/timl0413-cloud/JUB.git`.
- Branch: `main` tracks `origin/main`.
- Remote sync: first remote sync completed.
- Working tree: clean at time of handoff.
- Key commit: `06f4ff1` Initialize inert JUB workspace docs.
- Role: future platform-operation backend lane, currently inert/shadow-only.

Do not re-run JUB commands from a TimOS-Agent-only job unless the later task explicitly includes `C:\projects\JUB` in scope.

## No-Go Items

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No backend runtime in JUB.
- No worker runtime in JUB.
- No live routing change from the JUB remote.
- No TimFinance code copy.
- No protected-value files.
- No TimFinance-command-channel wholesale reuse.
- No edits to `config\juos-room-registry.json`.
- No generated GPT Action schema edits.
- No GPT UI Action changes.
- No backend code, worker runtime code, deploy, release, commit, or push actions from this packet.

## Repo Relationship Boundaries

| Repo / lane | Relationship to JUB |
|-------------|---------------------|
| JUB | Candidate future home for docs-first hosted platform-operation/backend extraction planning. Today it is remote-backed by `timl0413-cloud/JUB`, inert, and shadow-only. |
| JuCore | Shared contracts and GSync scaffold repo. JuCore is already backed by private GitHub repo `timl0413-cloud/JuCore` on `main`; JuCore shared contract package implementation still requires separate approval. |
| TimFinance | Current live command-channel backend owner. Do not copy TimFinance code or protected-value material into JUB. |
| TimOS-Agent | Current JOA worker/runtime and GPT Action schema tooling owner. This decision packet lives here only as handoff documentation; TimOS-Agent does not make JUB live. |

## Next Recommended Gates

1. JuCore shared contract package implementation only after explicit approval.
2. TimFinance backend extraction dry-run later, not now.
3. Live JUB activation only after separate approval.
4. Keep JUB registry exposure, GPT Action schema exposure, backend runtime, and worker/runtime movement as separate later approval gates.

## Safe Allowlist for This Packet

Allowed change:

- `docs\command-channel\jub-remote-ownership-decision-v0.md`
- `docs\command-channel\platform-handoff-ledger-v0.md`

Allowed validation commands from `C:\projects\TimOS-Agent`:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Everything else is out of scope for Phase 3C-28.
