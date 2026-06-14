#!/usr/bin/env node

const { authFileExists, loadAuthTokens, findTokenByName } = require("../lib/auth");
const {
  claimNextInboxJob,
  claimInboxJobById,
  completeClaimedJob,
  failClaimedJob,
  validateActionSafeShape,
  toLocalApiJobBody,
  ensureStubDirs,
} = require("../lib/coordinator-stub");

const HOST = process.env.TIMOS_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.TIMOS_AGENT_PORT || 8787);
const BASE_URL = `http://${HOST}:${PORT}`;
const ACTION_TOKEN_NAME = "xiaoju-action-create-read";
const POLL_INTERVAL_MS = 3000;
const POLL_REQUEST_RETRIES = 5;
const POLL_REQUEST_RETRY_DELAY_MS = 2000;
const TIMEOUT_MS = Number(process.env.TIMOS_AGENT_POLL_TIMEOUT_MS || 600000);

const stationArg = process.argv.find((arg) => arg.startsWith("--station="));
const STATION = stationArg ? stationArg.split("=")[1] : "station1";
const runOnce = process.argv.includes("--once");

function parseJobIdArg() {
  const eqArg = process.argv.find((arg) => arg.startsWith("--job-id="));
  if (eqArg) {
    return eqArg.slice("--job-id=".length);
  }

  const flagIndex = process.argv.indexOf("--job-id");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }

  return null;
}

const JOB_ID = parseJobIdArg();

const apiCalls = [];

function loadActionToken() {
  if (!authFileExists()) {
    throw new Error("config/auth.json is missing");
  }

  const tokens = loadAuthTokens();
  const record = findTokenByName(ACTION_TOKEN_NAME, tokens);

  if (!record || !record.token || record.token === "replace-with-xiaoju-action-secret") {
    throw new Error(`Token profile "${ACTION_TOKEN_NAME}" is not configured`);
  }

  return record.token;
}

function assertAllowedApiCall(method, urlPath) {
  const allowed =
    (method === "GET" && urlPath === "/health") ||
    (method === "POST" && urlPath === "/jobs") ||
    (method === "GET" && /^\/jobs\/[^/]+$/.test(urlPath));

  if (!allowed) {
    throw new Error(`Refusing disallowed local API call: ${method} ${urlPath}`);
  }

  if (
    (method === "POST" && /\/approve$/.test(urlPath)) ||
    (method === "POST" && /\/run$/.test(urlPath))
  ) {
    throw new Error(`Refusing approve/run endpoint: ${method} ${urlPath}`);
  }
}

async function trackedRequest(method, urlPath, { body, token } = {}) {
  assertAllowedApiCall(method, urlPath);
  apiCalls.push({ method, path: urlPath, at: new Date().toISOString() });

  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`fetch failed for ${method} ${urlPath}: ${err.message}`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetries(method, urlPath, options) {
  let lastError;

  for (let attempt = 1; attempt <= POLL_REQUEST_RETRIES; attempt++) {
    try {
      return await trackedRequest(method, urlPath, options);
    } catch (err) {
      lastError = err;
      if (attempt < POLL_REQUEST_RETRIES) {
        console.log(`request retry ${attempt}/${POLL_REQUEST_RETRIES - 1}: ${err.message}`);
        await sleep(POLL_REQUEST_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

async function pollLocalJob(token, jobId) {
  const started = Date.now();

  while (Date.now() - started < TIMEOUT_MS) {
    let result;

    try {
      result = await requestWithRetries("GET", `/jobs/${jobId}`, { token });
    } catch (err) {
      console.log(`poll: transient error (${err.message}), waiting...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!result.ok) {
      throw new Error(
        `GET /jobs/${jobId} failed (${result.status}): ${JSON.stringify(result.data)}`
      );
    }

    const job = result.data;
    console.log(`poll local job: ${job.id} status=${job.status}`);

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    if (job.status === "needs_approval") {
      return job;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for local job ${jobId}`);
}

async function processOneJob(token, { station = STATION, jobId = null } = {}) {
  let stationJob;

  if (jobId) {
    stationJob = claimInboxJobById(station, jobId);
    console.log(`Claimed station job by id: ${stationJob.id}`);
  } else {
    stationJob = claimNextInboxJob(station);
    if (!stationJob) {
      console.log(`No pending stub jobs for station=${station}`);
      return null;
    }
    console.log(`Claimed oldest station job: ${stationJob.id}`);
  }

  const validation = validateActionSafeShape(stationJob);
  if (!validation.ok) {
    console.log("Validation failed:", validation.errors.join("; "));
    failClaimedJob(stationJob, validation.errors.join("; "), {
      validation_errors: validation.errors,
    });
    return { stationJob, validation_failed: true };
  }

  const health = await trackedRequest("GET", "/health");
  if (!health.ok) {
    failClaimedJob(stationJob, `Local API health check failed (${health.status})`);
    throw new Error(`Local API unavailable: ${health.status}`);
  }

  const createBody = toLocalApiJobBody(stationJob);
  const created = await trackedRequest("POST", "/jobs", {
    token,
    body: createBody,
  });

  if (!created.ok || created.status !== 201) {
    failClaimedJob(
      stationJob,
      `POST /jobs failed (${created.status}): ${JSON.stringify(created.data)}`
    );
    throw new Error(`Failed to create local job: ${created.status}`);
  }

  const localJob = created.data;
  console.log(`Created local job: ${localJob.id} status=${localJob.status}`);

  if (localJob.status === "needs_approval") {
    failClaimedJob(stationJob, "Local policy did not auto-run job", {
      local_job_id: localJob.id,
      policy_result: localJob.policy_result || null,
    });
    return { stationJob, localJob, policy_rejected: true };
  }

  const finished = await pollLocalJob(token, localJob.id);
  const result = completeClaimedJob(stationJob, finished);

  console.log(`Station job finished: ${result.id} status=${result.status}`);
  console.log(`Local job id: ${result.result.local_job_id}`);

  return { stationJob: result, localJob: finished, apiCalls: [...apiCalls] };
}

async function main() {
  ensureStubDirs();
  const token = loadActionToken();

  console.log(`Station1 poll worker (stub mode) station=${STATION} api=${BASE_URL}`);
  if (JOB_ID) {
    console.log(`Target job id: ${JOB_ID}`);
  }

  if (runOnce) {
    const outcome = await processOneJob(token, {
      station: STATION,
      jobId: JOB_ID,
    });
    if (outcome?.apiCalls) {
      console.log("Local API calls:", outcome.apiCalls);
    }
    return;
  }

  console.log("Pass --once to process a single inbox job and exit.");
  console.log("Optional: --job-id <uuid> to claim a specific pending inbox job.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  apiCalls,
  processOneJob,
  trackedRequest,
  loadActionToken,
};
