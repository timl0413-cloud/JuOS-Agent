# JuCore Remote Ownership Decision v0

Phase 3C-26 records that the JuCore remote ownership decision has been executed and supersedes the earlier local-only decision packet from Phase 3C-20.

**Status:** documentation only. This packet does not touch `C:\projects\JuCore`, run any remote command, change registry configuration, change generated GPT Action schema, alter GPT UI configuration, change backend code, change worker runtime code, alter protected-value files, commit, push, deploy, or release.

## Current JuCore State

| Item | Current note |
|------|--------------|
| Local repo path | `C:\projects\JuCore` |
| Known commit context | Latest observed commits include `3ae959d`, `483414b`, `67d7678`, `627de9c`, and `c021426`. |
| Remote state | Remote now exists: `origin https://github.com/timl0413-cloud/JuCore.git`. |
| Branch state | Local branch `main` tracks `origin/main`. |
| Working tree | Clean at time of handoff after first remote sync. |
| Important content | Shared command-channel contract docs, command-channel package layout docs, and GSync v0.1 local scaffold are recorded as JuCore materials. |
| Role boundary | JuCore is shared contracts / GSync scaffold only. It is not the hosted backend, not worker runtime, and not live routing authority. |

## Decision Question for Tim

Should `C:\projects\JuCore` get a remote now, and if yes, under what repository name and owner?

Decision outcome: yes. Tim created private GitHub repo `timl0413-cloud/JuCore` at `https://github.com/timl0413-cloud/JuCore.git`; local `main` tracks `origin/main`; first remote sync completed.

## Options

| Option | What it means | Benefits | Risks / blockers | When to choose |
|--------|---------------|----------|------------------|----------------|
| Keep local-only for now | Leave JuCore without a configured remote. | No publication risk; avoids mixing unrelated local work. | Shared contracts continue to accumulate only locally; recovery and cross-room handoff remain weak. | Superseded by Phase 3C-26. |
| Create GitHub remote named `JuCore` | Create or attach a remote repository named `JuCore` under Tim-approved ownership. | Gives shared contracts durable history and a clear repo identity. | Requires clean inventory, protected-value check, owner/name approval, and explicit remote command approval. | Completed: `timl0413-cloud/JuCore`. |
| Fold into another JuOS mono-repo later | Do not create a standalone JuCore remote; reserve contracts for a future JuOS mono-repo. | May reduce repo sprawl if JuOS consolidates platform contracts later. | Would have delayed durable remote history and blurred contract ownership with runtime/backend repos. | Superseded by Phase 3C-26. |
| Defer pending GSync ownership cleanup | Pause remote setup until GSync/JuCore local ownership boundaries are cleaned up. | Reduces chance that GSync-local changes leak into JuCore contract publication. | Would have delayed remote backing for JuCore. | Superseded by Phase 3C-26; continue to keep GSync cleanup separate from JuCore contract work. |

## Recommendation

Completed: JuCore is now backed by private GitHub repo `timl0413-cloud/JuCore`.

Continue to avoid mixing unrelated work. The current remote state does not approve shared contract package implementation, backend extraction, registry changes, GPT Action schema changes, or worker runtime changes.

## Manual Approval Gates

- Tim approved repository owner/name and remote setup before this handoff.
- Future JuCore package implementation requires a separate explicit approval.
- Future JUB remote ownership decision requires a separate explicit approval.
- Future TimFinance backend extraction dry-run requires a separate explicit approval.
- Any future protected-value, token, environment, credential, local auth, deploy, or DB-secret concern blocks publication until reviewed.

## Validation Snapshot

Latest observed JuCore state:

- Remote sync completed.
- Remote: `origin https://github.com/timl0413-cloud/JuCore.git`.
- Branch: `main` tracks `origin/main`.
- Working tree: clean at time of handoff.
- Recent commits:
  - `3ae959d` Document JuCore remote ownership decision
  - `483414b` Add GSync v0.1 local scaffold
  - `67d7678` Document command-channel package layout plan
  - `627de9c` Document command-channel shared contract
  - `c021426` chore: scaffold JuCore and Gsync workspace

Do not re-run JuCore commands from a TimOS-Agent-only job unless the later task explicitly includes `C:\projects\JuCore` in scope.

Expected interpretation:

- JuCore remote presence is now expected.
- JuCore remote does not change live command-channel routing.
- JUB remains shadow-only with no live profile.
- TimFinance remains the live command-channel backend.
- TimOS-Agent remains the JOA worker/runtime and GPT Action schema tooling owner.

## Repo Relationship Boundaries

| Repo / lane | Relationship to JuCore |
|-------------|------------------------|
| JuCore | Owner for shared command-channel contracts, route/profile vocabulary, status/completion packet shapes, package layout docs, and GSync scaffold materials. Remote: `timl0413-cloud/JuCore`. |
| JUB | Local-only inert docs-first repo today. Future owner candidate for hosted platform-operation/backend extraction, but not live and not the current home of shared contract docs. |
| TimFinance | Current live hosted command-channel backend owner. JuCore is not the hosted backend and must not receive TimFinance runtime or protected-value material by copy. |
| TimOS-Agent | Current JOA worker/runtime owner and GPT Action schema tooling owner. JuCore is not the worker runtime and not the GPT Action UI configuration source. |
| GSync | Knowledge-continuity and direct development lane. GSync ownership cleanup must stay separate from JuCore command-channel contract publication. |

## No-Go Items

- No edits to `C:\projects\JuCore` from this TimOS-Agent-scoped packet.
- No remote commands.
- No commit, push, release, deploy, or source-control write action.
- No live routing change from the JuCore remote.
- No JuCore shared contract package implementation without explicit approval.
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

1. JUB remote and ownership decision packet: decide whether JUB remains local-only or receives its own remote later.
2. JuCore shared contract package implementation plan: implement only after explicit approval.
3. TimFinance backend extraction dry-run plan: perform later, not in this phase.
4. Shared-contract extraction plan: decide which TimOS-Agent/TimFinance/JUB docs should later move or be mirrored into JuCore, without copying runtime or protected-value material.

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
