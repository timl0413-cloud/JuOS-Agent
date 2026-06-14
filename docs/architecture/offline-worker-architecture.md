# Offline Worker Architecture (v0.8A)

TimOS-Agent v0.7 proved a local bridge: coordinator stub → Station1 polling worker → local API → policy auto-run → Cursor. That path **requires Tim's main computer to be on**.

v0.8A re-scopes the product toward **offline main-computer operation**: XiaoJu should perform eligible work while Station1 is off.

## Product target

**Tim's main computer does not need to stay on** for phone/GPT Action to get useful results on low-risk tasks.

Station1 becomes **one optional worker**, not the required execution path.

## Core model

```
Phone / XiaoJu GPT Action
        |
        |  action-safe token (create/read jobs only)
        v
Cloud coordinator / queue  -------- owns routing, status, results
        ^
        |  outbound pull (worker tokens)
        |
+-------+--------+-------------+------------------+
|                |             |                  |
station1-local   cloud-readonly  always-on-home*   cloud-edit-pr*
(when PC on)     (always on)     (future)          (future)

* future worker profiles — not implemented in v0.8A
```

The coordinator owns:

- Job intake from phone/GPT Action
- Worker routing by capability
- Result storage and polling for clients
- Audit and correlation ids

Workers are **replaceable**. Adding a worker means adding a profile + pull/submit loop — not rewriting XiaoJu or the coordinator contract.

## Worker types (v0.8A foundation)

| Profile | Location | Availability | Cursor | Typical use |
|---------|----------|--------------|--------|-------------|
| `station1-local` | Tim's PC | when computer on | yes (local) | Full local inspect via v0.6 policy |
| `cloud-readonly` | cloud | always on | no | Repo inspect/summary from synced copy |
| `always-on-home` | home server | always on | TBD | Future low-power local bridge |
| `cloud-edit-pr` | cloud | always on | TBD | Future patch/PR proposals with approval |

v0.8A defines profiles and routing rules only. No cloud deploy.

## Capability model

Each worker profile declares:

- `allowed_task_types` — e.g. `inspect_only`, `summarize_repo`, `propose_patch`
- `allowed_risk_levels` — v0.8A: `low` only for auto-routed cloud work
- `can_use_local_cursor` — whether local Cursor on Tim's machine is available
- `requires_synced_repo` — cloud worker needs `repo_ref`, not local disk path
- `availability` — `always_on` vs `when_computer_on`
- `forbidden` — deploy, push, migrations, local credentials, etc.

Jobs declare:

- `target_worker_profile` (optional — coordinator picks if omitted)
- `required_capabilities` — hard requirements
- `workspace_ref` / `repo_ref` — what to operate on
- `task_type`, `risk_level`, `auto_run_requested`
- `result_contract` — expected result shape

See `docs/bridge/worker-routing-contract.md`.

## Routing principles

1. **Coordinator selects eligible workers** from capability match + availability.
2. **Worker validates again before accept** — defense in depth.
3. **Local policy remains final execution gate** on Station1 (v0.6 auto-run policy).
4. **Cloud worker must not require Station1 online** — uses synced repo snapshot, not `127.0.0.1`.
5. **High-risk / edit / deploy jobs** stay approval-gated or future-profile only.

When Station1 is off, coordinator should prefer `cloud-readonly` for low-risk inspect/summary tasks with a valid `repo_ref`.

## Security boundaries

### XiaoJu / phone (action-safe token)

- May create and read coordinator jobs
- Must **not** receive operator token
- Must **not** call approve/run endpoints

### Cloud-readonly worker

**May:**

- Read synced public/private repo content allocated to the job
- Produce summaries, structure reports, proposed patches (text only)
- Submit result to coordinator

**May not:**

- Access Tim's local filesystem or credentials
- Read `.env`, SSH keys, local-only paths
- Deploy, push, run migrations, or commit
- Bypass coordinator queue
- Call local TimOS-Agent approve/run

### Station1-local worker

- Uses action-safe token against local API only (v0.7)
- Local v0.6 policy is the auto-run authority
- Operator token stays on Tim's machine

## What v0.8A delivers

- Architecture documentation (this file)
- Worker profile config example (`config/worker-profiles.json.example`)
- Worker routing contract
- Local routing validation script (no network, no Cursor)

## What v0.8A does not deliver

- Cloud coordinator deploy
- Cloud-readonly worker runtime
- Repo sync pipeline
- GPT Action wiring to coordinator URL
- Tunnel or local API exposure

## Future path to phone / GPT Action

1. **v0.8A** — replaceable worker model + local routing validation (this release)
2. **v0.8B** — cloud coordinator deploy + cloud-readonly worker MVP
3. **v0.9+** — GPT Action schema pointed at coordinator; always-on-home or edit/PR workers as needed

Phone talks to the **coordinator URL**, never to `127.0.0.1`. Station1 being off is normal; cloud-readonly handles eligible work.

## Relationship to v0.7

v0.7 Station1 polling worker remains valid as the `station1-local` implementation path. v0.8A generalizes routing so Station1 is optional rather than mandatory for phone-reachable operation.
