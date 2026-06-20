const fs = require("fs");
const path = require("path");
const { ROOT } = require("./config");

const TARGETS_FILE = path.join(ROOT, "config", "workspace-targets.json");

const MULTI_WORKSPACE_PROFILES = ["spacea", "ministry"];

function loadWorkspaceTargetsConfig() {
  if (!fs.existsSync(TARGETS_FILE)) {
    throw new Error("workspace targets config missing (config/workspace-targets.json)");
  }
  return JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
}

function normalizeWorkspaceRef(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function normalizeRepoRef(value) {
  return String(value || "").trim();
}

function isMultiWorkspaceProfile(workerProfile) {
  return MULTI_WORKSPACE_PROFILES.includes(workerProfile);
}

function getProfileConfig(workerProfile) {
  const config = loadWorkspaceTargetsConfig();
  return config.profiles?.[workerProfile] || null;
}

function getAdminWorkPurposes() {
  const config = loadWorkspaceTargetsConfig();
  return config.admin_work_purposes || ["registry", "admin", "template", "shared_ops"];
}

function getAllowedTargets(workerProfile) {
  const profile = getProfileConfig(workerProfile);
  if (!profile) {
    return [];
  }
  return [...(profile.normal_targets || []), profile.admin_target].filter(Boolean);
}

function isBlockedParentPath(workerProfile, workspaceRef) {
  const profile = getProfileConfig(workerProfile);
  if (!profile?.blocked_parent) {
    return false;
  }
  return (
    normalizeWorkspaceRef(workspaceRef) ===
    normalizeWorkspaceRef(profile.blocked_parent)
  );
}

function isAdminWorkspace(workerProfile, workspaceRef) {
  const profile = getProfileConfig(workerProfile);
  if (!profile?.admin_target) {
    return false;
  }
  return (
    normalizeWorkspaceRef(workspaceRef) ===
    normalizeWorkspaceRef(profile.admin_target)
  );
}

function isAllowedNormalTarget(workerProfile, workspaceRef) {
  const profile = getProfileConfig(workerProfile);
  if (!profile?.normal_targets) {
    return false;
  }
  const normalized = normalizeWorkspaceRef(workspaceRef);
  return profile.normal_targets.some(
    (target) => normalizeWorkspaceRef(target) === normalized
  );
}

function isExactAllowedTarget(workerProfile, workspaceRef) {
  if (isBlockedParentPath(workerProfile, workspaceRef)) {
    return false;
  }
  return (
    isAllowedNormalTarget(workerProfile, workspaceRef) ||
    isAdminWorkspace(workerProfile, workspaceRef)
  );
}

function resolveExpectedWorkspaceForRepoRef(workerProfile, repoRef) {
  const profile = getProfileConfig(workerProfile);
  if (!profile) {
    return null;
  }

  const normalizedRepo = normalizeRepoRef(repoRef);
  if (!normalizedRepo) {
    return null;
  }

  if (
    profile.admin_repo_ref &&
    normalizeRepoRef(profile.admin_repo_ref).toLowerCase() ===
      normalizedRepo.toLowerCase()
  ) {
    return profile.admin_target;
  }

  const projectRefs = profile.project_refs || {};
  if (projectRefs[normalizedRepo]) {
    return projectRefs[normalizedRepo];
  }

  const caseInsensitiveMatch = Object.entries(projectRefs).find(
    ([key]) => key.toLowerCase() === normalizedRepo.toLowerCase()
  );
  return caseInsensitiveMatch ? caseInsensitiveMatch[1] : null;
}

function isMinistryOnlyRepoRef(repoRef) {
  const spaceaProfile = getProfileConfig("spacea");
  const refs = spaceaProfile?.ministry_only_refs || ["GospelFilm"];
  const normalized = normalizeRepoRef(repoRef).toLowerCase();
  return refs.some((item) => item.toLowerCase() === normalized);
}

function validateAdminWorkPurpose(workPurpose) {
  const purposes = getAdminWorkPurposes();
  const normalized = String(workPurpose || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "work_purpose is required for admin/shared ops workspace targets (_ClientOps, _MinistryOps)";
  }
  if (!purposes.includes(normalized)) {
    return `work_purpose must be one of: ${purposes.join(", ")} for admin/shared ops workspace targets`;
  }
  return null;
}

function validateWorkspaceTarget(workerProfile, workspaceRef, options = {}) {
  if (!isMultiWorkspaceProfile(workerProfile)) {
    return null;
  }

  if (!workspaceRef || typeof workspaceRef !== "string" || !workspaceRef.trim()) {
    return `workspace_ref is required for target_worker_profile "${workerProfile}"`;
  }

  if (isBlockedParentPath(workerProfile, workspaceRef)) {
    const profile = getProfileConfig(workerProfile);
    return `workspace_ref "${profile.blocked_parent}" is blocked; target a specific project folder instead`;
  }

  if (!isExactAllowedTarget(workerProfile, workspaceRef)) {
    const allowed = getAllowedTargets(workerProfile);
    return `workspace_ref must be one of the allowed targets for "${workerProfile}": ${allowed.join(", ")}`;
  }

  if (isAdminWorkspace(workerProfile, workspaceRef)) {
    return validateAdminWorkPurpose(options.workPurpose);
  }

  return null;
}

function validateRepoRefForMultiWorkspaceProfile(
  workerProfile,
  repoRef,
  workspaceRef,
  options = {}
) {
  if (!isMultiWorkspaceProfile(workerProfile)) {
    return null;
  }

  if (!repoRef || typeof repoRef !== "string" || !repoRef.trim()) {
    return "repo_ref is required";
  }

  if (workerProfile === "spacea" && isMinistryOnlyRepoRef(repoRef)) {
    return 'repo_ref "GospelFilm" belongs under MinistryOps (target_worker_profile "ministry"), not SpaceA';
  }

  if (workspaceRef) {
    const normalizedWorkspace = normalizeWorkspaceRef(workspaceRef);
    const gospelFilmPath = normalizeWorkspaceRef(
      "C:\\projects\\MinistryOps\\GospelFilm"
    );
    const spaceaParent = normalizeWorkspaceRef("C:\\projects\\SpaceA");

    if (
      workerProfile === "spacea" &&
      (normalizedWorkspace.includes("gospelfilm") ||
        normalizedWorkspace.startsWith(`${spaceaParent}\\gospelfilm`))
    ) {
      return "GospelFilm workspace targets must use target_worker_profile \"ministry\", not \"spacea\"";
    }

    if (isAdminWorkspace(workerProfile, workspaceRef)) {
      const profile = getProfileConfig(workerProfile);
      const expectedAdminRef = profile?.admin_repo_ref;
      if (
        expectedAdminRef &&
        normalizeRepoRef(repoRef).toLowerCase() !==
          normalizeRepoRef(expectedAdminRef).toLowerCase()
      ) {
        return `repo_ref must be "${expectedAdminRef}" for admin workspace "${profile.admin_target}"`;
      }
      return validateAdminWorkPurpose(options.workPurpose);
    }

    const expectedWorkspace = resolveExpectedWorkspaceForRepoRef(
      workerProfile,
      repoRef
    );
    if (
      expectedWorkspace &&
      normalizeWorkspaceRef(expectedWorkspace) !== normalizedWorkspace
    ) {
      return `repo_ref "${repoRef}" must target workspace "${expectedWorkspace}" for target_worker_profile "${workerProfile}"`;
    }

    if (
      !expectedWorkspace &&
      !isExactAllowedTarget(workerProfile, workspaceRef)
    ) {
      return `unknown repo_ref "${repoRef}" for target_worker_profile "${workerProfile}"`;
    }
  }

  return null;
}

function validateMultiWorkspaceJob(workerProfile, input = {}) {
  const workspaceRef = input.workspace_ref;
  const repoRef = input.repo_ref;

  if (!workspaceRef || typeof workspaceRef !== "string" || !workspaceRef.trim()) {
    return `workspace_ref is required for target_worker_profile "${workerProfile}"`;
  }

  if (workerProfile === "spacea" && isMinistryOnlyRepoRef(repoRef)) {
    return 'repo_ref "GospelFilm" belongs under MinistryOps (target_worker_profile "ministry"), not SpaceA';
  }

  const normalizedWorkspace = normalizeWorkspaceRef(workspaceRef);
  if (
    workerProfile === "spacea" &&
    (normalizedWorkspace.includes("gospelfilm") ||
      normalizedWorkspace.endsWith("\\gospelfilm"))
  ) {
    return 'GospelFilm workspace targets must use target_worker_profile "ministry", not "spacea"';
  }

  const workspaceError = validateWorkspaceTarget(workerProfile, workspaceRef, {
    workPurpose: input.work_purpose,
  });
  if (workspaceError) {
    return workspaceError;
  }

  return validateRepoRefForMultiWorkspaceProfile(
    workerProfile,
    repoRef,
    workspaceRef,
    { workPurpose: input.work_purpose }
  );
}

function validateApprovedFinalizeMultiWorkspace({
  workerProfile,
  repoRef,
  workspaceRef,
  workPurpose,
}) {
  const errors = [];

  const workspaceError = validateWorkspaceTarget(workerProfile, workspaceRef, {
    workPurpose,
  });
  if (workspaceError) {
    errors.push(workspaceError);
  }

  const repoError = validateRepoRefForMultiWorkspaceProfile(
    workerProfile,
    repoRef,
    workspaceRef,
    { workPurpose }
  );
  if (repoError) {
    errors.push(repoError);
  }

  return errors;
}

function getResultReportContract(workerProfile) {
  const profile = getProfileConfig(workerProfile);
  return profile?.result_report_fields || [];
}

function getProfileGuardrails(workerProfile) {
  const profile = getProfileConfig(workerProfile);
  return profile?.guardrails || [];
}

function resolveExecutionWorkspaceRef(workerProfile, workspaceRef) {
  if (!workspaceRef) {
    return null;
  }
  const error = validateWorkspaceTarget(workerProfile, workspaceRef);
  if (error) {
    return null;
  }
  const profile = getProfileConfig(workerProfile);
  const normalized = normalizeWorkspaceRef(workspaceRef);
  const match = getAllowedTargets(workerProfile).find(
    (target) => normalizeWorkspaceRef(target) === normalized
  );
  return match || workspaceRef.trim().replace(/\//g, "\\").replace(/\\+$/, "");
}

module.exports = {
  MULTI_WORKSPACE_PROFILES,
  TARGETS_FILE,
  normalizeWorkspaceRef,
  isMultiWorkspaceProfile,
  getProfileConfig,
  getAllowedTargets,
  isBlockedParentPath,
  isAdminWorkspace,
  isExactAllowedTarget,
  isMinistryOnlyRepoRef,
  validateWorkspaceTarget,
  validateRepoRefForMultiWorkspaceProfile,
  validateMultiWorkspaceJob,
  validateApprovedFinalizeMultiWorkspace,
  resolveExpectedWorkspaceForRepoRef,
  resolveExecutionWorkspaceRef,
  getResultReportContract,
  getProfileGuardrails,
  getAdminWorkPurposes,
};
