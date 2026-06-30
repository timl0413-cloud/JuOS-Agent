# JUB Extraction Map Manual-Write Packet v0

Phase 3C-14 prepares the content Tim can manually write to `C:\projects\JUB\docs\extraction-map-v0.md` later. This file lives in TimOS-Agent only and does not modify `C:\projects\JUB`.

**Status:** documentation only. JUB remains inert and shadow-only. The live command-channel backend remains in TimFinance, and the JOA worker runtime remains in TimOS-Agent.

## Guardrails

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No backend runtime in JUB yet.
- No worker runtime in JUB yet.
- No TimFinance wholesale copy.
- `TimFinance-command-channel` is reference-only.
- No TimFinance, JuCore, backend, registry, generated schema, GPT UI, protected-value, deploy, DB, or release changes in this packet.

## Draft File for JUB

Target future file:

```text
C:\projects\JUB\docs\extraction-map-v0.md
```

Draft content:

````markdown
# JUB Extraction Map v0

This map records candidate ownership boundaries for a future JUB extraction. It is not an extraction approval, runtime scaffold, registry change, schema change, or deployment plan.

**Current state:** JUB is inert and shadow-only. Live command-channel backend remains in TimFinance. JOA worker runtime remains in TimOS-Agent. JuCore shared command-channel contract material now has a private GitHub remote at `https://github.com/timl0413-cloud/JuCore.git`; `main` tracks `origin/main`.

## Guardrails

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No backend runtime in JUB yet.
- No worker runtime in JUB yet.
- No TimFinance wholesale copy.
- `TimFinance-command-channel` is reference-only and must not be promoted wholesale.
- Finance and OB profiles stay mapped to TimFinance until a separate approved migration.
- `requested_by: jub`, `source_room: JUB`, or `active_lane: jub-coordination` is metadata only, not execution authority.

## Future JUB Extraction Candidates from TimFinance

These are candidate areas only. Reconfirm exact paths from the Phase 3C-6 TimFinance backend extraction inventory before any copy or move.

| Candidate area | Future JUB disposition | Notes |
|----------------|------------------------|-------|
| Hosted command-channel API route handlers | Candidate for JUB backend ownership after approval | Extract only backend route surface required for command-channel jobs, summaries, diagnostics, approval, and status reads. |
| Command-channel request validation helpers | Candidate for JUB or JuCore split | Runtime validators may belong in JUB; shared route/profile vocabulary may belong in JuCore. |
| Command-channel job store and adapter glue | Candidate for JUB backend ownership | Must preserve existing hosted DB contract and avoid copying credentials or env values. |
| Diagnostics and compact status endpoints | Candidate for JUB backend ownership | Keep behavior compatible with current GPT Action clients before any schema exposure. |
| GPT Action backend endpoints currently served by TimFinance | Candidate for JUB backend ownership | Schema exposure remains blocked until a separate schema strategy is approved. |
| Backend tests and smoke checks for command-channel routes | Candidate to port or recreate | Tests must prove existing Finance and OB behavior remains unchanged until migration. |
| Non-secret deployment references for command-channel backend | Reference candidate only | Do not copy env files, protected values, tokens, or provider secrets. |

## Files That Must Stay in TimFinance

| Area | Reason |
|------|--------|
| Finance product application code, UI, and domain behavior | Owned by Finance lane, not JUB. |
| Finance product routes, models, services, migrations, and docs | Product behavior must not move under a platform extraction. |
| OB legacy alias behavior unless separately retired | `ob` remains a TimFinance alias until a dedicated migration approves retirement or remap. |
| TimFinance deployment settings that serve Finance product behavior | JUB cannot inherit product deploy assumptions by copy. |
| Any TimFinance environment, token, secret, local auth, or protected-value files | No-copy protected material. |
| Local generated artifacts or caches unrelated to command-channel backend ownership | Not extraction source. |

## Shared Contract Candidates for JuCore

JuCore is the candidate home for cross-repo contracts, not JUB runtime implementation. Phase 3C-26 supersedes the original local-only note: JuCore remote now exists as `timl0413-cloud/JuCore`, with `main` tracking `origin/main`.

