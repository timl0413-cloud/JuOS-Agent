#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { authFileExists, loadAuthTokens, findTokenByName } = require("../lib/auth");
const { POLICY_FILE } = require("../lib/policy");
const {
  STUB_DIRS,
  COMPLETED_DIR,
  FAILED_DIR,
  ensureStubDirs,
  stubDirsExist,
  buildDefaultStubJob,
  createStubInboxJob,
  findStationJob,
} = require("../lib/coordinator-stub");

const ACTION_TOKEN_NAME = "xiaoju-action-create-read";
const shouldRun = process.argv.includes("--run");
const shouldPreviewOnly = process.argv.includes("--preview");

function loadActionTokenInfo() {
  if (!authFileExists()) {
    console.log("config/auth.json is missing.");
    return null;
  }

  const tokens = loadAuthTokens();
  const record = findTokenByName(ACTION_TOKEN_NAME, tokens);

  if (!record) {
    console.log(`Token profile "${ACTION_TOKEN_NAME}" not found.`);
    return null;
  }

  if (!record.token || record.token === "replace-with-xiaoju-action-secret") {
    console.log(`Token profile "${ACTION_TOKEN_NAME}" is not configured.`);
    return null;
  }

  return record;
}

function checkPolicyConfig() {
  if (!fs.existsSync(POLICY_FILE)) {
    console.log("config/auto-run-policy.json is missing.");
    console.log("Copy config/auto-run-policy.json.example to config/auto-run-policy.json");
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

function validateStubLayout() {
  ensureStubDirs();
  if (!stubDirsExist()) {
    throw new Error("Coordinator stub directories are missing");
  }

  console.log("Coordinator stub directories:");
  for (const dir of STUB_DIRS) {
    console.log(`  ok ${path.relative(process.cwd(), dir)}`);
  }
}

function printPreviewJob() {
  const job = buildDefaultStubJob();
  console.log("");
  console.log("Preview stub station job (no file written with --preview):");
  console.log(JSON.stringify(job, null, 2));
  return job;
}

function assertNoApproveRunCalls(apiCalls) {
  for (const call of apiCalls) {
    if (call.path.includes("/approve") || call.path.includes("/run")) {
      throw new Error(`approve/run endpoint was called: ${call.method} ${call.path}`);
    }
  }
}

async function main() {
  console.log("Coordinator stub smoke test");

  validateStubLayout();

  const tokenInfo = loadActionTokenInfo();
  if (!tokenInfo) {
    process.exit(0);
  }
  console.log(`Action token profile ok: ${ACTION_TOKEN_NAME}`);

  if (!checkPolicyConfig()) {
    process.exit(0);
  }
  console.log("Auto-run policy ok");

  let stationJob;
  if (shouldPreviewOnly) {
    stationJob = printPreviewJob();
  } else {
    stationJob = createStubInboxJob();
    console.log("");
    console.log(`Created stub inbox job: ${stationJob.id}`);
  }

  if (!shouldRun) {
    console.log("");
    console.log("Dry run complete (pass --run to process stub job via station worker + Cursor).");
    process.exit(0);
  }

  if (shouldPreviewOnly) {
    throw new Error("Cannot use --preview with --run");
  }

  console.log("");
  console.log("Running station poll worker once...");
  console.log(`Expected station job id: ${stationJob.id}`);

  const worker = require("./station-poll-worker");
  const outcome = await worker.processOneJob(tokenInfo.token, {
    station: stationJob.station,
    jobId: stationJob.id,
  });

  if (!outcome || outcome.validation_failed || outcome.policy_rejected) {
    throw new Error("Station job did not complete successfully");
  }

  const claimedId = outcome.stationJob?.id;
  console.log(`Claimed station job id: ${claimedId || "none"}`);

  if (claimedId !== stationJob.id) {
    throw new Error(
      `Station job mismatch: expected ${stationJob.id}, worker claimed ${claimedId || "none"}`
    );
  }

  const found = findStationJob(stationJob.id);
  if (!found) {
    throw new Error(`Station job not found after worker run: ${stationJob.id}`);
  }

  const { job, dir } = found;
  if (dir !== COMPLETED_DIR) {
    throw new Error(
      `Expected completed stub job, found in ${path.basename(dir)} with status ${job.status}`
    );
  }

  if (!job.result?.local_job_id) {
    throw new Error("Completed station job missing local_job_id");
  }

  assertNoApproveRunCalls(outcome.apiCalls || worker.apiCalls);

  console.log("");
  console.log("Coordinator stub smoke test passed.");
  console.log(`  station_job_id: ${job.id}`);
  console.log(`  local_job_id: ${job.result.local_job_id}`);
  console.log(`  status: ${job.status}`);
  console.log(`  stdout_preview: ${(job.result.stdout_preview || "").slice(0, 120)}...`);
  console.log("  approve/run endpoints: not called");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
