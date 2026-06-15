const crypto = require("crypto");
const { loadRepoSources, findRepoSource } = require("./repo-sources");

const ALLOWED_TASK_TYPES = ["inspect_only", "summarize_repo"];
const DEFAULT_WORKER_PROFILE = "cloud-readonly";
const TABLE_NAME = "command_channel_jobs";

const FORBIDDEN_PROMPT_PHRASES = [
  "deploy",
  "push",
  "migration",
  "migrations",
];

function nowIso() {
  return new Date().toISOString();
}

function promptContainsForbidden(text) {
  const lower = String(text || "").toLowerCase();
  for (const phrase of FORBIDDEN_PROMPT_PHRASES) {
    if (lower.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}

function validateCreateJobInput(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["job payload is required"] };
  }

  if (!input.repo_ref) {
    errors.push("repo_ref is required");
  } else {
    try {
      const { repos } = loadRepoSources();
      if (!findRepoSource(input.repo_ref, repos)) {
        errors.push(`unknown repo_ref: ${input.repo_ref}`);
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  const taskType = input.task_type || "";
  if (!ALLOWED_TASK_TYPES.includes(taskType)) {
    errors.push(
      `task_type must be one of: ${ALLOWED_TASK_TYPES.join(", ")}`
    );
  }

  const riskLevel = String(input.risk_level || "").toLowerCase();
  if (riskLevel !== "low") {
    errors.push('risk_level must be "low"');
  }

  const workerProfile = input.target_worker_profile || DEFAULT_WORKER_PROFILE;
  if (workerProfile !== DEFAULT_WORKER_PROFILE) {
    errors.push(`target_worker_profile must be "${DEFAULT_WORKER_PROFILE}"`);
  }

  if (input.requires_local_credentials === true) {
    errors.push("local credentials are not allowed");
  }

  if (
    input.requires_local_files === true ||
    input.required_capabilities?.includes("local_files") ||
    input.required_capabilities?.includes("local_only_files")
  ) {
    errors.push("local-only files are not allowed");
  }

  const actions = Array.isArray(input.requested_actions)
    ? input.requested_actions
    : [];
  for (const action of actions) {
    const lower = String(action).toLowerCase();
    if (["deploy", "push", "migration", "migrations"].includes(lower)) {
      errors.push(`forbidden action: ${action}`);
    }
  }

  const forbiddenPrompt = promptContainsForbidden(input.prompt);
  if (forbiddenPrompt) {
    errors.push(`prompt contains forbidden phrase: ${forbiddenPrompt}`);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function buildNewJobRecord(input, jobId = crypto.randomUUID()) {
  const timestamp = nowIso();

  return {
    id: jobId,
    requested_by: input.requested_by || "xiaoju",
    target_worker_profile: DEFAULT_WORKER_PROFILE,
    repo_ref: input.repo_ref,
    workspace_ref: input.workspace_ref || null,
    task_type: input.task_type,
    risk_level: "low",
    auto_run_requested: true,
    prompt: input.prompt || null,
    status: "pending",
    created_at: timestamp,
    updated_at: timestamp,
    claimed_at: null,
    completed_at: null,
    claimed_by: null,
    result: null,
    errors: [],
  };
}

function jobToSupabaseRow(job) {
  return {
    id: job.id,
    requested_by: job.requested_by,
    target_worker_profile: job.target_worker_profile,
    repo_ref: job.repo_ref,
    task_type: job.task_type,
    risk_level: job.risk_level,
    auto_run_requested: job.auto_run_requested,
    status: job.status,
    payload: {
      workspace_ref: job.workspace_ref || null,
      prompt: job.prompt || null,
    },
    result: job.result,
    errors: job.errors || [],
    claimed_by: job.claimed_by || null,
    created_at: job.created_at,
    claimed_at: job.claimed_at,
    completed_at: job.completed_at,
    updated_at: job.updated_at,
  };
}

function supabaseRowToJob(row) {
  if (!row) {
    return null;
  }

  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};

  return {
    id: row.id,
    requested_by: row.requested_by,
    target_worker_profile: row.target_worker_profile,
    repo_ref: row.repo_ref,
    workspace_ref: payload.workspace_ref || null,
    task_type: row.task_type,
    risk_level: row.risk_level,
    auto_run_requested: row.auto_run_requested,
    prompt: payload.prompt || null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at,
    claimed_by: row.claimed_by || null,
    result: row.result ?? null,
    errors: Array.isArray(row.errors) ? row.errors : [],
  };
}

function assertCreateJobInput(input) {
  const validation = validateCreateJobInput(input);
  if (!validation.ok) {
    const err = new Error(validation.errors.join("; "));
    err.validation_errors = validation.errors;
    throw err;
  }
}

module.exports = {
  ALLOWED_TASK_TYPES,
  DEFAULT_WORKER_PROFILE,
  TABLE_NAME,
  nowIso,
  validateCreateJobInput,
  assertCreateJobInput,
  buildNewJobRecord,
  jobToSupabaseRow,
  supabaseRowToJob,
};
