#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  claimJob,
  submitResult,
  DEFAULT_WORKER_PROFILE,
} = require("../lib/command-channel-coordinator");
const {
  JOA_REPO_REF,
  resolveApprovedFinalizeWorkspace,
  validateApprovedFinalizeContract,
} = require("../lib/command-channel-core");
const {
  isMultiWorkspaceProfile,
  isScopedWriteProfile,
  validateMultiWorkspaceJob,
  resolveExecutionWorkspaceRef,
  getResultReportContract,
  getProfileGuardrails,
  getScopedWritePrefix,
  validateWriteScopePaths,
} = require("../lib/workspace-target-registry");
const { executeCloudReadonlyJob } = require("../lib/cloud-readonly-worker");

const runOnce = process.argv.includes("--once");
const allowLaneClaim = process.argv.includes("--allow-lane");
const cursorHandoff = process.argv.includes("--cursor-handoff");
const submitHandoffResult = process.argv.includes("--submit-handoff-result");
const cursorAgent = process.argv.includes("--cursor-agent");
const quiet = process.argv.includes("--quiet");
const POLL_INTERVAL_MS = Number(
  process.env.COMMAND_CHANNEL_POLL_INTERVAL_MS || 5000
);

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
const EXECUTION_PROVIDER = resolveExecutionProvider();
const WORKER_PROFILE =
  parseWorkerProfileArg() ||
  process.env.COMMAND_CHANNEL_WORKER_PROFILE ||
  DEFAULT_WORKER_PROFILE;
const useHttp = process.argv.includes("--http");
const baseUrl =
  process.env.COMMAND_CHANNEL_URL ||
  `http://${process.env.COMMAND_CHANNEL_HOST || "127.0.0.1"}:${process.env.COMMAND_CHANNEL_PORT || 8790}`;

function getActiveWorkspaceRef() {
  const resolved = resolveApprovedFinalizeWorkspace(WORKER_PROFILE);
  if (resolved) {
    return resolved;
  }
  return process.cwd();
}

