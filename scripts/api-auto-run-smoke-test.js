#!/usr/bin/env node

const fs = require("fs");
const { authFileExists, loadAuthTokens, findTokenByName } = require("../lib/auth");
const { POLICY_FILE } = require("../lib/policy");

const HOST = process.env.TIMOS_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.TIMOS_AGENT_PORT || 8787);
const BASE_URL = `http://${HOST}:${PORT}`;
const ACTION_TOKEN_NAME = "xiaoju-action-create-read";
const shouldRun = process.argv.includes("--run");
const POLL_INTERVAL_MS = 3000;
const POLL_REQUEST_RETRIES = 5;
const POLL_REQUEST_RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = Number(process.env.TIMOS_AGENT_AUTO_RUN_TIMEOUT_MS || 600000);

const JOB_BODY = {
  station: "station1",
  workspace: "TimOS-Agent",
  worker: "cursor",
  mode: "read_only",
  task_type: "inspect_only",
  risk_level: "low",
  auto_run_requested: true,
  requested_by: "xiaoju",
  prompt:
    "Inspect this repository and summarize the current structure. Do not modify files.",
};

function loadActionToken() {
  if (!authFileExists()) {
    console.log("config/auth.json is missing.");
    console.log("");
    console.log("Setup:");
    console.log("  1. Copy config/auth.json.example to config/auth.json");
    console.log("  2. Set secrets for xiaoju-action-create-read and tim-local-operator");
    console.log("  3. Restart node scripts/server.js");
    console.log("  4. Re-run: node scripts/api-auto-run-smoke-test.js");
    return null;
  }

  const tokens = loadAuthTokens();
  const record = findTokenByName(ACTION_TOKEN_NAME, tokens);

  if (!record) {
    console.log(`Token profile "${ACTION_TOKEN_NAME}" not found in config/auth.json.`);
    return null;
  }

  if (
    !record.token ||
    record.token === "replace-with-xiaoju-action-secret"
  ) {
    console.log(`Token profile "${ACTION_TOKEN_NAME}" is not configured.`);
    return null;
  }

  return record.token;
}

function checkPolicyConfig() {
  if (!fs.existsSync(POLICY_FILE)) {
    console.log("config/auto-run-policy.json is missing.");
    console.log("");
    console.log("Setup:");
    console.log("  1. Copy config/auto-run-policy.json.example to config/auto-run-policy.json");
    console.log("  2. Restart node scripts/server.js");
    console.log("  3. Re-run: node scripts/api-auto-run-smoke-test.js");
    return false;
  }

  try {
    const policy = JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
    if (policy.enabled !== true) {
      console.log("config/auto-run-policy.json exists but enabled is not true.");
      return false;
    }
  } catch (err) {
    console.log(`Invalid config/auto-run-policy.json: ${err.message}`);
    return false;
  }

  return true;
}

async function request(method, path, { body, token } = {}) {
  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const wrapped = new Error(`fetch failed for ${method} ${path}: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: response.status, ok: response.ok, data };
}

async function requestWithRetries(method, path, options, retries = POLL_REQUEST_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await request(method, path, options);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        console.log(
          `request retry ${attempt}/${retries - 1}: ${err.message}`
        );
        await sleep(POLL_REQUEST_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printDryRunPlan() {
  console.log("Dry run only (pass --run to create job and poll Cursor execution).");
  console.log("");
  console.log(`Target: ${BASE_URL}`);
  console.log("Token profile: xiaoju-action-create-read (jobs:read, jobs:create only)");
  console.log("Policy file: config/auto-run-policy.json");
  console.log("");
  console.log("Would POST /jobs with:");
  console.log(JSON.stringify(JOB_BODY, null, 2));
  console.log("");
  console.log("Expected when policy matches:");
  console.log("  - status: auto_running");
  console.log("  - approval.approved_by: policy:station1-read-only-inspect");
  console.log("  - TimOS-Agent starts Cursor internally (no approve/run scope needed)");
  console.log("");
  console.log("Would poll GET /jobs/:id until completed/failed or timeout.");
  console.log("Polling retries transient fetch errors while Cursor runs asynchronously.");
}

async function pollJob(token, jobId) {
  const started = Date.now();

  while (Date.now() - started < TIMEOUT_MS) {
    let result;

    try {
      result = await requestWithRetries("GET", `/jobs/${jobId}`, { token });
    } catch (err) {
      console.log(`poll: transient error (${err.message}), waiting to retry...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!result.ok) {
      throw new Error(
        `GET /jobs/${jobId} failed (${result.status}): ${JSON.stringify(result.data)}`
      );
    }

    const job = result.data;
    console.log(`poll: ${job.id} status=${job.status}`);

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for job ${jobId} after ${TIMEOUT_MS}ms`);
}

function printResultSummary(job) {
  console.log("");
  console.log("Auto-run smoke test result:");
  console.log(`  job_id: ${job.id}`);
  console.log(`  status: ${job.status}`);
  console.log(`  policy_id: ${job.policy_result?.policy_id || "n/a"}`);
  console.log(`  approved_by: ${job.approval?.approved_by || "n/a"}`);

  if (job.result?.summary) {
    console.log(`  summary: ${job.result.summary}`);
  } else if (job.result?.stdout) {
    const preview = job.result.stdout.trim().slice(0, 500);
    console.log(`  stdout preview: ${preview}${job.result.stdout.length > 500 ? "..." : ""}`);
  } else if (job.result?.error) {
    console.log(`  error: ${job.result.error}`);
  }
}

async function main() {
  const token = loadActionToken();
  if (!token) {
    process.exit(0);
  }

  if (!checkPolicyConfig()) {
    process.exit(0);
  }

  if (!shouldRun) {
    printDryRunPlan();
    process.exit(0);
  }

  console.log(`Auto-run smoke test against ${BASE_URL}`);

  const health = await request("GET", "/health");
  if (!health.ok) {
    throw new Error(`Health check failed: ${health.status}`);
  }

  const created = await request("POST", "/jobs", { token, body: JOB_BODY });
  if (!created.ok || created.status !== 201) {
    throw new Error(
      `POST /jobs failed (${created.status}): ${JSON.stringify(created.data)}`
    );
  }

  const job = created.data;
  console.log("created job:", job.id, job.status);

  if (job.status !== "auto_running") {
    throw new Error(
      `Expected auto_running, got ${job.status}. policy_result=${JSON.stringify(job.policy_result)}`
    );
  }

  const finished = await pollJob(token, job.id);
  printResultSummary(finished);

  if (finished.status !== "completed") {
    throw new Error(`Job finished with status ${finished.status}`);
  }

  console.log("Auto-run smoke test passed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
