const fs = require("fs");
const { spawnSync } = require("child_process");
const {
  loadRuntime,
  findWorkspace,
  findWorker,
  isPathUnderRoot,
} = require("./config");
const { writeJob, nowIso } = require("./jobs");

function validateJobWorkspace(job) {
  const runtime = loadRuntime();
  const workspace = findWorkspace(job.workspace);
  if (!workspace) {
    throw new Error(`Unknown workspace in job: ${job.workspace}`);
  }

  if (!findWorker(job.worker)) {
    throw new Error(`Unknown worker in job: ${job.worker}`);
  }

  const allowedRoot = runtime.safety.allowed_workspace_root;
  if (!isPathUnderRoot(job.workspace_path, allowedRoot)) {
    throw new Error(
      `Workspace path is outside allowed root (${allowedRoot}): ${job.workspace_path}`
    );
  }

  if (!fs.existsSync(job.workspace_path)) {
    throw new Error(`Workspace path does not exist: ${job.workspace_path}`);
  }

  return runtime;
}

function assertJobQueued(job) {
  if (job.status !== "queued") {
    throw new Error(`Job is not queued (status: ${job.status})`);
  }
}

function assertJobApproved(job) {
  if (job.status !== "approved") {
    throw new Error(`Job is not approved (status: ${job.status})`);
  }

  if (!job.approval || job.approval.approved !== true) {
    throw new Error("Job approval is required before execution");
  }
}

function assertConfirmExecution(confirmExecution) {
  const runtime = loadRuntime();
  if (runtime.safety.require_confirm_execution && !confirmExecution) {
    throw new Error("Refusing to execute without confirm_execution");
  }
}

function wrapCursorPrompt(job) {
  return `You are running as TimOS-Agent Cursor worker.
Workspace: ${job.workspace}
Rules:
- Make minimal focused changes only if necessary.
- Do not deploy.
- Do not push.
- Do not run git add or git commit.
- Do not touch .env, credentials, secrets, or production data.
- Do not run Supabase migrations.
- If the task can be answered by inspection only, do not modify files.
- After work, summarize files inspected, files changed, commands run, and remaining risk.

User task:
${job.prompt}`;
}

function buildCursorArgs(wrappedPrompt, job) {
  return [
    "--print",
    "--output-format",
    "text",
    "--mode",
    "ask",
    "--trust",
    "--workspace",
    job.workspace_path,
    wrappedPrompt,
  ];
}

function runGitCommand(workspacePath, gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: 120000,
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exit_code: result.status,
  };
}

function captureGitState(workspacePath) {
  const status = runGitCommand(workspacePath, ["status", "--short"]);
  const diffStat = runGitCommand(workspacePath, ["diff", "--stat"]);
  const diff = runGitCommand(workspacePath, ["diff"]);

  return {
    status_short: status.stdout,
    diff_stat: diffStat.stdout,
    diff: diff.stdout,
  };
}

function runCursorJob(job, runtime) {
  const { node_path, index_path } = runtime.cursor_agent;

  if (!fs.existsSync(node_path)) {
    throw new Error(`Cursor Agent node not found: ${node_path}`);
  }
  if (!fs.existsSync(index_path)) {
    throw new Error(`Cursor Agent index not found: ${index_path}`);
  }

  const wrappedPrompt = wrapCursorPrompt(job);
  const cursorArgs = buildCursorArgs(wrappedPrompt, job);

  job.status = "running";
  job.updated_at = nowIso();
  writeJob(job);

  let spawnResult;
  try {
    spawnResult = spawnSync(node_path, [index_path, ...cursorArgs], {
      cwd: job.workspace_path,
      encoding: "utf8",
      timeout: 3600000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    job.status = "failed";
    job.updated_at = nowIso();
    job.result = {
      stdout: "",
      stderr: "",
      exit_code: null,
      finished_at: nowIso(),
      error: err.message,
      git: captureGitState(job.workspace_path),
    };
    writeJob(job);
    throw err;
  }

  const exitCode = spawnResult.status;
  const git = captureGitState(job.workspace_path);

  job.result = {
    stdout: spawnResult.stdout || "",
    stderr: spawnResult.stderr || "",
    exit_code: exitCode,
    finished_at: nowIso(),
    git,
  };
  job.status = exitCode === 0 ? "completed" : "failed";
  job.updated_at = nowIso();
  writeJob(job);

  return job;
}

function executeWorker(job, runtime) {
  switch (job.worker) {
    case "manual":
      throw new Error("Manual jobs must be completed with job:complete.");
    case "codex":
      throw new Error("Codex worker is not available on this machine.");
    case "cursor":
      return runCursorJob(job, runtime);
    default:
      throw new Error(`Unsupported worker: ${job.worker}`);
  }
}

function dispatchQueuedJob(job, confirmExecution) {
  const runtime = validateJobWorkspace(job);
  assertJobQueued(job);
  assertConfirmExecution(confirmExecution);
  return executeWorker(job, runtime);
}

function dispatchApprovedJob(job, confirmExecution) {
  const runtime = validateJobWorkspace(job);
  assertJobApproved(job);
  assertConfirmExecution(confirmExecution);
  return executeWorker(job, runtime);
}

module.exports = {
  dispatchQueuedJob,
  dispatchApprovedJob,
};
