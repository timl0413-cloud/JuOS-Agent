const fs = require("fs");
const path = require("path");
const { isPathUnderRoot } = require("./config");
const {
  loadWorkerProfiles,
  evaluateWorkerEligibility,
} = require("./worker-routing");
const {
  resolveRepoRef,
  isWorkerAllowedForRepo,
} = require("./repo-sources");

const WORKER_PROFILE_ID = "cloud-readonly";
const ALLOWED_WORKER_PROFILE_IDS = [WORKER_PROFILE_ID, "nova-reading"];
const SUPPORTED_TASK_TYPES = ["inspect_only", "summarize_repo"];

const FORBIDDEN_PATH_SEGMENTS = [
  ".git",
  "node_modules",
  ".env",
  "credentials",
  "secrets",
  "tokens",
];

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_LISTED = 500;

function isForbiddenPathSegment(segment) {
  const lower = segment.toLowerCase();
  return FORBIDDEN_PATH_SEGMENTS.some(
    (forbidden) => lower === forbidden || lower.includes(forbidden)
  );
}

function shouldSkipEntry(name) {
  if (!name) {
    return true;
  }

  if (name.startsWith(".")) {
    return true;
  }

  return isForbiddenPathSegment(name);
}

function walkSnapshot(snapshotRoot, relativeDir = "") {
  const currentDir = path.join(snapshotRoot, relativeDir);
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) {
      continue;
    }

    const relativePath = relativeDir
      ? path.join(relativeDir, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      files.push({
        path: relativePath.replace(/\\/g, "/"),
        type: "directory",
        size_bytes: null,
      });

      if (files.length < MAX_FILES_LISTED) {
        const nested = walkSnapshot(snapshotRoot, relativePath);
        for (const nestedFile of nested) {
          if (files.length >= MAX_FILES_LISTED) {
            break;
          }
          files.push(nestedFile);
        }
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const absoluteFile = path.join(snapshotRoot, relativePath);
    const stat = fs.statSync(absoluteFile);

    files.push({
      path: relativePath.replace(/\\/g, "/"),
      type: "file",
      size_bytes: stat.size,
    });
  }

  return files;
}

function readSnapshotTextFile(snapshotRoot, relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const absoluteFile = path.resolve(snapshotRoot, normalized);

  if (!isPathUnderRoot(absoluteFile, snapshotRoot)) {
    throw new Error(`refusing path outside snapshot: ${relativePath}`);
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (shouldSkipEntry(segment) || isForbiddenPathSegment(segment)) {
      throw new Error(`refusing forbidden snapshot path: ${relativePath}`);
    }
  }

  if (!fs.existsSync(absoluteFile) || !fs.statSync(absoluteFile).isFile()) {
    return null;
  }

  const stat = fs.statSync(absoluteFile);
  if (stat.size > MAX_FILE_BYTES) {
    return null;
  }

  return fs.readFileSync(absoluteFile, "utf8");
}

function firstExistingText(snapshotRoot, candidates) {
  for (const candidate of candidates) {
    const content = readSnapshotTextFile(snapshotRoot, candidate);
    if (content) {
      return { path: candidate, content };
    }
  }

  return null;
}

function buildInspectSummary(filesSeen, resolvedRepo) {
  const fileCount = filesSeen.filter((item) => item.type === "file").length;
  const dirCount = filesSeen.filter((item) => item.type === "directory").length;

  return [
    `Repository snapshot: ${resolvedRepo.display_name}`,
    `repo_ref: ${resolvedRepo.repo_ref}`,
    `files: ${fileCount}, directories: ${dirCount}`,
    `top-level: ${filesSeen
      .filter((item) => !item.path.includes("/"))
      .map((item) => item.path)
      .join(", ")}`,
  ].join("\n");
}

function buildSummarizeRepoSummary(snapshotRoot, resolvedRepo, filesSeen) {
  const parts = [`# ${resolvedRepo.display_name}`, ""];

  const readme = firstExistingText(snapshotRoot, ["README.md", "readme.md"]);
  if (readme) {
    parts.push("## README excerpt");
    parts.push(readme.content.trim().split("\n").slice(0, 8).join("\n"));
    parts.push("");
  }

  const pkg = firstExistingText(snapshotRoot, ["package.json"]);
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content);
      parts.push("## package.json");
      parts.push(`- name: ${parsed.name || "unknown"}`);
      parts.push(`- version: ${parsed.version || "unknown"}`);
      if (parsed.description) {
        parts.push(`- description: ${parsed.description}`);
      }
      parts.push("");
    } catch {
      parts.push("## package.json");
      parts.push("(unreadable)");
      parts.push("");
    }
  }

  const statusDoc = firstExistingText(snapshotRoot, [
    "docs/status.md",
    "docs/README.md",
  ]);
  if (statusDoc) {
    parts.push("## docs excerpt");
    parts.push(statusDoc.content.trim().split("\n").slice(0, 6).join("\n"));
    parts.push("");
  }

  const fileCount = filesSeen.filter((item) => item.type === "file").length;
  parts.push("## Snapshot stats");
  parts.push(`- repo_ref: ${resolvedRepo.repo_ref}`);
  parts.push(`- visible files: ${fileCount}`);

  return parts.join("\n").trim();
}

