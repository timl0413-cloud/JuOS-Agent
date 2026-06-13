#!/usr/bin/env node

const {
  loadWorkspaces,
  loadWorkers,
  loadPackageVersion,
} = require("../lib/config");
const {
  listJobs,
  readJob,
  findOldestQueuedJob,
  createCliJob,
  completeJob,
  failJob,
} = require("../lib/jobs");
const { dispatchQueuedJob } = require("../lib/runner");

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

function printUsage() {
  console.log(`TimOS-Agent v${loadPackageVersion()}

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

  try {
    const job = createCliJob(workspaceArg, workerArg, prompt);
    console.log(job.id);
  } catch (err) {
    console.error(err.message);
    if (err.message.startsWith("Unknown workspace")) {
      console.error("Run `node scripts/agent.js workspaces` to see registered workspaces.");
    }
    if (err.message.startsWith("Unknown worker")) {
      console.error("Run `node scripts/agent.js workers` to see registered workers.");
    }
    process.exit(1);
  }
}

function cmdJobs() {
  const jobs = listJobs();
  if (jobs.length === 0) {
    console.log("No jobs yet.");
    return;
  }

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
  const job = findOldestQueuedJob();

  if (!job) {
    console.log("No queued jobs.");
    return;
  }

  try {
    const finished = dispatchQueuedJob(job, flags.has("confirm-execution"));
    console.log(finished.id);
    console.log(finished.status);
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

  try {
    const finished = dispatchQueuedJob(job, flags.has("confirm-execution"));
    console.log(finished.id);
    console.log(finished.status);
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

  try {
    const job = completeJob(jobId, resultText);
    console.log(job.id);
    console.log(job.status);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function cmdJobFail(jobId, errorText) {
  if (!jobId || !errorText) {
    console.error('Usage: node scripts/agent.js job:fail <job-id> "<error>"');
    process.exit(1);
  }

  try {
    const job = failJob(jobId, errorText);
    console.log(job.id);
    console.log(job.status);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
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