function formatWorkerContext(extra = {}) {
  const parts = [
    `worker_profile=${WORKER_PROFILE}`,
    `workspace=${getActiveWorkspaceRef()}`,
    `provider=${EXECUTION_PROVIDER}`,
  ];

  if (WORKER_PROFILE === "joa") {
    parts.push(`repo_ref=${JOA_REPO_REF}`);
  } else if (WORKER_PROFILE === "ob") {
    parts.push(`repo_ref=TimFinance`);
  } else if (WORKER_PROFILE === "finance") {
    parts.push(`repo_ref=TimFinance`);
  } else if (WORKER_PROFILE === "jucore") {
    parts.push(`repo_ref=JuCore`);
  } else if (WORKER_PROFILE === "nova") {
    parts.push(`repo_ref=Nova`);
  } else if (WORKER_PROFILE === "spacea") {
    parts.push(`repo_ref=multi-workspace`);
  } else if (WORKER_PROFILE === "stuf") {
    parts.push(`repo_ref=STUF`);
  } else if (WORKER_PROFILE === "ministry") {
    parts.push(`repo_ref=multi-workspace`);
  }

  parts.push(`mode=${useHttp ? "http" : "local"}`);
  if (useHttp) {
    parts.push(`url=${baseUrl}`);
  }

  for (const [key, value] of Object.entries(extra)) {
    if (value != null && value !== "") {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.join(" ");
}

function resolveExecutionProvider() {
  const raw =
    parseNamedArg("--provider") ||
    process.env.JUOS_WORKER_PROVIDER ||
    process.env.COMMAND_CHANNEL_WORKER_PROVIDER ||
    (cursorAgent ? "cursor" : "codex");
  const value = String(raw || "").toLowerCase();
  if (value === "cursor" || value === "codex") {
    return value;
  }
  throw new Error(`Unsupported provider "${raw}". Use codex or cursor.`);
}

function workerError(message, extra = {}) {
  const err = new Error(`${message} (${formatWorkerContext(extra)})`);
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWorkerRunMode({
  runOnce: onceFlag = runOnce,
  jobId = JOB_ID,
  submitHandoff = submitHandoffResult,
} = {}) {
  if (submitHandoff) {
    return "submit_handoff";
  }
  if (onceFlag || jobId) {
    return "once";
  }
  return "persistent";
}

function logJobClaimed(claimed) {
  console.log(
    `Job claimed: ${claimed.id} ${formatWorkerContext({
      task_type: claimed.task_type,
    })}`
  );
}

function logJobFinished(claimed, workerResult) {
  const status = workerResult?.status || "unknown";
  if (status === "failed") {
    console.error(`Job failed: ${claimed.id} status=${status}`);
    return;
  }
  console.log(`Job completed: ${claimed.id} status=${status}`);
}

function getWorkerToken() {
  if (process.env.WORKER_TOKEN) {
    return { token: process.env.WORKER_TOKEN, source: "env:WORKER_TOKEN" };
  }

  if (process.env.COMMAND_CHANNEL_WORKER_TOKEN) {
    return {
      token: process.env.COMMAND_CHANNEL_WORKER_TOKEN,
      source: "env:COMMAND_CHANNEL_WORKER_TOKEN",
    };
  }

  const { loadAuthTokens, findTokenByName } = require("../lib/auth");
  const { WORKER_TOKEN_NAME } = require("../lib/command-channel-auth");
  const tokens = loadAuthTokens();

  if (!tokens) {
    throw workerError("worker token missing: set WORKER_TOKEN or config/auth.json", {
      token_source: "none",
    });
  }

  const record = findTokenByName(WORKER_TOKEN_NAME, tokens);
  if (!record?.token || record.token === "replace-with-cloud-readonly-worker-secret") {
    throw workerError(`worker token "${WORKER_TOKEN_NAME}" is not configured`, {
      token_source: WORKER_TOKEN_NAME,
    });
  }

  return { token: record.token, source: WORKER_TOKEN_NAME };
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
    const { token } = options.token
      ? { token: options.token }
      : getWorkerToken();
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

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findCommandOnPath(commandNames) {
  const pathValue = process.env.PATH || "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const commandName of commandNames) {
    for (const dir of dirs) {
      const candidate = path.join(dir, commandName);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function findCodexCommand() {
  const command = findCommandOnPath(["codex.cmd", "codex.exe"]);
  if (!command) {
    throw new Error("Codex provider requested but codex.cmd/codex.exe was not found in PATH");
  }
  return command;
}


function normalizeWorkspaceRef(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .toLowerCase();
}

function readJobWorkPurpose(claimedJob) {
  return readJobContractField(claimedJob, "work_purpose");
}

function resolveJobWorkspaceRef(claimedJob) {
  const workspaceRef =
    claimedJob.workspace_ref || readJobContractField(claimedJob, "workspace_ref");

  if (isMultiWorkspaceProfile(WORKER_PROFILE)) {
    return (
      resolveExecutionWorkspaceRef(WORKER_PROFILE, workspaceRef) || process.cwd()
    );
  }

  if (workspaceRef) {
    return workspaceRef.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  }

  return process.cwd();
}

function validateJobWorkspaceContract(claimedJob) {
  if (!isMultiWorkspaceProfile(WORKER_PROFILE)) {
    return { ok: true, workspaceRef: resolveJobWorkspaceRef(claimedJob) };
  }

  const workspaceRef =
    claimedJob.workspace_ref || readJobContractField(claimedJob, "workspace_ref");
  const error = validateMultiWorkspaceJob(WORKER_PROFILE, {
    workspace_ref: workspaceRef,
    repo_ref: claimedJob.repo_ref,
    work_purpose: readJobWorkPurpose(claimedJob),
  });

  if (error) {
    return { ok: false, errors: [error], workspaceRef: null };
  }

  return {
    ok: true,
    workspaceRef: resolveExecutionWorkspaceRef(WORKER_PROFILE, workspaceRef),
  };
}

function buildResultReportPromptSection(workerProfile) {
  const fields = getResultReportContract(workerProfile);
  if (fields.length === 0) {
    return [];
  }

  const labels = {
    workspace_touched: "workspace touched",
    files_changed: "files changed",
    what_changed: "what changed",
    risks: "risks",
    check_or_preview_result: "check / preview result if applicable",
    what_tim_needs_to_review: "what Tim needs to review",
    skipped_due_to_guardrails: "anything skipped due to guardrails",
  };

  return [
    "Required result report sections:",
    ...fields.map((field) => `- ${labels[field] || field}`),
  ];
}

function buildProfileGuardrailPromptSection(workerProfile) {
  const guardrails = getProfileGuardrails(workerProfile);
  if (guardrails.length === 0) {
    return [];
  }

  return ["Profile guardrails:", ...guardrails.map((item) => `- ${item}`)];
}

function buildScopedWritePromptSection(workerProfile) {
  if (!isScopedWriteProfile(workerProfile)) {
    return [];
  }

  const prefix = getScopedWritePrefix(workerProfile);
  if (!prefix) {
    return [];
  }

  return [
    "Scoped write boundary:",
    `- All file writes MUST stay under ${prefix.replace(/\/+$/, "")}/ within the workspace root.`,
    `- Reject and report any path outside ${prefix.replace(/\/+$/, "")}/.`,
    "",
  ];
}

function buildProfilePromptSections(workerProfile) {
  if (!isMultiWorkspaceProfile(workerProfile) && !isScopedWriteProfile(workerProfile)) {
    return [];
  }

  return [
    ...buildScopedWritePromptSection(workerProfile),
    ...buildProfileGuardrailPromptSection(workerProfile),
    "",
    ...buildResultReportPromptSection(workerProfile),
    "",
  ];
}

function isSupervisedImplementJob(claimedJob) {
  return claimedJob?.task_type === "supervised_implement";
}

function isScopedWriteBridgeJob(claimedJob) {
  const profile = claimedJob?.target_worker_profile || WORKER_PROFILE;
  return isScopedWriteProfile(profile);
}

function isMultiWorkspaceBridgeJob(claimedJob) {
  const profile = claimedJob?.target_worker_profile || WORKER_PROFILE;
  return isMultiWorkspaceProfile(profile);
}

function isApprovedFinalizeJob(claimedJob) {
  return claimedJob?.task_type === "approved_finalize";
}

function getJobPayloadObject(claimedJob) {
  return claimedJob?.payload && typeof claimedJob.payload === "object"
    ? claimedJob.payload
    : {};
}

function readJobContractField(claimedJob, fieldName) {
  const payload = getJobPayloadObject(claimedJob);
  if (claimedJob?.[fieldName] != null) {
    return claimedJob[fieldName];
  }
  if (payload[fieldName] != null) {
    return payload[fieldName];
  }
  return null;
}

function readStringArrayField(claimedJob, fieldName) {
  const value = readJobContractField(claimedJob, fieldName);
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function validateApprovedFinalizeJob(claimedJob) {
  const errors = [];
  const approvalStatus = readJobContractField(claimedJob, "approval_status");

  if (approvalStatus !== "approved") {
    errors.push(
      `approval_status must be "approved", got ${JSON.stringify(approvalStatus)}`
    );
  }

  const targetWorkerProfile =
    claimedJob.target_worker_profile || WORKER_PROFILE;

  const allowlistPaths = readStringArrayField(claimedJob, "allowlist_paths");
  if (allowlistPaths.length === 0) {
    errors.push("allowlist_paths must contain at least one path");
  } else {
    const scopeError = validateWriteScopePaths(targetWorkerProfile, allowlistPaths);
    if (scopeError) {
      errors.push(scopeError);
    }
  }

  const message = readJobContractField(claimedJob, "message");
  if (!message || !String(message).trim()) {
    errors.push("message is required for approved_finalize");
  }

  if (targetWorkerProfile !== WORKER_PROFILE) {
    errors.push(
      `target_worker_profile must match running worker "${WORKER_PROFILE}", got ${JSON.stringify(targetWorkerProfile)}`
    );
  }

  const workspaceRef =
    claimedJob.workspace_ref || readJobContractField(claimedJob, "workspace_ref");
  const contractValidation = validateApprovedFinalizeContract({
    workerProfile: targetWorkerProfile,
    repoRef: claimedJob.repo_ref,
    workspaceRef,
    workPurpose: readJobWorkPurpose(claimedJob),
  });
  errors.push(...contractValidation.errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    allowlistPaths,
    ignorePaths: readStringArrayField(claimedJob, "ignore_paths"),
    message: String(message).trim(),
    targetBranch: readJobContractField(claimedJob, "target_branch"),
    workspaceRef: contractValidation.workspaceRef,
    targetWorkerProfile,
    repoRef: contractValidation.repoRef,
  };
}

function buildApprovedFinalizeFailureResult(claimedJob, errors, extra = {}) {
  return {
    status: "failed",
    worker_profile: WORKER_PROFILE,
    repo_ref: claimedJob.repo_ref || null,
    task_type: claimedJob.task_type || "approved_finalize",
    files_seen: [],
    summary: extra.summary || "approved_finalize validation failed",
    errors,
    safety: {
      cursor_called: false,
      snapshot_only: false,
      files_modified: false,
      shell_commands_executed: Boolean(extra.shell_commands_executed),
      local_api_called: false,
    },
    approved_finalize: {
      helper: "scripts/joa-finalize-reviewed.js",
      invoked: Boolean(extra.invoked),
      target_branch: extra.targetBranch || null,
      workspace_ref: extra.workspaceRef || null,
      exit_status: extra.exitStatus ?? null,
      stdout: extra.stdout || null,
      stderr: extra.stderr || null,
    },
  };
}

function runApprovedFinalizeForJob(claimedJob) {
  console.log(
    `Running approved_finalize ${formatWorkerContext({
      task_type: claimedJob.task_type,
      job_id: claimedJob.id,
    })}`
  );

  const validation = validateApprovedFinalizeJob(claimedJob);
  if (!validation.ok) {
    console.error(
      `approved_finalize validation failed: ${validation.errors.join("; ")}`
    );
    return buildApprovedFinalizeFailureResult(claimedJob, validation.errors);
  }

  const helperPath = path.join(__dirname, "joa-finalize-reviewed.js");
  const helperArgs = [helperPath];
  for (const filePath of validation.allowlistPaths) {
    helperArgs.push("--allowlist", filePath);
  }
  for (const filePath of validation.ignorePaths) {
    helperArgs.push("--ignore", filePath);
  }
  helperArgs.push("--message", validation.message, "--approve");
  helperArgs.push(
    "--worker-profile",
    validation.targetWorkerProfile,
    "--repo-ref",
    validation.repoRef,
    "--workspace-ref",
    validation.workspaceRef
  );

  const workspaceCwd = validation.workspaceRef;

  console.log(
    `Invoking finalize helper ${formatWorkerContext({
      task_type: claimedJob.task_type,
      workspace: workspaceCwd,
      allowlist_count: validation.allowlistPaths.length,
      ignore_count: validation.ignorePaths.length,
      target_branch: validation.targetBranch || "(default)",
    })}`
  );

  const helperRun = spawnSync(process.execPath, helperArgs, {
    cwd: workspaceCwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });

  const stdout = (helperRun.stdout || "").trim();
  const stderr = (helperRun.stderr || "").trim();
  const exitStatus = helperRun.status;
  const helperOk = exitStatus === 0 && !helperRun.error;

  if (helperRun.error) {
    return buildApprovedFinalizeFailureResult(
      claimedJob,
      [helperRun.error.message || String(helperRun.error)],
      {
        summary: "approved_finalize helper process failed",
        invoked: true,
        shell_commands_executed: true,
        targetBranch: validation.targetBranch,
        workspaceRef: validation.workspaceRef,
        exitStatus,
        stdout,
        stderr,
      }
    );
  }

  const filesSeen = validation.allowlistPaths.map((filePath) => ({
    path: filePath,
    type: "file",
  }));

  const summaryParts = [
    helperOk
      ? "approved_finalize helper completed successfully"
      : "approved_finalize helper failed",
  ];
  if (validation.targetBranch) {
    summaryParts.push(`target_branch=${validation.targetBranch}`);
  }
  if (stdout) {
    summaryParts.push(stdout);
  } else if (stderr) {
    summaryParts.push(stderr);
  }

  return {
    status: helperOk ? "completed" : "failed",
    worker_profile: WORKER_PROFILE,
    repo_ref: claimedJob.repo_ref || null,
    task_type: claimedJob.task_type || "approved_finalize",
    files_seen: filesSeen,
    summary: summaryParts.join("\n"),
    errors: helperOk
      ? []
      : [stderr || stdout || `helper exited with status ${exitStatus}`],
    safety: {
      cursor_called: false,
      snapshot_only: false,
      files_modified: helperOk,
      shell_commands_executed: true,
      local_api_called: false,
    },
    approved_finalize: {
      helper: "scripts/joa-finalize-reviewed.js",
      invoked: true,
      target_branch: validation.targetBranch,
      workspace_ref: validation.workspaceRef,
      allowlist_paths: validation.allowlistPaths,
      ignore_paths: validation.ignorePaths,
      exit_status: exitStatus,
      stdout: stdout || null,
      stderr: stderr || null,
    },
  };
}

function parseGitStatusPaths(statusShort) {
  const renameArrow = " -> ";

  return (statusShort || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = line.match(/^.. (.*)$/);
      let pathPart = (match ? match[1] : line.slice(3)).trim();
      if (pathPart.includes(renameArrow)) {
        pathPart = pathPart.split(renameArrow).pop().trim();
      }
      return pathPart;
    });
}

function readGitSnapshot(workspacePath) {
  const status = spawnSync("git", ["status", "--short"], {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  const diffStat = spawnSync("git", ["diff", "--stat"], {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  const statusFiles = parseGitStatusPaths(status.stdout || "");

  return {
    status_short: status.stdout || "",
    diff_stat: diffStat.stdout || "",
    diff_files: statusFiles,
    git_available: status.status === 0 || diffStat.status === 0,
  };
}
function buildCursorAgentPrompt(claimedJob) {
  const prompt = claimedJob.prompt || claimedJob.payload?.prompt || "";
  const supervised = isSupervisedImplementJob(claimedJob);
  const workerProfile = claimedJob.target_worker_profile || WORKER_PROFILE;
  const profileSections = buildProfilePromptSections(workerProfile);

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
      ...profileSections,
      "Job:",
      JSON.stringify(claimedJob, null, 2),
      "",
      "Task:",
      prompt || "No task prompt provided.",
    ].join("\n");
  }

  return [
    "You are Cursor Agent working under JuOS command-channel.",
    "",
    "Safety mode:",
    "- Do not modify files.",
    "- Do not run shell commands.",
    "- Analyze only.",
    "- Return a concise debug result.",
    "",
    ...profileSections,
    "Job:",
    JSON.stringify(claimedJob, null, 2),
    "",
    "Task:",
    prompt || "No task prompt provided.",
  ].join("\n");
}

function buildCodexAgentPrompt(claimedJob) {
  const prompt = claimedJob.prompt || claimedJob.payload?.prompt || "";
  const supervised = isSupervisedImplementJob(claimedJob);
  const workerProfile = claimedJob.target_worker_profile || WORKER_PROFILE;
  const profileSections = buildProfilePromptSections(workerProfile);

  return [
    "You are Codex working under JuOS command-channel.",
    "",
    supervised
      ? "Supervised implementation mode:"
      : "Inspection mode:",
    supervised
      ? "- Apply the requested local workspace code/file changes."
      : "- Analyze only unless the job explicitly authorizes edits.",
    "- Keep changes minimal and scoped to the requested workspace.",
    "- Do not commit.",
    "- Do not push.",
    "- Do not deploy.",
    "- Do not edit environment or protected-value files.",
    "- Do not reveal credential values.",
    "- Return a concise result with files changed, validation, and blockers.",
    "",
    ...profileSections,
    "Job:",
    JSON.stringify(claimedJob, null, 2),
    "",
    "Task:",
    prompt || "No task prompt provided.",
  ].join("\n");
}

function runCodexAgentForJob(claimedJob) {
  const workspaceValidation = validateJobWorkspaceContract(claimedJob);
  if (!workspaceValidation.ok) {
    return {
      status: "failed",
      worker_profile: WORKER_PROFILE,
      repo_ref: claimedJob.repo_ref || null,
      task_type: claimedJob.task_type || "codex_agent",
      files_seen: [],
      summary: "workspace routing validation failed",
      errors: workspaceValidation.errors,
      safety: {
        codex_called: false,
        cursor_called: false,
        snapshot_only: false,
        files_modified: false,
        shell_commands_executed: false,
        local_api_called: false,
      },
    };
  }

  const executionWorkspace = workspaceValidation.workspaceRef;
  const codexCommand = findCodexCommand();
  const prompt = buildCodexAgentPrompt(claimedJob);
  const supervised = isSupervisedImplementJob(claimedJob);

  const result = spawnSync(
    codexCommand,
    [
      "exec",
      "--cd",
      executionWorkspace,
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      prompt,
    ],
    {
      cwd: executionWorkspace,
      encoding: "utf8",
      timeout: supervised ? 10 * 60 * 1000 : 3 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  const gitSnapshot = supervised ? readGitSnapshot(executionWorkspace) : null;
  const workerProfile = claimedJob.target_worker_profile || WORKER_PROFILE;
  const writeScopeError =
    supervised && gitSnapshot?.diff_files?.length
      ? validateWriteScopePaths(workerProfile, gitSnapshot.diff_files)
      : null;
  const codexTimedOut = result.error?.code === "ETIMEDOUT";
  const resultStatus =
    writeScopeError || result.error || result.status !== 0 ? "failed" : "completed";

  return {
    status: resultStatus,
    worker_profile: WORKER_PROFILE,
    repo_ref: claimedJob.repo_ref || null,
    task_type: claimedJob.task_type || "codex_agent",
    workspace_ref: executionWorkspace,
    files_seen: gitSnapshot
      ? gitSnapshot.diff_files.map((filePath) => ({ path: filePath, type: "file" }))
      : [],
    summary: writeScopeError
      ? "supervised_implement write scope validation failed"
      : stdout || stderr || "Codex returned no output.",
    errors: writeScopeError
      ? [writeScopeError]
      : result.status === 0 && !result.error
        ? []
        : [stderr || result.error?.message || `Codex exited with status ${result.status}`],
    safety: {
      codex_called: true,
      cursor_called: false,
      snapshot_only: false,
      files_modified: false,
      shell_commands_executed: false,
      local_api_called: false,
    },
    codex_agent: {
      command: codexCommand,
      mode: supervised ? "supervised_implement" : "inspect",
      exit_status: result.status,
      stderr: stderr || null,
      timed_out: codexTimedOut,
    },
    git_snapshot: gitSnapshot,
  };
}

function runCursorAgentForJob(claimedJob) {
  const workspaceValidation = validateJobWorkspaceContract(claimedJob);
  if (!workspaceValidation.ok) {
    return {
      status: "failed",
      worker_profile: WORKER_PROFILE,
      repo_ref: claimedJob.repo_ref || null,
      task_type: claimedJob.task_type || "cursor_agent",
      files_seen: [],
      summary: "workspace routing validation failed",
      errors: workspaceValidation.errors,
      safety: {
        cursor_called: false,
        snapshot_only: false,
        files_modified: false,
        shell_commands_executed: false,
        local_api_called: false,
      },
    };
  }

  const executionWorkspace = workspaceValidation.workspaceRef;
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
      executionWorkspace,
      prompt,
    ],
    {
      cwd: executionWorkspace,
      encoding: "utf8",
      timeout: supervised ? 90 * 1000 : 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  const gitSnapshot = supervised ? readGitSnapshot(executionWorkspace) : null;
  const workerProfile = claimedJob.target_worker_profile || WORKER_PROFILE;
  const writeScopeError =
    supervised && gitSnapshot?.diff_files?.length
      ? validateWriteScopePaths(workerProfile, gitSnapshot.diff_files)
      : null;

  const cursorTimedOut = result.error?.code === "ETIMEDOUT";
  const supervisedChangedFiles =
    supervised && gitSnapshot && gitSnapshot.diff_files.length > 0;
  const cursorExitOk = result.status === 0;
  const resultStatus = writeScopeError
    ? "failed"
    : cursorExitOk || supervisedChangedFiles
      ? "completed"
      : "failed";

  if (result.error && !(supervised && cursorTimedOut && supervisedChangedFiles)) {
    throw result.error;
  }

  const resultReport =
    isMultiWorkspaceBridgeJob(claimedJob) || isScopedWriteBridgeJob(claimedJob)
      ? {
          required: true,
          sections: getResultReportContract(workerProfile),
          workspace_touched: executionWorkspace,
        }
      : null;

  const resultErrors = writeScopeError
    ? [writeScopeError]
    : result.status === 0
      ? []
      : [stderr || `Cursor Agent exited with status ${result.status}`];

  return {
    status: resultStatus,
    worker_profile: WORKER_PROFILE,
    repo_ref: claimedJob.repo_ref || null,
    task_type: claimedJob.task_type || "cursor_agent",
    workspace_ref: executionWorkspace,
    files_seen: gitSnapshot
      ? gitSnapshot.diff_files.map((filePath) => ({ path: filePath, type: "file" }))
      : [],
    summary: writeScopeError
      ? "supervised_implement write scope validation failed"
      : stdout ||
        stderr ||
        (cursorTimedOut
          ? "Cursor Agent timed out after supervised execution; runner submitted git snapshot."
          : "Cursor Agent returned no output."),
    errors: resultErrors,
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
    result_report: resultReport,
  };
}

async function processClaimedJob(claimedJob) {
  console.log(
    `Processing remote job: ${claimedJob.id} ${formatWorkerContext({
      task_type: claimedJob.task_type,
    })}`
  );

  if (isApprovedFinalizeJob(claimedJob)) {
    const workerResult = runApprovedFinalizeForJob(claimedJob);
    const finished = submitResult(claimedJob.id, workerResult);
    console.log(`Submitted result: ${finished.id} status=${finished.status}`);
    return { claimedJob, workerResult, finished };
  }

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
    throw workerError(
      `worker claim failed (${response.status}): ${JSON.stringify(response.data)}`,
      { step: "claim" }
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
    throw workerError(
      `worker result submit failed (${response.status}): ${JSON.stringify(response.data)}`,
      { step: "submit_result", job_id: jobId }
    );
  }

  return response.data;
}

async function processOneJob(options = {}) {
  const jobId = options.jobId ?? JOB_ID;
  const mode = options.mode || (useHttp ? "http" : "local");
  const laneClaimAllowed = allowLaneClaim || options.allowLaneClaim;

  if (!jobId && !laneClaimAllowed) {
    throw new Error(
      "Refusing to claim by lane without --job-id or --allow-lane. Use explicit assignment first."
    );
  }

  if (mode === "http") {
    const tokenRecord = options.token
      ? { token: options.token, source: "option" }
      : getWorkerToken();
    const claimed = await claimHttpJob(tokenRecord.token, jobId);
    if (!claimed) {
      if (!quiet && !options.suppressIdleLog) {
        console.log(`No pending remote jobs for worker_profile=${WORKER_PROFILE}`);
      }
      return null;
    }

    logJobClaimed(claimed);

    if (isApprovedFinalizeJob(claimed)) {
      const workerResult = runApprovedFinalizeForJob(claimed);
      const finished = await submitHttpResult(
        tokenRecord.token,
        claimed.id,
        workerResult
      );
      console.log(
        `Approved finalize result submitted: ${claimed.id} status=${workerResult.status}`
      );
      return { claimedJob: claimed, workerResult, finished };
    }

    if (EXECUTION_PROVIDER === "codex" || options.provider === "codex") {
      const workerResult = runCodexAgentForJob(claimed);
      const finished = await submitHttpResult(
        tokenRecord.token,
        claimed.id,
        workerResult
      );
      console.log(`Codex result submitted: ${claimed.id} status=${workerResult.status}`);
      return { claimedJob: claimed, workerResult, finished };
    }

    if (cursorAgent || options.cursorAgent || EXECUTION_PROVIDER === "cursor" || options.provider === "cursor") {
      const workerResult = runCursorAgentForJob(claimed);
      const finished = await submitHttpResult(
        tokenRecord.token,
        claimed.id,
        workerResult
      );
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
    const finished = await submitHttpResult(
      tokenRecord.token,
      claimed.id,
      workerResult
    );
    logJobFinished(claimed, workerResult);
    return { claimedJob: claimed, workerResult, finished };
  }

  const claimed = await claimLocalJob(jobId);
  if (!claimed) {
    if (!quiet && !options.suppressIdleLog) {
      console.log(`No pending remote jobs for worker_profile=${WORKER_PROFILE}`);
    }
    return null;
  }

  logJobClaimed(claimed);
  return processClaimedJob(claimed);
}

async function runPersistentWorker(options = {}) {
  const maxIterations = options.maxIterations ?? Infinity;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  let iterations = 0;

  if (!quiet) {
    console.log(
      `Persistent polling hub active ${formatWorkerContext({
        poll_interval_ms: pollIntervalMs,
      })}`
    );
    console.log("Press Ctrl+C to stop.");
  }

  while (iterations < maxIterations) {
    iterations += 1;

    try {
      const outcome = await processOneJob({
        ...options,
        allowLaneClaim: true,
        suppressIdleLog: true,
      });

      if (outcome) {
        continue;
      }

      if (iterations >= maxIterations) {
        break;
      }

      await sleep(pollIntervalMs);
    } catch (err) {
      console.error(`Worker error: ${err.message}`);
      if (iterations >= maxIterations) {
        throw err;
      }
      await sleep(pollIntervalMs);
    }
  }
}

async function main() {
  if (!quiet) {
    console.log(`Command channel worker ${formatWorkerContext()}`);
  }

  if (JOB_ID && !quiet) {
    console.log(`Target job id: ${JOB_ID}`);
  }

  if (submitHandoffResult) {
    await submitCursorHandoffResult({ jobId: JOB_ID, resultFile: RESULT_FILE });
    return;
  }

  const runMode = resolveWorkerRunMode();
  if (runMode === "once") {
    await processOneJob();
    return;
  }

  await runPersistentWorker();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  WORKER_PROFILE,
  POLL_INTERVAL_MS,
  processOneJob,
  processClaimedJob,
  runPersistentWorker,
  resolveWorkerRunMode,
  toWorkerJobPayload,
  isApprovedFinalizeJob,
  validateApprovedFinalizeJob,
  runApprovedFinalizeForJob,
  runCodexAgentForJob,
};





