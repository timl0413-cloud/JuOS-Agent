const fs = require("fs");
const path = require("path");
const { ROOT } = require("./config");
const {
  ALLOWED_TASK_TYPES,
  DEFAULT_WORKER_PROFILE,
  assertCreateJobInput,
  buildNewJobRecord,
  nowIso,
} = require("./command-channel-core");

const CHANNEL_ROOT = path.join(ROOT, "data", "command-channel");
const INBOX_DIR = path.join(CHANNEL_ROOT, "inbox");
const CLAIMED_DIR = path.join(CHANNEL_ROOT, "claimed");
const COMPLETED_DIR = path.join(CHANNEL_ROOT, "completed");
const FAILED_DIR = path.join(CHANNEL_ROOT, "failed");

const CHANNEL_DIRS = [INBOX_DIR, CLAIMED_DIR, COMPLETED_DIR, FAILED_DIR];

function ensureChannelDirs() {
  for (const dir of CHANNEL_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function jobFilePath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function readJobFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJobFile(dir, job) {
  ensureChannelDirs();
  fs.writeFileSync(jobFilePath(dir, job.id), JSON.stringify(job, null, 2) + "\n");
}

function moveJob(fromDir, toDir, job) {
  writeJobFile(toDir, job);
  const fromPath = jobFilePath(fromDir, job.id);
  if (fs.existsSync(fromPath)) {
    fs.unlinkSync(fromPath);
  }
}

function describeLocation(dir) {
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

function findJob(id) {
  for (const dir of CHANNEL_DIRS) {
    const job = readJobFile(jobFilePath(dir, id));
    if (job) {
      return { job, dir };
    }
  }
  return null;
}

function listAllJobs() {
  ensureChannelDirs();
  const jobs = [];

  for (const dir of CHANNEL_DIRS) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const job = readJobFile(path.join(dir, name));
      if (job) {
        jobs.push(job);
      }
    }
  }

  return jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function createJob(input) {
  assertCreateJobInput(input);
  const job = buildNewJobRecord(input);
  writeJobFile(INBOX_DIR, job);
  return job;
}

function getJob(jobId) {
  const found = findJob(jobId);
  return found ? found.job : null;
}

function listJobs(filter = {}) {
  let jobs = listAllJobs();

  if (filter.status) {
    const statusKey = String(filter.status).toLowerCase();
    jobs = jobs.filter(
      (job) => String(job.status).toLowerCase() === statusKey
    );
  }

  if (filter.requested_by) {
    jobs = jobs.filter((job) => job.requested_by === filter.requested_by);
  }

  if (filter.target_worker_profile) {
    jobs = jobs.filter(
      (job) => job.target_worker_profile === filter.target_worker_profile
    );
  }

  return jobs;
}

function listPendingJobs(workerProfile) {
  ensureChannelDirs();
  const profileKey = String(workerProfile).toLowerCase();

  return fs
    .readdirSync(INBOX_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJobFile(path.join(INBOX_DIR, name)))
    .filter(
      (job) =>
        job &&
        String(job.target_worker_profile).toLowerCase() === profileKey
    )
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function claimJob(workerProfile, options = {}) {
  const profileKey = String(workerProfile).toLowerCase();

  if (options.jobId) {
    const found = findJob(options.jobId);
    if (!found) {
      throw new Error(`Job not found: ${options.jobId}`);
    }

    const { job, dir } = found;

    if (dir !== INBOX_DIR) {
      throw new Error(
        `Job ${options.jobId} is not pending in inbox (currently ${describeLocation(dir)})`
      );
    }

    if (String(job.target_worker_profile).toLowerCase() !== profileKey) {
      throw new Error(
        `Worker profile mismatch for job ${options.jobId}: expected "${workerProfile}", got "${job.target_worker_profile}"`
      );
    }

    job.status = "claimed";
    job.claimed_at = nowIso();
    job.updated_at = job.claimed_at;
    job.claimed_by = workerProfile;
    moveJob(INBOX_DIR, CLAIMED_DIR, job);
    return job;
  }

  const pending = listPendingJobs(workerProfile);
  if (pending.length === 0) {
    return null;
  }

  const job = pending[0];
  job.status = "claimed";
  job.claimed_at = nowIso();
  job.updated_at = job.claimed_at;
  job.claimed_by = workerProfile;
  moveJob(INBOX_DIR, CLAIMED_DIR, job);
  return job;
}

function submitResult(jobId, result) {
  const found = findJob(jobId);
  if (!found) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const { job, dir } = found;

  if (dir !== CLAIMED_DIR) {
    throw new Error(
      `Job ${jobId} is not claimed (currently ${describeLocation(dir)})`
    );
  }

  const terminalStatus =
    result?.status === "completed" ? "completed" : "failed";

  const finished = {
    ...job,
    status: terminalStatus,
    updated_at: nowIso(),
    completed_at: nowIso(),
    result: result || null,
    errors: Array.isArray(result?.errors) ? result.errors : [],
  };

  const targetDir = terminalStatus === "completed" ? COMPLETED_DIR : FAILED_DIR;
  moveJob(CLAIMED_DIR, targetDir, finished);
  return finished;
}

module.exports = {
  CHANNEL_ROOT,
  INBOX_DIR,
  CLAIMED_DIR,
  COMPLETED_DIR,
  FAILED_DIR,
  ALLOWED_TASK_TYPES,
  DEFAULT_WORKER_PROFILE,
  ensureChannelDirs,
  validateCreateJobInput: require("./command-channel-core").validateCreateJobInput,
  createJob,
  getJob,
  listJobs,
  claimJob,
  submitResult,
  findJob,
};
