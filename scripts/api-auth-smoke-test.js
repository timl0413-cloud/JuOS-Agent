#!/usr/bin/env node

const { authFileExists, loadAuthTokens } = require("../lib/auth");

const HOST = process.env.TIMOS_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.TIMOS_AGENT_PORT || 8787);
const BASE_URL = `http://${HOST}:${PORT}`;
const shouldRun = process.argv.includes("--run");

function loadBearerToken() {
  if (!authFileExists()) {
    console.log("config/auth.json is missing.");
    console.log("");
    console.log("Setup:");
    console.log("  1. Copy config/auth.json.example to config/auth.json");
    console.log("  2. Replace replace-with-local-secret with a local secret");
    console.log("  3. Restart node scripts/server.js");
    console.log("  4. Re-run: node scripts/api-auth-smoke-test.js");
    return null;
  }

  const tokens = loadAuthTokens();
  const token = tokens && tokens[0] && tokens[0].token;

  if (!token || token === "replace-with-local-secret") {
    console.log("config/auth.json exists but token is not configured.");
    console.log("Set a local secret in config/auth.json before running this test.");
    return null;
  }

  return token;
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

async function expectFailure(label, result, expectedStatuses) {
  if (result.ok || !expectedStatuses.includes(result.status)) {
    throw new Error(
      `${label} expected ${expectedStatuses.join(" or ")}, got ${result.status}: ${JSON.stringify(result.data)}`
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
  const token = loadBearerToken();
  if (!token) {
    process.exit(0);
  }

  console.log(`Auth smoke test against ${BASE_URL}`);

  await expectSuccess("GET /health (no auth)", await request("GET", "/health"), 200);

  await expectFailure(
    "GET /jobs (no auth)",
    await request("GET", "/jobs"),
    [401, 503]
  );

  const jobs = await expectSuccess(
    "GET /jobs (auth)",
    await request("GET", "/jobs", { token }),
    200
  );
  console.log("jobs count:", jobs.jobs.length);

  const created = await expectSuccess(
    "POST /jobs (auth)",
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
  console.log("created job:", created.id, created.status);

  const approved = await expectSuccess(
    "POST /jobs/:id/approve (auth)",
    await request("POST", `/jobs/${created.id}/approve`, {
      token,
      body: {
        approved_by: "tim",
        approval_note: "Approved read-only inspection",
      },
    }),
    200
  );
  console.log("approved job:", approved.id, approved.status);

  if (shouldRun) {
    const finished = await expectSuccess(
      "POST /jobs/:id/run (auth)",
      await request("POST", `/jobs/${created.id}/run`, {
        token,
        body: { confirm_execution: true },
      }),
      200
    );
    console.log("ran job:", finished.id, finished.status);
  } else {
    console.log("Skipped POST /jobs/:id/run (pass --run to execute Cursor)");
  }

  console.log("Auth smoke test passed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
