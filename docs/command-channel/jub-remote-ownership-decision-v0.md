# JUB Remote Ownership Decision v0

Phase 3C-27 records the decision packet for whether and how the inert local JUB workspace should be backed by a GitHub remote later.

**Status:** documentation only. This packet does not touch `C:\projects\JUB`, add a remote, rename a branch, change registry configuration, change generated GPT Action schema, alter GPT UI configuration, change backend code, change worker runtime code, alter protected-value files, commit, push, deploy, or release.

## Current JUB State

| Item | Current note |
|------|--------------|
| Local path | `C:\projects\JUB` |
| Repository posture | Local-only, inert, docs-first repo. |
| Remote state | No remote yet. |
| Live state | Not live. JUB remains shadow-only. |
| Backend/runtime state | No backend runtime in JUB and no worker runtime in JUB. |
| Registry/schema state | No live registry profile `jub` and no GPT Action schema exposure for JUB. |
| Protected-value state | Protected-value files must not be added to JUB before any remote sync. |

Plain-language summary: JUB exists locally as an inert documentation workspace at `C:\projects\JUB`. It is not connected to GitHub, not exposed through the live command-channel registry, not exposed through GPT Actions, and not running backend or worker code.

## Decision Questions for Tim

1. Should JUB get a GitHub remote now?
2. Which owner should hold the repo: account `timl0413-cloud` or a future JuOS org?
3. What should the repo be named?
4. Should the repo be private or public?
5. Should the branch name be `main`?

## Recommendation

Create a private GitHub repo named `JUB` under `timl0413-cloud`, unless Tim chooses a JuOS org first. Use `main` as the branch name.

Do not connect the remote until Tim explicitly approves the exact remote URL. After any remote connection, keep JUB shadow-only: no live registry profile, no GPT Action schema exposure, no backend runtime, and no worker runtime.

## Manual Approval Gates

Before any JUB remote command is run manually, Tim should confirm:

- Owner, repo name, visibility, and branch policy.
- Local `C:\projects\JUB` status is clean.
- No protected-value files are present.
- Exact remote URL to use.

Any uncertainty on protected values, ownership, branch state, or remote URL blocks remote setup until reviewed.

## Manual Command Packet

These commands are for Tim to review and run manually only after the approval gates above are complete. They are not to be run automatically by workers during this packet.

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

Replace `<TIM_APPROVED_JUB_REMOTE_URL>` with the exact approved URL, for example only after Tim confirms it. Do not infer or auto-generate the final URL inside a worker job.

## No-Go Items

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No backend runtime in JUB.
- No worker runtime in JUB.
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
| JUB | Candidate future home for docs-first hosted platform-operation/backend extraction planning. Today it is local-only, inert, and shadow-only. |
| JuCore | Shared contracts and GSync scaffold repo. JuCore is already backed by private GitHub repo `timl0413-cloud/JuCore` on `main`; JUB remote setup should follow the same private-backup pattern if Tim approves. |
| TimFinance | Current live command-channel backend owner. Do not copy TimFinance code or protected-value material into JUB. |
| TimOS-Agent | Current JOA worker/runtime and GPT Action schema tooling owner. This decision packet lives here only as handoff documentation; TimOS-Agent does not make JUB live. |

## Next Jobs After Tim Decides

1. If Tim approves a JUB remote, run the manual command packet from `C:\projects\JUB` under Tim control.
2. Record the final JUB remote owner/name/URL/branch in a follow-up handoff note.
3. Re-run TimOS-Agent validation to confirm JUB remains shadow-only.
4. Plan any JUB docs cleanup separately before remote publication if local status or protected-value checks fail.
5. Keep TimFinance backend extraction, JUB registry exposure, GPT Action schema exposure, and worker/runtime movement as separate later approval gates.

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

Everything else is out of scope for Phase 3C-27.
