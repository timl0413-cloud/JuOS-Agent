const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROOT, findWorkspace, findWorker } = require("./config");

const JOBS_DIR = path.join(ROOT, "data", "jobs");

function nowIso() {
  return new Date().toISOString();
}

function ensureJobsDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobFilePath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
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

function listJobs() {
  ensureJobsDir();
  return fs
    .readdirSync(JOBS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((filePath) =>
      JSON.parse(fs.readFileSync(path.join(JOBS_DIR, filePath), "utf8"))
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function findOldestQueuedJob() {
  return (
    listJobs()
      .filter((job) => job.status === "queued")
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0] ||
    null
  );
}

function buildBaseJob(workspace, worker, prompt) {
  const timestamp = nowIso();
  return {
    id: crypto.randomUUID(),
    workspace: workspace.id,
    workspace_path: workspace.path,
    worker: worker.id,
    prompt,
    created_at: timestamp,
    updated_at: timestamp,
    result: null,
  };
}

function createCliJob(workspaceArg, workerArg, prompt) {
  const workspace = findWorkspace(workspaceArg);
  if (!workspace) {
    throw new Error(`Unknown workspace: ${workspaceArg}`);
  }

  const worker = findWorker(workerArg);
  if (!worker) {
    throw new Error(`Unknown worker: ${workerArg}`);
  }

  const job = {
    ...buildBaseJob(workspace, worker, prompt),
    status: "queued",
  };

  writeJob(job);
  return job;
}

function createApiJob({ workspace, worker, prompt, requested_by, mode }) {
  if (!workspace || !worker || !prompt) {
    throw new Error("workspace, worker, and prompt are required");
  }

  const ws = findWorkspace(workspace);
  if (!ws) {
    throw new Error(`Unknown workspace: ${workspace}`);
  }

  const w = findWorker(worker);
  if (!w) {
    throw new Error(`Unknown worker: ${worker}`);
  }

  const job = {
    ...buildBaseJob(ws, w, prompt),
    status: "needs_approval",
    requested_by: requested_by || null,
    mode: mode || null,
    approval: {
      required: true,
      approved: false,
      approved_by: null,
      approved_at: null,
      approval_note: null,
    },
  };

  writeJob(job);
  return job;
}

function approveJob(jobId, { approved_by, approval_note }) {
  if (!approved_by) {
    throw new Error("approved_by is required");
  }

  const job = readJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (job.status !== "needs_approval") {
    throw new Error(`Job is not awaiting approval (status: ${job.status})`);
  }

  job.status = "approved";
  job.approval.approved = true;
  job.approval.approved_by = approved_by;
  job.approval.approved_at = nowIso();
  job.approval.approval_note = approval_note || null;
  job.updated_at = nowIso();
  writeJob(job);
  return job;
}

function completeJob(jobId, resultText) {
  const job = readJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  job.status = "completed";
  job.updated_at = nowIso();
  job.result = {
    summary: resultText,
    finished_at: nowIso(),
  };
  writeJob(job);
  return job;
}

function failJob(jobId, errorText) {
  const job = readJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  job.status = "failed";
  job.updated_at = nowIso();
  job.result = {
    error: errorText,
    finished_at: nowIso(),
  };
  writeJob(job);
  return job;
}

module.exports = {
  JOBS_DIR,
  nowIso,
  readJob,
  writeJob,
  listJobs,
  findOldestQueuedJob,
  createCliJob,
  createApiJob,
  approveJob,
  completeJob,
  failJob,
};