| Candidate contract | Possible JuCore disposition |
|--------------------|-----------------------------|
| Command-channel job payload field vocabulary | Shared contract candidate. |
| Worker profile, repo_ref, workspace_ref, source_room, and active_lane semantics | Shared contract candidate. |
| Status packet and completion packet shapes | Shared contract candidate. |
| OpenAPI-compatible route operation definitions | Shared contract candidate after schema strategy approval. |
| Validation matrix for live profiles vs shadow candidates | Shared contract candidate, with runtime enforcement remaining in owning services. |
| DB contract descriptions for jobs, approvals, diagnostics, and summaries | Shared documentation candidate; no DB migration implied. |

Do not edit JuCore from this map. Any JuCore contract move or shared package implementation requires a separate JuCore-scoped approval.

## JOA Runtime Pieces That Must Remain in TimOS-Agent

| TimOS-Agent area | Reason |
|------------------|--------|
| JOA worker hub and local polling runtime | JOA worker identity remains in TimOS-Agent. |
| Worker startup scripts and station scripts | Local worker operations are not JUB backend runtime. |
| Command-channel status, watch, tower, and station doctor tooling | TimOS-Agent owns current local visibility and validation loops. |
| Registry dry-run and action/station doctor scripts | Used to prove JUB remains shadow-only before activation. |
| Generated GPT Action schema source/checking workflow | Must not expose `jub` until a separate schema approval. |
| Local workspace routing docs and room capability docs | TimOS-Agent remains the local command-channel coordination source for now. |

## No-Copy, Protected, and Local-Only Items

Never copy these into JUB during extraction-map work:

- `.env*`, token files, local auth files, credentials, protected values, SSH keys, API keys, or provider secrets.
- `config\auth.json` or equivalent local auth stores.
- Generated GPT Action schemas as live source of truth.
- GPT UI configuration exports or manual GPT Action imports.
- Supabase/Vercel/provider secrets or production environment state.
- DB migrations or policies unless a later extraction job explicitly approves them.
- Node modules, build output, caches, logs, local temp files, or machine-specific paths.
- TimFinance product files and Finance-only documentation.
- TimOS-Agent worker runtime files.
- JuCore files, unless a separate JuCore job approves contract movement.

## Dependency Notes

- JUB cannot become executable until registry, backend validator, worker startup behavior, schema strategy, hosted DB access, and rollback ownership are approved together.
- `finance` and `ob` must continue to resolve to TimFinance during all shadow extraction-map work.
- A future dependency graph audit must trace command-channel route handlers to validators, DB helpers, schemas, tests, deployment references, and protected-value assumptions before any file move.
- Shared contracts should be separated from runtime code before extraction: JuCore candidates are contracts; JUB candidates are hosted backend/runtime ownership.
- `TimFinance-command-channel` can be read as historical/reference material only. Do not treat it as source of truth.

## Validation Notes

After this file is manually written, run validation from `C:\projects\TimOS-Agent`:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Expected result:

- JUB registry dry-run confirms JUB remains shadow-only and non-live.
- Action doctor confirms generated GPT Action schema does not expose `jub`.
- Station doctor runs report-only and does not activate a JUB worker.
- TimOS-Agent git status shows only the approved documentation packet, or is clean after review.

## Future Next Jobs

1. JUB local git/init decision packet.
2. TimFinance extraction dependency graph audit.
3. Registry shadow candidate file plan.
````

## Manual-Write Protocol

Tim can run this later after approving the JUB-side manual write. The command writes only `C:\projects\JUB\docs\extraction-map-v0.md`.

````powershell
Set-Location C:\projects\JUB
New-Item -ItemType Directory -Force -Path docs | Out-Null

Set-Content -Path docs\extraction-map-v0.md -Encoding UTF8 -Value @'
# JUB Extraction Map v0

This map records candidate ownership boundaries for a future JUB extraction. It is not an extraction approval, runtime scaffold, registry change, schema change, or deployment plan.

