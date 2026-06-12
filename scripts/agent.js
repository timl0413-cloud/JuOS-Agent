#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACES_FILE = path.join(ROOT, "config", "workspaces.json");
const WORKERS_FILE = path.join(ROOT, "config", "workers.json");
const JOBS_DIR = path.join(ROOT, "data", "jobs");

function loadWorkspaces() {
  const raw = fs.readFileSync(WORKSPACES_FILE, "utf8");
  const data = JSON.parse(raw);
  return data.workspaces || [];
}

function loadWorkers() {
  const raw = fs.readFileSync(WORKERS_FILE, "utf8");
  const data = JSON.parse(raw);
  return data.workers || [];
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

function printUsage() {
  console.log(`TimOS-Agent v0.1

Usage:
  node scripts/agent.js workspaces
  node scripts/agent.js workers
  node scripts/agent.js job:create <workspace> <worker> "<prompt>"
  node scripts/agent.js jobs
  node scripts/agent.js job:show <job-id>
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