function getCloudReadonlyProfile(profiles) {
  const profile = profiles.find((item) => item.id === WORKER_PROFILE_ID);
  if (!profile) {
    throw new Error(`worker profile not found: ${WORKER_PROFILE_ID}`);
  }
  return profile;
}

function buildFailureResult(job, errors, extra = {}) {
  return {
    status: "failed",
    worker_profile: WORKER_PROFILE_ID,
    repo_ref: job?.repo_ref || null,
    task_type: job?.task_type || null,
    files_seen: [],
    summary: null,
    safety: {
      shell_commands_executed: false,
      local_api_called: false,
      cursor_called: false,
      files_modified: false,
      snapshot_only: true,
    },
    errors,
    ...extra,
  };
}

function executeCloudReadonlyJob(job, context = {}) {
  const errors = [];

  if (!job || typeof job !== "object") {
    return buildFailureResult(null, ["job payload is required"]);
  }

  const { profiles } = loadWorkerProfiles();
  const profile = getCloudReadonlyProfile(profiles);

  if (
    job.target_worker_profile &&
    !ALLOWED_WORKER_PROFILE_IDS.includes(job.target_worker_profile)
  ) {
    return buildFailureResult(job, [
      `target_worker_profile must be one of: ${ALLOWED_WORKER_PROFILE_IDS.join(", ")} or omitted`,
    ]);
  }

  const routingContext = {
    station_online: context.station_online === true,
  };
  const routingJob = {
    ...job,
    target_worker_profile: WORKER_PROFILE_ID,
  };
  const eligibility = evaluateWorkerEligibility(routingJob, profile, routingContext);

  if (!eligibility.eligible) {
    return buildFailureResult(job, [eligibility.reason], {
      routing: eligibility,
    });
  }

  if (!job.repo_ref) {
    return buildFailureResult(job, ["repo_ref is required"]);
  }

  if (!SUPPORTED_TASK_TYPES.includes(job.task_type)) {
    return buildFailureResult(job, [
      `unsupported task_type for cloud-readonly POC: ${job.task_type}`,
    ]);
  }

  let resolvedRepo;
  try {
    resolvedRepo = resolveRepoRef(job.repo_ref);
  } catch (err) {
    return buildFailureResult(job, [err.message]);
  }

  if (!isWorkerAllowedForRepo(resolvedRepo, WORKER_PROFILE_ID)) {
    return buildFailureResult(job, [
      `worker profile "${WORKER_PROFILE_ID}" is not allowed for repo_ref "${job.repo_ref}"`,
    ]);
  }

  const filesSeen = walkSnapshot(resolvedRepo.absolute_path);

  let summary;
  if (job.task_type === "inspect_only") {
    summary = buildInspectSummary(filesSeen, resolvedRepo);
  } else if (job.task_type === "summarize_repo") {
    summary = buildSummarizeRepoSummary(
      resolvedRepo.absolute_path,
      resolvedRepo,
      filesSeen
    );
  }

  return {
    status: "completed",
    worker_profile: WORKER_PROFILE_ID,
    repo_ref: resolvedRepo.repo_ref,
    task_type: job.task_type,
    files_seen: filesSeen,
    summary,
    safety: {
      shell_commands_executed: false,
      local_api_called: false,
      cursor_called: false,
      files_modified: false,
      snapshot_only: true,
      forbidden_paths_skipped: FORBIDDEN_PATH_SEGMENTS,
    },
    errors,
    routing: eligibility,
    snapshot: {
      display_name: resolvedRepo.display_name,
      snapshot_path: resolvedRepo.snapshot_path,
      read_only: resolvedRepo.read_only,
    },
  };
}

module.exports = {
  WORKER_PROFILE_ID,
  SUPPORTED_TASK_TYPES,
  FORBIDDEN_PATH_SEGMENTS,
  executeCloudReadonlyJob,
  walkSnapshot,
  shouldSkipEntry,
};
