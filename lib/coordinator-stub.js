const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROOT, findWorkspace } = require("./config");
const { evaluateJobForAutoRun } = require("./policy");

const STUB_ROOT = path.join(ROOT, "data", "coordinator-stub");
const INBOX_DIR = path.join(STUB_ROOT, "inbox");
const CLAIMED_DIR = path.join(STUB_ROOT, "claimed");
const COMPLETED_DIR = path.join(STUB_ROOT, "completed");
const FAILED_DIR = path.join(STUB_ROOT, "failed");

const STUB_DIRS = [INBOX_DIR, CLAIMED_DIR, COMPLETED_DIR, FAILED_DIR];

const REQUIRED_SAFE_FIELDS = {
  station: "station1",
  worker: "cursor",
  mode: "read_only",
  task_type: "inspect_only",
  risk_level: "low",
  auto_run_requested: true,
};

function nowIso() {
  return new Date().toISOString();
}

function ensureStubDirs() {
  for (const dir of STUB_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function stubDirsExist() {
  return STUB_DIRS.every((dir) => fs.existsSync(dir));
}

function stationJobFilePath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function readStationJobFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeStationJobFile(dir, job) {
  ensureStubDirs();
  fs.writeFileSync(
    stationJobFilePath(dir, job.id),
    JSON.stringify(job, null, 2) + "\n"
  );
}

function moveStationJob(fromDir, toDir, job) {
  const fromPath = stationJobFilePath(fromDir, job.id);
  const toPath = stationJobFilePath(toDir, job.id);
  writeStationJobFile(toDir, job);
  if (fs.existsSync(fromPath)) {
    fs.unlinkSync(fromPath);
  }
  return toPath;
}

function resolveWorkspace(stationJob) {
  if (stationJob.workspace) {
    return stationJob.workspace;
  }

  if (stationJob.project_profile_id) {
    return stationJob.project_profile_id;
  }

  return null;
}

function validateActionSafeShape(stationJob) {
  const errors = [];

  if (!stationJob || typeof stationJob !== "object") {
    return { ok: false, errors: ["station job payload is required"] };
  }

  for (const [field, expected] of Object.entries(REQUIRED_SAFE_FIELDS)) {
    const actual = stationJob[field];
    if (field === "auto_run_requested") {
      if (actual !== true) {
        errors.push(`${field} must be true`);
      }
      continue;
    }

    if (String(actual || "").toLowerCase() !== String(expected).toLowerCase()) {
      errors.push(`${field} must be "${expected}" (got "${actual || ""}")`);
    }
  }

  const workspace = resolveWorkspace(stationJob);
  if (!workspace) {
    errors.push("workspace or project_profile_id is required");
  } else if (!findWorkspace(workspace)) {
    errors.push(`unknown workspace: ${workspace}`);
  }

  if (!stationJob.prompt || typeof stationJob.prompt !== "string") {
    errors.push("prompt is required");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const policyPreview = evaluateJobForAutoRun({
    station: stationJob.station,
    worker: stationJob.worker,
    mode: stationJob.mode,
    task_type: stationJob.task_type,
    risk_level: stationJob.risk_level,
    workspace,
    prompt: stationJob.prompt,
    auto_run_requested: true,
  });

  if (!policyPreview.eligible) {
    errors.push(`local auto-run policy would reject: ${policyPreview.reason}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    policy_preview: policyPreview,
    workspace,
  };
}

function buildDefaultStubJob(overrides = {}) {
  const timestamp = nowIso();
  return {
    id: crypto.randomUUID(),
    correlation_id: overrides.correlation_id || crypto.randomUUID(),
    project_profile_id: null,
    workspace: "TimOS-Agent",
    station: "station1",
    worker: "cursor",
    mode: "read_only",
    task_type: "inspect_only",
    risk_level: "low",
    auto_run_requested: true,
    requested_by: "xiaoju",
    prompt:
      "Inspect this repository and summarize the current structure. Do not modify files.",
    status: "pending",
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function createStubInboxJob(overrides = {}) {
  ensureStubDirs();
  const job = buildDefaultStubJob(overrides);
  job.status = "pending";
  writeStationJobFile(INBOX_DIR, job);
  return job;
}

function listInboxJobs(station) {
  ensureStubDirs();
  const stationKey = String(station).toLowerCase();

  return fs
    .readdirSync(INBOX_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readStationJobFile(path.join(INBOX_DIR, name)))
    .filter((job) => job && String(job.station).toLowerCase() === stationKey)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function claimNextInboxJob(station) {
  const pending = listInboxJobs(station);
  if (pending.length === 0) {
    return null;
  }

  const job = pending[0];
  job.status = "claimed";
  job.claimed_at = nowIso();
  job.updated_at = job.claimed_at;
  moveStationJob(INBOX_DIR, CLAIMED_DIR, job);
  return job;
}

function describeStubJobLocation(dir) {
  if (dir === INBOX_DIR) {
    return "inbox (pending)";
  }
  if (dir === CLAIMED_DIR) {
    return "claimed";
  }
  if (dir === COMPLETED_DIR) {
    return "completed";
  }
  if (dir === FAILED_DIR) {
    return "failed";
  }
  return "unknown";
}

function claimInboxJobById(station, jobId) {
  if (!jobId) {
    throw new Error("job id is required");
  }

  const found = findStationJob(jobId);
  if (!found) {
    throw new Error(`Station job not found: ${jobId}`);
  }

  const { job, dir } = found;
  const stationKey = String(station).toLowerCase();
  const jobStation = String(job.station || "").toLowerCase();

  if (dir !== INBOX_DIR) {
    throw new Error(
      `Station job ${jobId} is not pending in inbox (currently ${describeStubJobLocation(dir)})`
    );
  }

  if (jobStation !== stationKey) {
    throw new Error(
      `Station mismatch for job ${jobId}: expected station "${station}", got "${job.station || ""}"`
    );
  }

  job.status = "claimed";
  job.claimed_at = nowIso();
  job.updated_at = job.claimed_at;
  moveStationJob(INBOX_DIR, CLAIMED_DIR, job);
  return job;
}

function findStationJob(id) {
  for (const dir of STUB_DIRS) {
    const job = readStationJobFile(stationJobFilePath(dir, id));
    if (job) {
      return { job, dir };
    }
  }
  return null;
}

function buildResultPayload(stationJob, localJob) {
  const stdout = localJob.result?.stdout || "";
  return {
    station_job_id: stationJob.id,
    correlation_id: stationJob.correlation_id || null,
    local_job_id: localJob.id,
    status: localJob.status,
    policy_result: localJob.policy_result || null,
    approval: localJob.approval || null,
    stdout_preview: stdout.trim().slice(0, 500),
    stdout_length: stdout.length,
    error: localJob.result?.error || null,
    exit_code: localJob.result?.exit_code ?? null,
    finished_at: localJob.result?.finished_at || nowIso(),
    submitted_at: nowIso(),
  };
}

function completeClaimedJob(stationJob, localJob) {
  const result = buildResultPayload(stationJob, localJob);
  const finished = {
    ...stationJob,
    status: localJob.status === "completed" ? "completed" : "failed",
    updated_at: nowIso(),
    completed_at: nowIso(),
    result,
  };

  const targetDir =
    localJob.status === "completed" ? COMPLETED_DIR : FAILED_DIR;
  moveStationJob(CLAIMED_DIR, targetDir, finished);
  return finished;
}

function failClaimedJob(stationJob, reason, extra = {}) {
  const failed = {
    ...stationJob,
    status: "failed",
    updated_at: nowIso(),
    completed_at: nowIso(),
    result: {
      station_job_id: stationJob.id,
      correlation_id: stationJob.correlation_id || null,
      local_job_id: extra.local_job_id || null,
      status: "failed",
      error: reason,
      submitted_at: nowIso(),
      ...extra,
    },
  };

  moveStationJob(CLAIMED_DIR, FAILED_DIR, failed);
  return failed;
}

function toLocalApiJobBody(stationJob) {
  const workspace = resolveWorkspace(stationJob);
  return {
    station: stationJob.station,
    workspace,
    worker: stationJob.worker,
    mode: stationJob.mode,
    task_type: stationJob.task_type,
    risk_level: stationJob.risk_level,
    auto_run_requested: stationJob.auto_run_requested === true,
    requested_by: stationJob.requested_by || "xiaoju",
    prompt: stationJob.prompt,
  };
}

module.exports = {
  STUB_ROOT,
  INBOX_DIR,
  CLAIMED_DIR,
  COMPLETED_DIR,
  FAILED_DIR,
  STUB_DIRS,
  ensureStubDirs,
  stubDirsExist,
  validateActionSafeShape,
  buildDefaultStubJob,
  createStubInboxJob,
  listInboxJobs,
  claimNextInboxJob,
  claimInboxJobById,
  findStationJob,
  completeClaimedJob,
  failClaimedJob,
  toLocalApiJobBody,
  buildResultPayload,
};