**Current state:** JUB is inert and shadow-only. Live command-channel backend remains in TimFinance. JOA worker runtime remains in TimOS-Agent. JuCore shared command-channel contract material now has a private GitHub remote at `https://github.com/timl0413-cloud/JuCore.git`; `main` tracks `origin/main`.

## Guardrails

- No live registry profile `jub`.
- No GPT Action schema exposure for `jub`.
- No backend runtime in JUB yet.
- No worker runtime in JUB yet.
- No TimFinance wholesale copy.
- `TimFinance-command-channel` is reference-only and must not be promoted wholesale.
- Finance and OB profiles stay mapped to TimFinance until a separate approved migration.
- `requested_by: jub`, `source_room: JUB`, or `active_lane: jub-coordination` is metadata only, not execution authority.

## Future JUB Extraction Candidates from TimFinance

These are candidate areas only. Reconfirm exact paths from the Phase 3C-6 TimFinance backend extraction inventory before any copy or move.

| Candidate area | Future JUB disposition | Notes |
|----------------|------------------------|-------|
| Hosted command-channel API route handlers | Candidate for JUB backend ownership after approval | Extract only backend route surface required for command-channel jobs, summaries, diagnostics, approval, and status reads. |
| Command-channel request validation helpers | Candidate for JUB or JuCore split | Runtime validators may belong in JUB; shared route/profile vocabulary may belong in JuCore. |
| Command-channel job store and adapter glue | Candidate for JUB backend ownership | Must preserve existing hosted DB contract and avoid copying credentials or env values. |
| Diagnostics and compact status endpoints | Candidate for JUB backend ownership | Keep behavior compatible with current GPT Action clients before any schema exposure. |
| GPT Action backend endpoints currently served by TimFinance | Candidate for JUB backend ownership | Schema exposure remains blocked until a separate schema strategy is approved. |
| Backend tests and smoke checks for command-channel routes | Candidate to port or recreate | Tests must prove existing Finance and OB behavior remains unchanged until migration. |
| Non-secret deployment references for command-channel backend | Reference candidate only | Do not copy env files, protected values, tokens, or provider secrets. |

## Files That Must Stay in TimFinance

| Area | Reason |
|------|--------|
| Finance product application code, UI, and domain behavior | Owned by Finance lane, not JUB. |
| Finance product routes, models, services, migrations, and docs | Product behavior must not move under a platform extraction. |
| OB legacy alias behavior unless separately retired | `ob` remains a TimFinance alias until a dedicated migration approves retirement or remap. |
| TimFinance deployment settings that serve Finance product behavior | JUB cannot inherit product deploy assumptions by copy. |
| Any TimFinance environment, token, secret, local auth, or protected-value files | No-copy protected material. |
| Local generated artifacts or caches unrelated to command-channel backend ownership | Not extraction source. |

## Shared Contract Candidates for JuCore

JuCore is the candidate home for cross-repo contracts, not JUB runtime implementation. Phase 3C-26 supersedes the original local-only note: JuCore remote now exists as `timl0413-cloud/JuCore`, with `main` tracking `origin/main`.

| Candidate contract | Possible JuCore disposition |
|--------------------|-----------------------------|
| Command-channel job payload field vocabulary | Shared contract candidate. |
| Worker profile, repo_ref, workspace_ref, source_room, and active_lane semantics | Shared contract candidate. |
| Status packet and completion packet shapes | Shared contract candidate. |
| OpenAPI-compatible route operation definitions | Shared contract candidate after schema strategy approval. |
| Validation matrix for live profiles vs shadow candidates | Shared contract candidate, with runtime enforcement remaining in owning services. |
| DB contract descriptions for jobs, approvals, diagnostics, and summaries | Shared documentation candidate; no DB migration implied. |

Do not edit JuCore from this map. Any JuCore contract move or shared package implementation requires a separate JuCore-scoped approval.

## JOA Runtime Pieces That Must Remain in TimOS-Agent

