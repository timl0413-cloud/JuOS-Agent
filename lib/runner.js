const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const {
  loadRuntime,
  findWorkspace,
  findWorker,
  isPathUnderRoot,
} = require("./config");
const { readJob, writeJob, nowIso, failJob } = require("./jobs");

const CURSOR_TIMEOUT_MS = 3600000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

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
  if (job.status !== "approved" && job.status !== "auto_running") {
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

function validateCursorRuntime(runtime) {
  const { node_path, index_path } = runtime.cursor_agent;

  if (!fs.existsSync(node_path)) {
    throw new Error(`Cursor Agent node not found: ${node_path}`);
  }
  if (!fs.existsSync(index_path)) {
    throw new Error(`Cursor Agent index not found: ${index_path}`);
  }

  return { node_path, index_path };
}

function markCursorJobRunning(job) {
  job.status = "running";
  job.updated_at = nowIso();
  writeJob(job);
}

function finalizeCursorJob(job, { stdout, stderr, exitCode, errorMessage }) {
  const git = captureGitState(job.workspace_path);

  job.result = {
    stdout: stdout || "",
    stderr: stderr || "",
    exit_code: exitCode,
    finished_at: nowIso(),
    git,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
  job.status = exitCode === 0 && !errorMessage ? "completed" : "failed";
  job.updated_at = nowIso();
  writeJob(job);
  return job;
}

function runCursorJob(job, runtime) {
  const { node_path, index_path } = validateCursorRuntime(runtime);
  const wrappedPrompt = wrapCursorPrompt(job);
  const cursorArgs = buildCursorArgs(wrappedPrompt, job);

  markCursorJobRunning(job);

  let spawnResult;
  try {
    spawnResult = spawnSync(node_path, [index_path, ...cursorArgs], {
      cwd: job.workspace_path,
      encoding: "utf8",
      timeout: CURSOR_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (err) {
    finalizeCursorJob(job, {
      stdout: "",
      stderr: "",
      exitCode: null,
      errorMessage: err.message,
    });
    throw err;
  }

  return finalizeCursorJob(job, {
    stdout: spawnResult.stdout,
    stderr: spawnResult.stderr,
    exitCode: spawnResult.status,
    errorMessage:
      spawnResult.error && spawnResult.error.message
        ? spawnResult.error.message
        : null,
  });
}

function runCursorJobAsync(job, runtime) {
  const { node_path, index_path } = validateCursorRuntime(runtime);
  const wrappedPrompt = wrapCursorPrompt(job);
  const cursorArgs = buildCursorArgs(wrappedPrompt, job);

  markCursorJobRunning(job);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminated = false;
    let terminationReason = null;

    const child = spawn(node_path, [index_path, ...cursorArgs], {
      cwd: job.workspace_path,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      terminated = true;
      terminationReason = "Cursor job timed out";
      child.kill();
    }, CURSOR_TIMEOUT_MS);

    function appendOutput(streamName, chunk) {
      const text = chunk.toString();
      const byteLength = Buffer.byteLength(text, "utf8");

      if (streamName === "stdout") {
        stdout += text;
        stdoutBytes += byteLength;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          terminated = true;
          terminationReason = "Cursor job stdout exceeded max buffer";
          child.kill();
        }
        return;
      }

      stderr += text;
      stderrBytes += byteLength;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        terminated = true;
        terminationReason = "Cursor job stderr exceeded max buffer";
        child.kill();
      }
    }

    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));

    child.on("error", (err) => {
      clearTimeout(timeout);
      const finished = finalizeCursorJob(job, {
        stdout,
        stderr,
        exitCode: null,
        errorMessage: err.message,
      });
      resolve(finished);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);

      const finished = finalizeCursorJob(job, {
        stdout,
        stderr,
        exitCode: terminated && exitCode === null ? null : exitCode,
        errorMessage: terminationReason,
      });
      resolve(finished);
    });
  });
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

function executeWorkerAsync(job, runtime) {
  switch (job.worker) {
    case "manual":
      return Promise.reject(
        new Error("Manual jobs must be completed with job:complete.")
      );
    case "codex":
      return Promise.reject(
        new Error("Codex worker is not available on this machine.")
      );
    case "cursor":
      return runCursorJobAsync(job, runtime);
    default:
      return Promise.reject(new Error(`Unsupported worker: ${job.worker}`));
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

function dispatchApprovedJobAsync(job, confirmExecution) {
  const runtime = validateJobWorkspace(job);
  assertJobApproved(job);
  assertConfirmExecution(confirmExecution);
  return executeWorkerAsync(job, runtime);
}

function scheduleApprovedJobRun(jobId, { onComplete, onError } = {}) {
  setImmediate(() => {
    try {
      const job = readJob(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      dispatchApprovedJobAsync(job, true)
        .then((finished) => {
          if (onComplete) {
            onComplete(null, finished);
          }
        })
        .catch((err) => {
          try {
            const current = readJob(jobId);
            if (
              current &&
              current.status !== "completed" &&
              current.status !== "failed"
            ) {
              failJob(jobId, err.message);
            }
          } catch {
            // ignore secondary failure while recording job error
          }

          if (onError) {
            onError(err);
          } else if (onComplete) {
            onComplete(err, readJob(jobId));
          }
        });
    } catch (err) {
      try {
        const current = readJob(jobId);
        if (
          current &&
          current.status !== "completed" &&
          current.status !== "failed"
        ) {
          failJob(jobId, err.message);
        }
      } catch {
        // ignore secondary failure while recording job error
      }

      if (onError) {
        onError(err);
      } else if (onComplete) {
        onComplete(err, readJob(jobId));
      }
    }
  });
}

module.exports = {
  dispatchQueuedJob,
  dispatchApprovedJob,
  dispatchApprovedJobAsync,
  scheduleApprovedJobRun,
};
