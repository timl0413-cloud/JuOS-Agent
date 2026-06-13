#!/usr/bin/env node

const { authFileExists, loadAuthTokens, findTokenByName } = require("../lib/auth");

const HOST = process.env.TIMOS_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.TIMOS_AGENT_PORT || 8787);
const BASE_URL = `http://${HOST}:${PORT}`;
const ACTION_TOKEN_NAME = "xiaoju-action-create-read";

function loadActionToken() {
  if (!authFileExists()) {
    console.log("config/auth.json is missing.");
    console.log("");
    console.log("Setup:");
    console.log("  1. Copy config/auth.json.example to config/auth.json");
    console.log("  2. Set secrets for xiaoju-action-create-read and tim-local-operator");
    console.log("  3. Restart node scripts/server.js");
    console.log("  4. Re-run: node scripts/api-action-safe-smoke-test.js");
    return null;
  }

  const tokens = loadAuthTokens();
  const record = findTokenByName(ACTION_TOKEN_NAME, tokens);

  if (!record) {
    console.log(`Token profile "${ACTION_TOKEN_NAME}" not found in config/auth.json.`);
    console.log("Add the xiaoju-action-create-read profile from config/auth.json.example.");
    return null;
  }

  if (
    !record.token ||
    record.token === "replace-with-xiaoju-action-secret"
  ) {
    console.log(`Token profile "${ACTION_TOKEN_NAME}" is not configured.`);
    console.log("Set a local secret before running this test.");
    return null;
  }

  return record.token;
}

async function request(method, path, { body, token } = {}) {
  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: response.status, ok: response.ok, data };
}

async function expectFailure(label, result, expectedStatus, expectedError) {
  if (result.ok || result.status !== expectedStatus) {
    throw new Error(
      `${label} expected ${expectedStatus}, got ${result.status}: ${JSON.stringify(result.data)}`
    );
  }

  if (expectedError && result.data.error !== expectedError) {
    throw new Error(
      `${label} expected error "${expectedError}", got: ${JSON.stringify(result.data)}`
    );
  }

  console.log(`${label}: blocked (${result.status})`, result.data);
}

async function expectSuccess(label, result, expectedStatus) {
  if (!result.ok || result.status !== expectedStatus) {
    throw new Error(
      `${label} expected ${expectedStatus}, got ${result.status}: ${JSON.stringify(result.data)}`
    );
  }
  console.log(`${label}: ok (${result.status})`);
  return result.data;
}

async function main() {
  const token = loadActionToken();
  if (!token) {
    process.exit(0);
  }

  console.log(`Action-safe smoke test against ${BASE_URL}`);

  await expectSuccess("GET /health (no auth)", await request("GET", "/health"), 200);

  await expectSuccess(
    "GET /jobs (action token)",
    await request("GET", "/jobs", { token }),
    200
  );

  const created = await expectSuccess(
    "POST /jobs (action token)",
    await request("POST", "/jobs", {
      token,
      body: {
        workspace: "timfinance",
        worker: "cursor",
        prompt:
          "Inspect the repository and summarize the app structure. Do not modify files.",
        requested_by: "xiaoju",
        mode: "read_only",
      },
    }),
    201
  );

  if (created.status !== "needs_approval") {
    throw new Error(
      `Expected needs_approval, got ${created.status}`
    );
  }
  console.log("created job:", created.id, created.status);

  await expectFailure(
    "POST /jobs/:id/approve (action token)",
    await request("POST", `/jobs/${created.id}/approve`, {
      token,
      body: {
        approved_by: "xiaoju",
        approval_note: "Should be blocked",
      },
    }),
    403,
    "insufficient_scope"
  );

  await expectFailure(
    "POST /jobs/:id/run (action token)",
    await request("POST", `/jobs/${created.id}/run`, {
      token,
      body: { confirm_execution: true },
    }),
    403,
    "insufficient_scope"
  );

  console.log("Action-safe smoke test passed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