| TimOS-Agent area | Reason |
|------------------|--------|
| JOA worker hub and local polling runtime | JOA worker identity remains in TimOS-Agent. |
| Worker startup scripts and station scripts | Local worker operations are not JUB backend runtime. |
| Command-channel status, watch, tower, and station doctor tooling | TimOS-Agent owns current local visibility and validation loops. |
| Registry dry-run and action/station doctor scripts | Used to prove JUB remains shadow-only before activation. |
| Generated GPT Action schema source/checking workflow | Must not expose `jub` until a separate schema approval. |
| Local workspace routing docs and room capability docs | TimOS-Agent remains the local command-channel coordination source for now. |

## No-Copy, Protected, and Local-Only Items

Never copy these into JUB during extraction-map work:

- `.env*`, token files, local auth files, credentials, protected values, SSH keys, API keys, or provider secrets.
- `config\auth.json` or equivalent local auth stores.
- Generated GPT Action schemas as live source of truth.
- GPT UI configuration exports or manual GPT Action imports.
- Supabase/Vercel/provider secrets or production environment state.
- DB migrations or policies unless a later extraction job explicitly approves them.
- Node modules, build output, caches, logs, local temp files, or machine-specific paths.
- TimFinance product files and Finance-only documentation.
- TimOS-Agent worker runtime files.
- JuCore files, unless a separate JuCore job approves contract movement.

## Dependency Notes

- JUB cannot become executable until registry, backend validator, worker startup behavior, schema strategy, hosted DB access, and rollback ownership are approved together.
- `finance` and `ob` must continue to resolve to TimFinance during all shadow extraction-map work.
- A future dependency graph audit must trace command-channel route handlers to validators, DB helpers, schemas, tests, deployment references, and protected-value assumptions before any file move.
- Shared contracts should be separated from runtime code before extraction: JuCore candidates are contracts; JUB candidates are hosted backend/runtime ownership.
- `TimFinance-command-channel` can be read as historical/reference material only. Do not treat it as source of truth.

## Validation Notes

After this file is manually written, run validation from `C:\projects\TimOS-Agent`:

```powershell
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

Expected result:

- JUB registry dry-run confirms JUB remains shadow-only and non-live.
- Action doctor confirms generated GPT Action schema does not expose `jub`.
- Station doctor runs report-only and does not activate a JUB worker.
- TimOS-Agent git status shows only the approved documentation packet, or is clean after review.

## Future Next Jobs

1. JUB local git/init decision packet.
2. TimFinance extraction dependency graph audit.
3. Registry shadow candidate file plan.
'@

Get-Item docs\extraction-map-v0.md | Select-Object FullName, Length, LastWriteTime
Get-Content docs\extraction-map-v0.md -TotalCount 12
````

Validation after Tim's manual write, from TimOS-Agent:

```powershell
Set-Location C:\projects\TimOS-Agent
scripts\juos-jub-registry-dry-run.ps1
scripts\juos-action-doctor.ps1
scripts\juos-station-doctor.ps1 -ReportOnly
git status --short
```

## Safe Allowlist

For Phase 3C-14, allowed TimOS-Agent changes are limited to:

- `docs\command-channel\jub-extraction-map-manual-write-packet-v0.md`

Future JUB-side manual writes, if Tim approves them separately, are limited to:

- `C:\projects\JUB\docs\extraction-map-v0.md`

Everything else remains out of scope, including `C:\projects\JUB` direct worker writes during this job, `C:\projects\TimFinance`, `C:\projects\JuCore`, `config\juos-room-registry.json`, generated GPT Action schemas, GPT UI configuration, backend code, worker runtime code, protected-value files, deployment files, DB files, and source-control write actions.

## Future Next Jobs

After `C:\projects\JUB\docs\extraction-map-v0.md` exists:

1. JUB local git/init decision packet.
2. TimFinance extraction dependency graph audit.
3. Registry shadow candidate file plan.

## Related

- [`jub-workspace-access-boundary-v0.md`](./jub-workspace-access-boundary-v0.md)
- [`jub-workspace-creation-plan-v0.md`](./jub-workspace-creation-plan-v0.md)
- [`jub-registry-dry-run-plan-v0.md`](./jub-registry-dry-run-plan-v0.md)
- [`jub-lane-contract-v0.md`](./jub-lane-contract-v0.md)
- [`../command-channel-repo-routing.md`](../command-channel-repo-routing.md)
