#!/usr/bin/env node

const {
  claimJob,
  submitResult,
  DEFAULT_WORKER_PROFILE,
} = require("../lib/command-channel-coordinator");
const { executeCloudReadonlyJob } = require("../lib/cloud-readonly-worker");

const WORKER_PROFILE = DEFAULT_WORKER_PROFILE;
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
const useHttp = process.argv.includes("--http");
const baseUrl =
  process.env.COMMAND_CHANNEL_URL ||
  `http://${process.env.COMMAND_CHANNEL_HOST || "127.0.0.1"}:${process.env.COMMAND_CHANNEL_PORT || 8790}`;

function getWorkerToken() {
  if (process.env.WORKER_TOKEN) {
    return process.env.WORKER_TOKEN;
  }

  const { loadAuthTokens, findTokenByName } = require("../lib/auth");
  const { WORKER_TOKEN_NAME } = require("../lib/command-channel-auth");
  const tokens = loadAuthTokens();

  if (!tokens) {
    throw new Error("WORKER_TOKEN env or config/auth.json worker token required");
  }

  const record = findTokenByName(WORKER_TOKEN_NAME, tokens);
  if (!record?.token || record.token === "replace-with-cloud-readonly-worker-secret") {
    throw new Error("cloud-readonly-worker token is not configured");
  }

  return record.token;
}

async function httpRequest(method, urlPath, { body, token } = {}) {
  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${urlPath}`, {
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

function toWorkerJobPayload(claimedJob) {
  return {
    target_worker_profile: claimedJob.target_worker_profile,
    repo_ref: claimedJob.repo_ref,
    workspace_ref: claimedJob.workspace_ref,
    task_type: claimedJob.task_type,
    risk_level: claimedJob.risk_level,
    auto_run_requested: claimedJob.auto_run_requested,
    requested_by: claimedJob.requested_by,
    prompt: claimedJob.prompt,
  };
}

async function processClaimedJob(claimedJob) {
  console.log(`Processing remote job: ${claimedJob.id} task_type=${claimedJob.task_type}`);

  const workerResult = executeCloudReadonlyJob(toWorkerJobPayload(claimedJob), {
    station_online: false,
  });

  const finished = submitResult(claimedJob.id, workerResult);

  console.log(`Submitted result: ${finished.id} status=${finished.status}`);
  return { claimedJob, workerResult, finished };
}

async function claimLocalJob(jobId) {
  if (jobId) {
    return claimJob(WORKER_PROFILE, { jobId });
  }
  return claimJob(WORKER_PROFILE);
}

async function claimHttpJob(token, jobId) {
  const query = new URLSearchParams({ worker_profile: WORKER_PROFILE });
  if (jobId) {
    query.set("job_id", jobId);
  }

  const response = await httpRequest("GET", `/worker/jobs/next?${query}`, {
    token,
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Worker claim failed (${response.status}): ${JSON.stringify(response.data)}`
    );
  }

  return response.data.job;
}

async function submitHttpResult(token, jobId, result) {
  const response = await httpRequest("POST", `/worker/jobs/${jobId}/result`, {
    token,
    body: result,
  });

  if (!response.ok) {
    throw new Error(
      `Worker result submit failed (${response.status}): ${JSON.stringify(response.data)}`
    );
  }

  return response.data;
}

async function processOneJob(options = {}) {
  const jobId = options.jobId ?? JOB_ID;
  const mode = options.mode || (useHttp ? "http" : "local");

  if (mode === "http") {
    const token = options.token || getWorkerToken();
    const claimed = await claimHttpJob(token, jobId);
    if (!claimed) {
      console.log(`No pending remote jobs for worker_profile=${WORKER_PROFILE}`);
      return null;
    }

    const workerResult = executeCloudReadonlyJob(toWorkerJobPayload(claimed), {
      station_online: false,
    });
    const finished = await submitHttpResult(token, claimed.id, workerResult);
    return { claimedJob: claimed, workerResult, finished };
  }

  const claimed = await claimLocalJob(jobId);
  if (!claimed) {
    console.log(`No pending remote jobs for worker_profile=${WORKER_PROFILE}`);
    return null;
  }

  return processClaimedJob(claimed);
}

async function main() {
  console.log(
    `Command channel worker profile=${WORKER_PROFILE} mode=${useHttp ? "http" : "local"}`
  );

  if (JOB_ID) {
    console.log(`Target job id: ${JOB_ID}`);
  }

  if (!runOnce) {
    console.log("Pass --once to claim and process one job.");
    console.log("Optional: --job-id <uuid>  --http for HTTP polling mode.");
    return;
  }

  await processOneJob();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  WORKER_PROFILE,
  processOneJob,
  processClaimedJob,
  toWorkerJobPayload,
};
