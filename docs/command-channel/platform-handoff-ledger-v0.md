# Platform Handoff Ledger v0

Phase 3C-28 updates the cross-repo command-channel state so future workers do not need chat history to know what is live, what is shadow-only, and which gates remain closed.

**Status:** documentation only. This ledger does not change registry routing, generated schemas, GPT UI Actions, backend runtime, worker runtime, external repos, protected-value files, or release state.

## Current Repo and Lane Status

| Repo / lane | Current state | Source-of-truth note |
|-------------|---------------|----------------------|
| TimOS-Agent / JOA | Local worker/runtime lane at `C:\projects\TimOS-Agent`; worker profile `joa`. | JOA worker and station tooling stay in TimOS-Agent. |
| TimFinance / live command-channel backend | Live hosted command-channel backend remains in TimFinance. | Backend extraction is not approved or ready. Finance and `ob` routes remain TimFinance-owned. |
| JUB / inert remote-backed workspace | `C:\projects\JUB` is backed by private GitHub repo `timl0413-cloud/JUB`; `main` tracks `origin/main` at `https://github.com/timl0413-cloud/JUB.git`. | Future platform-operation backend lane only. It remains inert/shadow-only with no live routing, backend runtime, worker runtime, schema exposure, or protected-value material. |
| JuCore / shared contracts and GSync scaffold | `C:\projects\JuCore` is backed by private GitHub repo `timl0413-cloud/JuCore`; `main` tracks `origin/main` at `https://github.com/timl0413-cloud/JuCore.git`. | JuCore is for shared contracts and the GSync scaffold. It is not the hosted backend, not worker runtime, and does not change live routing. |
| GSync / knowledge continuity | Knowledge-continuity lane uses `juos-knowledge-vault` and packet/status handoff patterns. | GSync preserves cross-room context; it is not JUB runtime authority. |

## Current Validated Capabilities

These capabilities are considered validated in the current platform state:

- Command-channel create, approve, claim, and result flow.
- Compact summary action.
- Diagnostics action.
- JUB registry dry-run validation.
- Action doctor and station doctor passing in report-only validation.

## Current Blockers and Risks

- TimFinance backend extraction is not ready.
- JUB is remote-backed but not live and must remain shadow-only.
- JuCore now has a remote, but shared contract package implementation is not approved.
- TimFinance working tree may contain unrelated pending files; do not clean, revert, or depend on that tree without a separate TimFinance-scoped approval.
- Worker write access to `C:\projects\JUB` may require Tim manual writes.

## JuCore Remote Handoff Snapshot

Latest observed JuCore remote state at this handoff:

| Item | Snapshot |
|------|----------|
| Local path | `C:\projects\JuCore` |
| Remote | `origin https://github.com/timl0413-cloud/JuCore.git` |
| Branch tracking | `main` tracks `origin/main` |
| Remote sync | First remote sync completed |
| Working tree | Clean at time of handoff |
| Role | Shared command-channel contracts and GSync scaffold only; not hosted backend, worker runtime, live routing, or GPT Action UI/schema source |

Recent JuCore commits observed:

- `3ae959d` Document JuCore remote ownership decision
- `483414b` Add GSync v0.1 local scaffold
- `67d7678` Document command-channel package layout plan
- `627de9c` Document command-channel shared contract
- `c021426` chore: scaffold JuCore and Gsync workspace

## JUB Remote Handoff Snapshot

Phase 3C-28 records that Tim completed the approved JUB remote setup after the Phase 3C-27 decision packet.

Latest observed JUB remote state at this handoff:

| Item | Snapshot |
|------|----------|
| Local path | `C:\projects\JUB` |
| Remote | `origin https://github.com/timl0413-cloud/JUB.git` |
| Repo owner/name | `timl0413-cloud/JUB` |
| Branch tracking | `main` tracks `origin/main` |
| Remote sync | First remote sync completed |
| Working tree | Clean at time of handoff |
| Key commit | `06f4ff1` Initialize inert JUB workspace docs |
| Role | Future platform-operation backend lane; currently inert/shadow-only |

JUB remote presence is now expected. It does not approve live routing, a live registry profile `jub`, GPT Action schema exposure for `jub`, backend runtime in JUB, worker runtime in JUB, TimFinance code movement, protected-value material, deploy, commit, or push action from TimOS-Agent.

## Contract Source References

Treat these as source references for future planning. External repo paths are listed for handoff continuity only; do not read or edit them from a TimOS-Agent-only job unless a later task explicitly approves that scope.

| Contract area | Reference path |
|---------------|----------------|
| TimFinance command-channel contract manifest | `C:\projects\TimFinance\docs\command-channel\command-channel-contract-manifest-v0.md` |
| JuCore remote ownership decision | `docs\command-channel\jucore-remote-ownership-decision-v0.md` |
| JUB remote ownership decision | `docs\command-channel\jub-remote-ownership-decision-v0.md` |
| JuCore shared command-channel contract docs | `C:\projects\JuCore\docs\command-channel\shared-command-channel-contract-v0.md` |
| JuCore command-channel package layout plan | `C:\projects\JuCore\docs\command-channel\package-layout-plan-v0.md` |
| JUB extraction map | `C:\projects\JUB\docs\extraction-map-v0.md` |
| TimOS-Agent JUB extraction map manual-write packet | `docs\command-channel\jub-extraction-map-manual-write-packet-v0.md` |
| TimOS-Agent JUB registry dry-run plan | `docs\command-channel\jub-registry-dry-run-plan-v0.md` |
| TimOS-Agent JUB lane contract | `docs\command-channel\jub-lane-contract-v0.md` |
| TimOS-Agent JUB dry-run tool | `scripts\juos-jub-registry-dry-run.ps1` |
| TimOS-Agent action doctor | `scripts\juos-action-doctor.ps1` |
| TimOS-Agent station doctor | `scripts\juos-station-doctor.ps1` |

## Next Decision Gates

1. JuCore shared contract package implementation only after explicit approval.
2. TimFinance backend extraction dry-run later; do not run it in this phase.
3. Live JUB activation only after separate approval.
4. Registry shadow candidate plan.

## No-Go Items

- No live `jub` profile.
- No GPT Action schema `jub` exposure.
- No TimFinance code copy into JUB.
- No backend runtime in JUB.
- No worker runtime in JUB.
- JUB remote does not change live routing.
- No live routing change from the JuCore remote.
- No JuCore shared contract package implementation without explicit approval.
- No protected-value files.
- No edits to `config\juos-room-registry.json`.
- No generated GPT Action schema edits or GPT UI Action changes.
- No backend code, worker runtime code, deploy, release, commit, or push actions.

## Validation Before Future Work

Run these from `C:\projects\TimOS-Agent` before future JUB, JuCore, or TimFinance extraction work:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Expected interpretation:

- JUB registry dry-run passes only while `jub` remains shadow-only and absent from live registry/schema exposure.
- Action doctor passes with generated schema still aligned to live profiles.
- Station doctor runs report-only and does not activate a JUB worker.
- Git status shows only the approved docs changes for the current TimOS-Agent-scoped job.

## Safe Allowlist for This Ledger

Allowed change:

- `docs\command-channel\platform-handoff-ledger-v0.md`
- `docs\command-channel\jub-remote-ownership-decision-v0.md`

Allowed validation commands:

- `scripts\juos-jub-registry-dry-run.ps1`
- `scripts\juos-action-doctor.ps1`
- `scripts\juos-station-doctor.ps1 -ReportOnly`
- `git status --short`

Everything else is out of scope for Phase 3C-28.
