const crypto = require("crypto");
const { loadRepoSources, findRepoSource } = require("./repo-sources");

const ALLOWED_TASK_TYPES = ["inspect_only", "summarize_repo", "supervised_implement", "approved_finalize"];
const DEFAULT_WORKER_PROFILE = "cloud-readonly";
const ALLOWED_WORKER_PROFILES = [
  "cloud-readonly",
  "nova-reading",
  "joa",
  "finance",
  "jucore",
];
const PROFILE_TASK_TYPES = {
  "cloud-readonly": ["inspect_only", "summarize_repo"],
  "nova-reading": ["inspect_only", "summarize_repo"],
  joa: ["inspect_only", "supervised_implement", "approved_finalize"],
  finance: ["supervised_implement", "approved_finalize"],
  jucore: ["supervised_implement", "approved_finalize"],
};
const JOA_REPO_REF = "TimOS-Agent";
const JOA_WORKSPACE_REF = "C:\\projects\\TimOS-Agent";
const FINANCE_REPO_REF = "TimFinance";
const FINANCE_WORKSPACE_REF = "C:\\projects\\TimFinance";
const JUCORE_REPO_REF = "JuCore";
const JUCORE_WORKSPACE_REF = "C:\\projects\\JuCore";
const APPROVED_FINALIZE_CONTRACTS = {
  joa: {
    repo_ref: JOA_REPO_REF,
    workspace_ref: JOA_WORKSPACE_REF,
  },
  finance: {
    repo_ref: FINANCE_REPO_REF,
    workspace_ref: FINANCE_WORKSPACE_REF,
  },
  jucore: {
    repo_ref: JUCORE_REPO_REF,
    workspace_ref: JUCORE_WORKSPACE_REF,
  },
};
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

function normalizeRepoRef(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeWorkspaceRef(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .toLowerCase();
}

function validateRepoRefForProfile(workerProfile, repoRef) {
  if (!repoRef || typeof repoRef !== "string" || !repoRef.trim()) {
    return "repo_ref is required";
  }

  const finalizeContract = getApprovedFinalizeContract(workerProfile);
  if (finalizeContract) {
    if (normalizeRepoRef(repoRef) !== normalizeRepoRef(finalizeContract.repo_ref)) {
      return `repo_ref must be "${finalizeContract.repo_ref}" for target_worker_profile "${workerProfile}"`;
    }
    return null;
  }

  if (workerProfile === "cloud-readonly") {
    try {
      const { repos } = loadRepoSources();
      if (!findRepoSource(repoRef, repos)) {
        return `unknown repo_ref: ${repoRef}`;
      }
    } catch (err) {
      return err.message;
    }
    return null;
  }

  return null;
}

function getApprovedFinalizeContract(workerProfile) {
  return APPROVED_FINALIZE_CONTRACTS[workerProfile] || null;
}

function resolveApprovedFinalizeWorkspace(workerProfile) {
  return getApprovedFinalizeContract(workerProfile)?.workspace_ref || null;
}

function validateApprovedFinalizeContract({
  workerProfile,
  repoRef,
  workspaceRef,
}) {
  const errors = [];
  const contract = getApprovedFinalizeContract(workerProfile);

  if (!contract) {
    errors.push(
      `target_worker_profile "${workerProfile}" does not support approved_finalize`
    );
    return { ok: false, errors, workspaceRef: null, repoRef: null };
  }

  if (!repoRef || typeof repoRef !== "string" || !repoRef.trim()) {
    errors.push("repo_ref is required");
  } else if (normalizeRepoRef(repoRef) !== normalizeRepoRef(contract.repo_ref)) {
    errors.push(
      `repo_ref must be "${contract.repo_ref}" for target_worker_profile "${workerProfile}"`
    );
  }

  if (
    !workspaceRef ||
    typeof workspaceRef !== "string" ||
    !workspaceRef.trim()
  ) {
    errors.push(
      `workspace_ref is required for target_worker_profile "${workerProfile}"`
    );
  } else if (
    normalizeWorkspaceRef(workspaceRef) !==
    normalizeWorkspaceRef(contract.workspace_ref)
  ) {
    errors.push(
      `workspace_ref must be "${contract.workspace_ref}" for target_worker_profile "${workerProfile}"`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    workspaceRef: contract.workspace_ref,
    repoRef: contract.repo_ref,
  };
}

function validateWorkspaceRefForProfile(workerProfile, workspaceRef) {
  const contract = getApprovedFinalizeContract(workerProfile);
  if (!contract) {
    return null;
  }

  if (!workspaceRef || typeof workspaceRef !== "string" || !workspaceRef.trim()) {
    return `workspace_ref is required for target_worker_profile "${workerProfile}"`;
  }

  if (
    normalizeWorkspaceRef(workspaceRef) !==
    normalizeWorkspaceRef(contract.workspace_ref)
  ) {
    return `workspace_ref must be "${contract.workspace_ref}" for target_worker_profile "${workerProfile}"`;
  }

  return null;
}

function validateCreateJobInput(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["job payload is required"] };
  }

  const workerProfile = input.target_worker_profile || DEFAULT_WORKER_PROFILE;
  if (!ALLOWED_WORKER_PROFILES.includes(workerProfile)) {
    errors.push(
      `target_worker_profile must be one of: ${ALLOWED_WORKER_PROFILES.join(", ")}`
    );
  }

  const repoRefError = validateRepoRefForProfile(workerProfile, input.repo_ref);
  if (repoRefError) {
    errors.push(repoRefError);
  }

  const workspaceRefError = validateWorkspaceRefForProfile(
    workerProfile,
    input.workspace_ref
  );
  if (workspaceRefError) {
    errors.push(workspaceRefError);
  }

  const allowedTaskTypes =
    PROFILE_TASK_TYPES[workerProfile] || ALLOWED_TASK_TYPES;
  const taskType = input.task_type || "";
  if (!allowedTaskTypes.includes(taskType)) {
    errors.push(
      `task_type must be one of: ${allowedTaskTypes.join(", ")} for target_worker_profile "${workerProfile}"`
    );
  }

  const riskLevel = String(input.risk_level || "").toLowerCase();
  if (riskLevel !== "low") {
    errors.push('risk_level must be "low"');
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
  const workerProfile = input.target_worker_profile || DEFAULT_WORKER_PROFILE;

  return {
    id: jobId,
    requested_by: input.requested_by || "xiaoju",
    target_worker_profile: workerProfile,
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
  ALLOWED_WORKER_PROFILES,
  DEFAULT_WORKER_PROFILE,
  JOA_REPO_REF,
  JOA_WORKSPACE_REF,
  FINANCE_REPO_REF,
  FINANCE_WORKSPACE_REF,
  JUCORE_REPO_REF,
  JUCORE_WORKSPACE_REF,
  APPROVED_FINALIZE_CONTRACTS,
  TABLE_NAME,
  nowIso,
  getApprovedFinalizeContract,
  resolveApprovedFinalizeWorkspace,
  validateApprovedFinalizeContract,
  validateCreateJobInput,
  assertCreateJobInput,
  buildNewJobRecord,
  jobToSupabaseRow,
  supabaseRowToJob,
};
