const BACKEND_FILESYSTEM = "filesystem";
const BACKEND_SUPABASE = "supabase";

function getCommandChannelBackendName() {
  const backend = String(
    process.env.COMMAND_CHANNEL_BACKEND || BACKEND_FILESYSTEM
  ).toLowerCase();

  if (backend !== BACKEND_FILESYSTEM && backend !== BACKEND_SUPABASE) {
    throw new Error(
      `Invalid COMMAND_CHANNEL_BACKEND: ${backend} (use filesystem or supabase)`
    );
  }

  return backend;
}

function loadFilesystemBackend() {
  return require("./command-channel-coordinator");
}

function loadSupabaseBackend() {
  const supabase = require("./command-channel-supabase");
  if (!supabase.isSupabaseConfigured()) {
    const err = new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when COMMAND_CHANNEL_BACKEND=supabase"
    );
    err.code = "supabase_not_configured";
    throw err;
  }
  return supabase;
}

function getCommandChannelBackend() {
  const name = getCommandChannelBackendName();
  return name === BACKEND_SUPABASE
    ? loadSupabaseBackend()
    : loadFilesystemBackend();
}

function promisify(value) {
  return Promise.resolve(value);
}

async function createJob(input) {
  const backend = getCommandChannelBackend();
  return promisify(backend.createJob(input));
}

async function getJob(jobId) {
  const backend = getCommandChannelBackend();
  return promisify(backend.getJob(jobId));
}

async function listJobs(filter = {}) {
  const backend = getCommandChannelBackend();
  return promisify(backend.listJobs(filter));
}

async function claimJob(workerProfile, options = {}) {
  const backend = getCommandChannelBackend();
  return promisify(backend.claimJob(workerProfile, options));
}

async function submitResult(jobId, result) {
  const backend = getCommandChannelBackend();
  return promisify(backend.submitResult(jobId, result));
}

function getBackendStatus() {
  const backend = getCommandChannelBackendName();
  const status = { backend };

  if (backend === BACKEND_SUPABASE) {
    status.supabase_configured = require("./command-channel-supabase").isSupabaseConfigured();
  }

  return status;
}

function assertBackendReady() {
  getCommandChannelBackend();
}

module.exports = {
  BACKEND_FILESYSTEM,
  BACKEND_SUPABASE,
  getCommandChannelBackendName,
  getCommandChannelBackend,
  getBackendStatus,
  assertBackendReady,
  createJob,
  getJob,
  listJobs,
  claimJob,
  submitResult,
};
