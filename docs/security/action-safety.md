# TimOS-Agent GPT Action Safety

This document defines the safety boundary between XiaoJu GPT Action and local Tim/operator control.

## Token profiles

| Profile | Scopes | Use |
|---------|--------|-----|
| `xiaoju-action-create-read` | `jobs:read`, `jobs:create` | GPT Action only |
| `tim-local-operator` | `jobs:read`, `jobs:create`, `jobs:approve`, `jobs:run` | Tim / local operator only |

## GPT Action rules

The GPT Action token must only have:

- `jobs:read`
- `jobs:create`

The GPT Action token must **not** receive:

- `jobs:approve`
- `jobs:run`

Even if the server exposes approve/run endpoints, a correctly scoped action token receives `403 insufficient_scope` when calling them.

## Human approval remains required

1. XiaoJu creates a job via `POST /jobs` → status `needs_approval`
2. Tim reviews the job locally
3. Tim approves with operator token via `POST /jobs/:id/approve`
4. Tim runs with operator token via `POST /jobs/:id/run` and `confirm_execution: true`

XiaoJu cannot skip approval or execution steps.

## OpenAPI schemas

| File | Audience |
|------|----------|
| `docs/openapi/timos-agent-action-safe.openapi.yaml` | **Import into XiaoJu GPT Action** |
| `docs/openapi/timos-agent-action.openapi.yaml` | Operator/internal only — includes approve and run |

Never import the full operator schema into XiaoJu GPT Action.

## Network exposure

- ChatGPT cannot call `127.0.0.1` directly
- A tunnel or deployed coordinator is required later
- Do not expose TimOS-Agent publicly without bearer auth
- Do not expose approve/run endpoints to GPT Action (schema + token scope)

## Verification

Run the action-safe smoke test after configuring `config/auth.json`:

```bash
node scripts/api-action-safe-smoke-test.js
```

This confirms the action token can create/read but cannot approve or run.
