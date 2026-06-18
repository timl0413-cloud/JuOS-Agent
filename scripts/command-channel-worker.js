#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  claimJob,
  submitResult,
  DEFAULT_WORKER_PROFILE,
} = require("../lib/command-channel-coordinator");
const { executeCloudReadonlyJob } = require("../lib/cloud-readonly-worker");

const runOnce = process.argv.includes("--once");
const allowLaneClaim = process.argv.includes("--allow-lane");
const cursorHandoff = process.argv.includes("--cursor-handoff");
const submitHandoffResult = process.argv.includes("--submit-handoff-result");
const cursorAgent = process.argv.includes("--cursor-agent");
const quiet = process.argv.includes("--quiet");

function loadLocalWorkerEnv() {
  const fs = require("fs");
  const path = require("path");

  const candidates = [
    path.join(__dirname, "..", "config", "command-channel-worker.env"),
    path.join(process.cwd(), ".env.command-channel-worker"),
    path.join(process.cwd(), ".env.juos.prod.local"),
    path.join(process.cwd(), ".env.vercel.production.local"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;

    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

loadLocalWorkerEnv();
const RESULT_FILE = parseNamedArg("--result-file");

function parseNamedArg(flagName) {
  const eqArg = process.argv.find((arg) => arg.startsWith(`${flagName}=`));
  if (eqArg) {
    return eqArg.slice(flagName.length + 1);
  }

  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }

  return null;
}

function parseWorkerProfileArg() {
  return parseNamedArg("--worker-profile");
}

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
const WORKER_PROFILE =
  parseWorkerProfileArg() ||
  process.env.COMMAND_CHANNEL_WORKER_PROFILE ||
  DEFAULT_WORKER_PROFILE;
const useHttp = process.argv.includes("--http");
const baseUrl =
  process.env.COMMAND_CHANNEL_URL ||
  `http://${process.env.COMMAND_CHANNEL_HOST || "127.0.0.1"}:${process.env.COMMAND_CHANNEL_PORT || 8790}`;

function getWorkerToken() {
  if (process.env.WORKER_TOKEN) {
    return process.env.WORKER_TOKEN;
  }

  if (process.env.COMMAND_CHANNEL_WORKER_TOKEN) {
    return process.env.COMMAND_CHANNEL_WORKER_TOKEN;
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


function safeHandoffFileName(value) {
  return String(value || "job").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getCursorHandoffDir() {
  return path.join(process.cwd(), ".xiaoju", "cursor-handoffs");
}

function buildCursorHandoffContent(claimedJob) {
  const prompt = claimedJob.prompt || claimedJob.payload?.prompt || "";

  return [
    "# Cursor Handoff",
    "",
    `Job ID: ${claimedJob.id}`,
    `Target worker: ${claimedJob.target_worker_profile || ""}`,
    `Repo ref: ${claimedJob.repo_ref || ""}`,
    `Task type: ${claimedJob.task_type || ""}`,
    `Risk level: ${claimedJob.risk_level || ""}`,
    "",
    "## Cursor task",
    prompt || "**NO PROMPT FOUND ON JOB. Ask Tim/XiaoJu for task context before editing.**",
    "",
    "## Rules",
    "- Keep changes minimal.",
    "- Do not touch unrelated files.",
    "- Do not run destructive commands.",
    "- After work, paste summary and git diff/stat back to XiaoJu.",
    "",
    "## Raw job",
    "```json",
    JSON.stringify(claimedJob, null, 2),
    "```",
    "",
  ].join("\n");
}

function writeCursorHandoff(claimedJob) {
  const dir = getCursorHandoffDir();
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${safeHandoffFileName(claimedJob.id)}.md`);
  fs.writeFileSync(filePath, buildCursorHandoffContent(claimedJob), "utf8");

  return { filePath };
}


function getCursorResultDir() {
  return path.join(process.cwd(), ".xiaoju", "cursor-results");
}

function getCursorResultPath(jobId) {
  return path.join(getCursorResultDir(), `${safeHandoffFileName(jobId)}.json`);
}

function readCursorResult(jobId, resultFile) {
  const filePath = resultFile || getCursorResultPath(jobId);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Cursor result file not found: ${filePath}`);
  }

  const rawText = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const raw = JSON.parse(rawText);
  const status = raw.status === "failed" ? "failed" : "completed";
  const filesChanged = Array.isArray(raw.files_changed) ? raw.files_changed : [];

  return {
    filePath,
    result: {
      status,
      worker_profile: WORKER_PROFILE,
      repo_ref: raw.repo_ref || null,
      task_type: raw.task_type || "cursor_handoff",
      files_seen: filesChanged.map((filePath) => ({ path: filePath, type: "file" })),
      summary: raw.summary || "",
      errors: Array.isArray(raw.errors) ? raw.errors : [],
      safety: {
        cursor_called: true,
        snapshot_only: false,
        files_modified: raw.files_modified ?? filesChanged.length > 0,
        shell_commands_executed: raw.shell_commands_executed === true,
        local_api_called: raw.local_api_called === true,
      },
      cursor_handoff: {
        job_id: jobId,
        result_file: filePath,
        diff_stat: raw.diff_stat || null,
        notes: raw.notes || null,
      },
    },
  };
}

async function submitCursorHandoffResult(options = {}) {
  const jobId = options.jobId ?? JOB_ID;
  if (!jobId) {
    throw new Error("--job-id is required for --submit-handoff-result");
  }

  const { filePath, result } = readCursorResult(jobId, options.resultFile ?? RESULT_FILE);

  if (useHttp || options.mode === "http") {
    const token = options.token || getWorkerToken();
    const finished = await submitHttpResult(token, jobId, result);
    console.log(`Submitted Cursor handoff result: ${finished.job?.id || jobId} status=${finished.job?.status || result.status}`);
    console.log(`Result file: ${filePath}`);
    return { finished, result, filePath };
  }

  const finished = submitResult(jobId, result);
  console.log(`Submitted local Cursor handoff result: ${finished.id} status=${finished.status}`);
  console.log(`Result file: ${filePath}`);
  return { finished, result, filePath };
}


function findCursorAgentRuntime() {
  const root = path.join(process.env.LOCALAPPDATA || "", "cursor-agent");
  const versionsDir = path.join(root, "versions");

  if (!fs.existsSync(versionsDir)) {
    throw new Error(`Cursor agent versions directory not found: ${versionsDir}`);
  }

  const versions = fs
    .readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(versionsDir, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (versions.length === 0) {
    throw new Error(`No Cursor agent runtime versions found in ${versionsDir}`);
  }

  const runtimeDir = versions[0];
  const nodePath = path.join(runtimeDir, "node.exe");
  const indexPath = path.join(runtimeDir, "index.js");

  if (!fs.existsSync(nodePath) || !fs.existsSync(indexPath)) {
    throw new Error(`Cursor agent runtime missing node.exe or index.js in ${runtimeDir}`);
  }

  return { runtimeDir, nodePath, indexPath };
}


function isSupervisedImplementJob(claimedJob) {
  return claimedJob?.task_type === "supervised_implement";
}

function parseGitStatusPaths(statusShort) {
  return (statusShort || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pathPart = line.slice(3).trim();
      const renameArrow = " -> ";
      if (pathPart.includes(renameArrow)) {
        return pathPart.split(renameArrow).pop().trim();
      }
      return pathPart;
    });
}

function readGitSnapshot() {
  const status = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  const diffStat = spawnSync("git", ["diff", "--stat"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  const statusFiles = parseGitStatusPaths(status.stdout || "");

  return {
    status_short: status.stdout || "",
    diff_stat: diffStat.stdout || "",
    diff_files: statusFiles,
  };
}
function buildCursorAgentPrompt(claimedJob) {
  const prompt = claimedJob.prompt || claimedJob.payload?.prompt || "";
  const supervised = isSupervisedImplementJob(claimedJob);

  if (supervised) {
    return [
      "You are Cursor Agent working under XiaoJu command-channel.",
      "",
      "Supervised implementation mode:",
      "- Apply the requested local workspace code/file changes.",
      "- Keep the diff minimal and focused.",
      "- Do not commit.",
      "- Do not push.",
      "- Do not publish or deploy.",
      "- Do not edit environment files.",
      "- Do not expose credential values.",
      "- Prefer not to run shell commands unless the task explicitly asks for tests.",
      "- After edits, summarize what changed and what should be reviewed.",
      "",
      "Job:",
      JSON.stringify(claimedJob, null, 2),
      "",
      "Task:",
      prompt || "No task prompt provided.",
    ].join("\n");
  }

  return [
    "You are Cursor Agent working under XiaoJu/NovaReading command-channel.",
    "",
    "Safety mode:",
    "- Do not modify files.",
    "- Do not run shell commands.",
    "- Analyze only.",
    "- Return a concise debug result.",
    "",
    "Job:",
    JSON.stringify(claimedJob, null, 2),
    "",
    "Task:",
    prompt || "No task prompt provided.",
  ].join("\n");
}

function runCursorAgentForJob(claimedJob) {
  const runtime = findCursorAgentRuntime();
  const prompt = buildCursorAgentPrompt(claimedJob);
  const supervised = isSupervisedImplementJob(claimedJob);

  const result = spawnSync(
    runtime.nodePath,
    [
      runtime.indexPath,
      "--print",
      "--output-format",
      "text",
      ...(supervised ? ["--force"] : ["--mode", "ask"]),
      "--trust",
      "--workspace",
      process.cwd(),
      prompt,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: supervised ? 90 * 1000 : 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  const gitSnapshot = supervised ? readGitSnapshot() : null;
  const cursorTimedOut = result.error?.code === "ETIMEDOUT";
  const supervisedChangedFiles = supervised && gitSnapshot && gitSnapshot.diff_files.length > 0;
  const cursorExitOk = result.status === 0;
  const resultStatus = cursorExitOk || supervisedChangedFiles ? "completed" : "failed";

  if (result.error && !(supervised && cursorTimedOut && supervisedChangedFiles)) {
    throw result.error;
  }

  return {
    status: resultStatus,
    worker_profile: WORKER_PROFILE,
    repo_ref: claimedJob.repo_ref || null,
    task_type: claimedJob.task_type || "cursor_agent",
    files_seen: gitSnapshot ? gitSnapshot.diff_files.map((filePath) => ({ path: filePath, type: "file" })) : [],
    summary: stdout || stderr || (cursorTimedOut ? "Cursor Agent timed out after supervised execution; runner submitted git snapshot." : "Cursor Agent returned no output."),
    errors: result.status === 0 ? [] : [stderr || `Cursor Agent exited with status ${result.status}`],
    safety: {
      cursor_called: true,
      snapshot_only: false,
      files_modified: false,
      shell_commands_executed: false,
      local_api_called: false,
    },
    cursor_agent: {
      runtime_dir: runtime.runtimeDir,
      mode: supervised ? "supervised_implement" : "ask",
      exit_status: result.status,
      stderr: stderr || null,
      timed_out: cursorTimedOut,
    },
    git_snapshot: gitSnapshot,
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

  if (!jobId && !allowLaneClaim && !options.allowLaneClaim) {
    throw new Error(
      "Refusing to claim by lane without --job-id or --allow-lane. Use explicit assignment first."
    );
  }

  if (mode === "http") {
    const token = options.token || getWorkerToken();
    const claimed = await claimHttpJob(token, jobId);
    if (!claimed) {
      if (!quiet) {
        console.log(`No pending remote jobs for worker_profile=${WORKER_PROFILE}`);
      }
      return null;
    }

    if (cursorAgent || options.cursorAgent) {
      const workerResult = runCursorAgentForJob(claimed);
      const finished = await submitHttpResult(token, claimed.id, workerResult);
      console.log(`Cursor Agent result submitted: ${claimed.id} status=${workerResult.status}`);
      return { claimedJob: claimed, workerResult, finished };
    }

    if (cursorHandoff || options.cursorHandoff) {
      const handoff = writeCursorHandoff(claimed);
      console.log(`Cursor handoff created: ${handoff.filePath}`);
      console.log("Result not submitted. Complete the Cursor work, then report back to XiaoJu.");
      return { claimedJob: claimed, handoff };
    }

    const workerResult = executeCloudReadonlyJob(toWorkerJobPayload(claimed), {
      station_online: false,
    });
    const finished = await submitHttpResult(token, claimed.id, workerResult);
    return { claimedJob: claimed, workerResult, finished };
  }

  const claimed = await claimLocalJob(jobId);
  if (!claimed) {
    if (!quiet) {
      console.log(`No pending remote jobs for worker_profile=${WORKER_PROFILE}`);
    }
    return null;
  }

  return processClaimedJob(claimed);
}

async function main() {
  if (!quiet) {
    console.log(
      `Command channel worker profile=${WORKER_PROFILE} mode=${useHttp ? "http" : "local"}`
    );
  }

  if (JOB_ID && !quiet) {
    console.log(`Target job id: ${JOB_ID}`);
  }

  if (submitHandoffResult) {
    await submitCursorHandoffResult({ jobId: JOB_ID, resultFile: RESULT_FILE });
    return;
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





