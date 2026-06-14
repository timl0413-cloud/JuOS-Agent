const fs = require("fs");
const path = require("path");
const { ROOT } = require("./config");

const PROFILES_FILE = path.join(ROOT, "config", "worker-profiles.json");
const PROFILES_EXAMPLE_FILE = path.join(
  ROOT,
  "config",
  "worker-profiles.json.example"
);

const JOB_FORBIDDEN_ACTIONS = [
  "deploy",
  "push",
  "migration",
  "migrations",
  "local credentials",
  "local-only files",
  "local only files",
];

function loadWorkerProfiles() {
  const filePath = fs.existsSync(PROFILES_FILE)
    ? PROFILES_FILE
    : PROFILES_EXAMPLE_FILE;

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "worker profiles config missing (config/worker-profiles.json.example)"
    );
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const profiles = data.worker_profiles || [];

  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("worker_profiles must be a non-empty array");
  }

  return { profiles, source: filePath };
}

function validateWorkerProfile(profile) {
  const errors = [];
  const requiredStringFields = ["id", "station", "location", "availability"];

  for (const field of requiredStringFields) {
    if (!profile[field] || typeof profile[field] !== "string") {
      errors.push(`${field} is required`);
    }
  }

  if (typeof profile.can_use_local_cursor !== "boolean") {
    errors.push("can_use_local_cursor must be a boolean");
  }

  if (
    !Array.isArray(profile.allowed_task_types) ||
    profile.allowed_task_types.length === 0
  ) {
    errors.push("allowed_task_types must be a non-empty array");
  }

  if (
    !Array.isArray(profile.allowed_risk_levels) ||
    profile.allowed_risk_levels.length === 0
  ) {
    errors.push("allowed_risk_levels must be a non-empty array");
  }

  if (!Array.isArray(profile.forbidden)) {
    errors.push("forbidden must be an array");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function promptContainsForbidden(text, forbiddenList) {
  const lower = String(text || "").toLowerCase();
  const combined = [...JOB_FORBIDDEN_ACTIONS, ...(forbiddenList || [])];

  for (const phrase of combined) {
    if (lower.includes(String(phrase).toLowerCase())) {
      return phrase;
    }
  }

  return null;
}

function jobRequiresLocalCredentials(job) {
  return (
    job.requires_local_credentials === true ||
    job.required_capabilities?.includes("local_credentials") ||
    job.required_capabilities?.includes("local_secrets")
  );
}

function jobRequiresLocalFiles(job) {
  return (
    job.requires_local_files === true ||
    job.required_capabilities?.includes("local_files") ||
    job.required_capabilities?.includes("local_only_files")
  );
}

function jobRequestsForbiddenAction(job, profile) {
  const actions = Array.isArray(job.requested_actions)
    ? job.requested_actions
    : [];

  for (const action of actions) {
    const hit = promptContainsForbidden(action, profile.forbidden);
    if (hit) {
      return hit;
    }
  }

  return promptContainsForbidden(job.prompt, profile.forbidden);
}

function isProfileAvailable(profile, context = {}) {
  if (profile.availability === "always_on") {
    return true;
  }

  if (profile.availability === "when_computer_on") {
    return context.station_online !== false;
  }

  return true;
}

function evaluateWorkerEligibility(job, profile, context = {}) {
  if (!job || typeof job !== "object") {
    return {
      eligible: false,
      profile_id: profile?.id || null,
      reason: "job payload is required",
    };
  }

  if (!profile || typeof profile !== "object") {
    return {
      eligible: false,
      profile_id: null,
      reason: "worker profile is required",
    };
  }

  if (job.target_worker_profile && job.target_worker_profile !== profile.id) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: `target_worker_profile is "${job.target_worker_profile}", not "${profile.id}"`,
    };
  }

  if (!isProfileAvailable(profile, context)) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: `worker profile "${profile.id}" is unavailable (${profile.availability})`,
    };
  }

  const taskType = job.task_type || "";
  if (!profile.allowed_task_types.includes(taskType)) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: `task_type "${taskType}" is not allowed for ${profile.id}`,
    };
  }

  const riskLevel = job.risk_level || "";
  if (!profile.allowed_risk_levels.includes(riskLevel)) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: `risk_level "${riskLevel}" is not allowed for ${profile.id}`,
    };
  }

  if (profile.requires_synced_repo && !job.repo_ref) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: `worker profile "${profile.id}" requires repo_ref`,
    };
  }

  if (jobRequiresLocalCredentials(job)) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: "job requires local credentials",
    };
  }

  if (jobRequiresLocalFiles(job)) {
    if (profile.location === "cloud" || profile.can_use_local_cursor === false) {
      return {
        eligible: false,
        profile_id: profile.id,
        reason: "job requires local-only files unavailable to cloud worker",
      };
    }
  }

  const forbiddenHit = jobRequestsForbiddenAction(job, profile);
  if (forbiddenHit) {
    return {
      eligible: false,
      profile_id: profile.id,
      reason: `job requests forbidden action: ${forbiddenHit}`,
    };
  }

  if (Array.isArray(job.required_capabilities)) {
    for (const capability of job.required_capabilities) {
      if (
        capability === "local_cursor" &&
        profile.can_use_local_cursor !== true
      ) {
        return {
          eligible: false,
          profile_id: profile.id,
          reason: "job requires local_cursor but worker cannot use local Cursor",
        };
      }

      if (
        (capability === "deploy" ||
          capability === "push" ||
          capability === "migration") &&
        profile.location === "cloud"
      ) {
        return {
          eligible: false,
          profile_id: profile.id,
          reason: `job requires ${capability} unavailable to cloud worker`,
        };
      }
    }
  }

  return {
    eligible: true,
    profile_id: profile.id,
    reason: `Worker profile "${profile.id}" satisfies job requirements`,
  };
}

function findEligibleWorkers(job, profiles, context = {}) {
  return profiles
    .map((profile) => evaluateWorkerEligibility(job, profile, context))
    .filter((result) => result.eligible);
}

function routeJob(job, profiles, context = {}) {
  const evaluations = profiles.map((profile) =>
    evaluateWorkerEligibility(job, profile, context)
  );
  const eligible = evaluations.filter((result) => result.eligible);

  return {
    evaluations,
    eligible,
    selected: eligible[0] || null,
  };
}

function buildSampleInspectJob(overrides = {}) {
  return {
    target_worker_profile: null,
    required_capabilities: [],
    workspace_ref: "TimOS-Agent",
    repo_ref: "github:timos-agent",
    task_type: "inspect_only",
    risk_level: "low",
    auto_run_requested: true,
    requested_by: "xiaoju",
    prompt:
      "Inspect this repository and summarize the current structure. Do not modify files.",
    result_contract: {
      format: "markdown_summary",
      include_files_changed: false,
    },
    ...overrides,
  };
}

module.exports = {
  PROFILES_FILE,
  PROFILES_EXAMPLE_FILE,
  loadWorkerProfiles,
  validateWorkerProfile,
  evaluateWorkerEligibility,
  findEligibleWorkers,
  routeJob,
  buildSampleInspectJob,
  isProfileAvailable,
};
