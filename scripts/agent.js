#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACES_FILE = path.join(ROOT, "config", "workspaces.json");
const WORKERS_FILE = path.join(ROOT, "config", "workers.json");
const RUNTIME_FILE = path.join(ROOT, "config", "runtime.json");
const JOBS_DIR = path.join(ROOT, "data", "jobs");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadWorkspaces() {
  const data = loadJson(WORKSPACES_FILE);
  return data.workspaces || [];
}

function loadWorkers() {
  const data = loadJson(WORKERS_FILE);
  return data.workers || [];
}

function loadRuntime() {
  return loadJson(RUNTIME_FILE);
}

function findWorkspace(idOrName) {
  const key = idOrName.toLowerCase();
  return loadWorkspaces().find(
    (ws) =>
      ws.id.toLowerCase() === key || ws.name.toLowerCase() === key
  );
}

function findWorker(idOrName) {
  const key = idOrName.toLowerCase();
  return loadWorkers().find(
    (worker) =>
      worker.id.toLowerCase() === key || worker.name.toLowerCase() === key
  );
}

function ensureJobsDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobFilePath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

function listJobFiles() {
  ensureJobsDir();
  return fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(JOBS_DIR, name));
}

function readJob(id) {
  const filePath = jobFilePath(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJob(job) {
  ensureJobsDir();
  fs.writeFileSync(jobFilePath(job.id), JSON.stringify(job, null, 2) + "\n");
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgv(argv) {
  const flags = new Set();
  const positional = [];

  for (const arg of argv) {
    if (arg === "--confirm-execution") {
      flags.add("confirm-execution");
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function isPathUnderRoot(targetPath, rootPath) {
  const resolved = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolved);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function validateJobWorkspace(job, runtime) {
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

  return workspace;
}

function assertJobQueued(job) {
  if (job.status !== "queued") {
    throw new Error(`Job is not queued (status: ${job.status})`);
  }
}

function assertConfirmExecution(runtime, flags) {
  if (runtime.safety.require_confirm_execution && !flags.has("confirm-execution")) {
    throw new Error(
      "Refusing to execute without --confirm-execution"
    );
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

function dispatchJob(job, runtime, flags) {
  validateJobWorkspace(job, runtime);
  assertJobQueued(job);
  assertConfirmExecution(runtime, flags);

  switch (job.worker) {
    case "manual":
      console.error("Manual jobs must be completed with job:complete.");
      process.exit(1);
      break;
    case "codex":
      console.error("Codex worker is not available on this machine.");
      process.exit(1);
      break;
    case "cursor":
      return runCursorJob(job, runtime);
    default:
      throw new Error(`Unsupported worker: ${job.worker}`);
  }
}

function findOldestQueuedJob() {
  const jobs = listJobFiles()
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")))
    .filter((job) => job.status === "queued")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return jobs[0] || null;
}

function printUsage() {
  console.log(`TimOS-Agent v0.2.1

Usage:
  node scripts/agent.js workspaces
  node scripts/agent.js workers
  node scripts/agent.js job:create <workspace> <worker> "<prompt>"
  node scripts/agent.js jobs
  node scripts/agent.js job:show <job-id>
  node scripts/agent.js job:run-next --confirm-execution
  node scripts/agent.js job:run <job-id> --confirm-execution
  node scripts/agent.js job:complete <job-id> "<result>"
  node scripts/agent.js job:fail <job-id> "<error>"
`);
}

function cmdWorkspaces() {
  const workspaces = loadWorkspaces();
  if (workspaces.length === 0) {
    console.log("No workspaces registered.");
    return;
  }

  for (const ws of workspaces) {
    console.log(`${ws.id}\t${ws.name}\t${ws.path}`);
  }
}

function cmdWorkers() {
  const workers = loadWorkers();
  if (workers.length === 0) {
    console.log("No workers registered.");
    return;
  }

  for (const worker of workers) {
    console.log(`${worker.id}\t${worker.name}\t${worker.description}`);
  }
}

function cmdJobCreate(workspaceArg, workerArg, prompt) {
  if (!workspaceArg || !workerArg || !prompt) {
    console.error(
      'Usage: node scripts/agent.js job:create <workspace> <worker> "<prompt>"'
    );
    process.exit(1);
  }

  const workspace = findWorkspace(workspaceArg);
  if (!workspace) {
    console.error(`Unknown workspace: ${workspaceArg}`);
    console.error("Run `node scripts/agent.js workspaces` to see registered workspaces.");
    process.exit(1);
  }

  const worker = findWorker(workerArg);
  if (!worker) {
    console.error(`Unknown worker: ${workerArg}`);
    console.error("Run `node scripts/agent.js workers` to see registered workers.");
    process.exit(1);
  }

  const timestamp = nowIso();
  const job = {
    id: crypto.randomUUID(),
    workspace: workspace.id,
    workspace_path: workspace.path,
    worker: worker.id,
    prompt,
    status: "queued",
    created_at: timestamp,
    updated_at: timestamp,
    result: null,
  };

  writeJob(job);
  console.log(job.id);
}

function cmdJobs() {
  const files = listJobFiles();
  if (files.length === 0) {
    console.log("No jobs yet.");
    return;
  }

  const jobs = files
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  for (const job of jobs) {
    const preview =
      job.prompt.length > 50 ? job.prompt.slice(0, 47) + "..." : job.prompt;
    console.log(
      `${job.id}\t${job.status}\t${job.workspace}\t${job.worker}\t${job.created_at}\t${preview}`
    );
  }
}

function cmdJobShow(jobId) {
  if (!jobId) {
    console.error("Usage: node scripts/agent.js job:show <job-id>");
    process.exit(1);
  }

  const job = readJob(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  console.log(JSON.stringify(job, null, 2));
}

function cmdJobRunNext(argv) {
  const { flags } = parseArgv(argv);
  const runtime = loadRuntime();
  const job = findOldestQueuedJob();

  if (!job) {
    console.log("No queued jobs.");
    return;
  }

  try {
    const finished = dispatchJob(job, runtime, flags);
    if (finished) {
      console.log(finished.id);
      console.log(finished.status);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function cmdJobRun(argv) {
  const { flags, positional } = parseArgv(argv);
  const jobId = positional[0];

  if (!jobId) {
    console.error("Usage: node scripts/agent.js job:run <job-id> --confirm-execution");
    process.exit(1);
  }

  const job = readJob(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  const runtime = loadRuntime();

  try {
    const finished = dispatchJob(job, runtime, flags);
    if (finished) {
      console.log(finished.id);
      console.log(finished.status);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function cmdJobComplete(jobId, resultText) {
  if (!jobId || !resultText) {
    console.error('Usage: node scripts/agent.js job:complete <job-id> "<result>"');
    process.exit(1);
  }

  const job = readJob(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  job.status = "completed";
  job.updated_at = nowIso();
  job.result = {
    summary: resultText,
    finished_at: nowIso(),
  };
  writeJob(job);
  console.log(job.id);
  console.log(job.status);
}

function cmdJobFail(jobId, errorText) {
  if (!jobId || !errorText) {
    console.error('Usage: node scripts/agent.js job:fail <job-id> "<error>"');
    process.exit(1);
  }

  const job = readJob(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  job.status = "failed";
  job.updated_at = nowIso();
  job.result = {
    error: errorText,
    finished_at: nowIso(),
  };
  writeJob(job);
  console.log(job.id);
  console.log(job.status);
}

function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "workspaces":
      cmdWorkspaces();
      break;
    case "workers":
      cmdWorkers();
      break;
    case "job:create":
      cmdJobCreate(args[0], args[1], args.slice(2).join(" ").trim());
      break;
    case "jobs":
      cmdJobs();
      break;
    case "job:show":
      cmdJobShow(args[0]);
      break;
    case "job:run-next":
      cmdJobRunNext(args);
      break;
    case "job:run":
      cmdJobRun(args);
      break;
    case "job:complete":
      cmdJobComplete(args[0], args.slice(1).join(" ").trim());
      break;
    case "job:fail":
      cmdJobFail(args[0], args.slice(1).join(" ").trim());
      break;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
