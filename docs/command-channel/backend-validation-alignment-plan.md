# Backend Validation Alignment Plan

Phase 2A audit note for keeping hosted command-channel validation aligned with the JuOS room registry.

## Source of truth

`config/juos-room-registry.json` is the current profile registry for command-channel route validation:

| Profile | repo_ref | workspace_ref |
| --- | --- | --- |
| `joa` | `TimOS-Agent` | `C:\projects\TimOS-Agent` |
| `finance` | `TimFinance` | `C:\projects\TimFinance` |
| `ob` | `TimFinance` | `C:\projects\TimFinance` |
| `gsync` | `juos-knowledge-vault` | `C:\projects\juos-knowledge-vault` |
| `jucore` | `JuCore` | `C:\projects\JuCore` |
| `stuf` | `STUF` | `C:\projects\SpaceA\STUF-Website` |
| `nova` | `Nova` | `C:\projects\Nova` |

## Required backend behavior

If the live hosted command-channel backend is implemented in TimFinance/JuOS, its request validation should match this registry:

- Accept only profiles listed above.
- Require `repo_ref` and `workspace_ref` to match the selected profile.
- Treat `ob` as a TimFinance/Operation Board profile, not a separate repo.
- Treat `nova` as `Nova` / `C:\projects\Nova`, not legacy `NovaUniverse`.
- Keep JUB as platform-operation coordination, not a worker profile.
- Keep JEX as handoff/executive judgment, not a worker profile.
- Keep JuCore as shared technical contracts, distinct from XJu Core identity.

## Audit steps before backend implementation

1. Compare hosted route validators against `config/juos-room-registry.json`.
2. Compare generated schema enums against backend accepted profiles.
3. Confirm `createApprovedFinalizeCommandChannelJob`, `createSupervisedImplementCommandChannelJob`, `getCommandChannelJob`, `listCommandChannelJobs`, and `approveCommandChannelJob` share the same profile rules.
4. Confirm backend errors name the invalid field without printing secrets.
5. Confirm no GPT UI schema is edited as part of backend validation alignment.

## Out of scope for Phase 2A

- No TimFinance product behavior changes.
- No API rewrite.
- No repo rename or workspace move.
- No worker launch or job claim.
- No STUF delivery content changes.
