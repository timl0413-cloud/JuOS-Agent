const fs = require("fs");
const path = require("path");
const { ROOT, isPathUnderRoot } = require("./config");

const SOURCES_FILE = path.join(ROOT, "config", "repo-sources.json");
const SOURCES_EXAMPLE_FILE = path.join(
  ROOT,
  "config",
  "repo-sources.json.example"
);

function loadRepoSources() {
  const filePath = fs.existsSync(SOURCES_FILE)
    ? SOURCES_FILE
    : SOURCES_EXAMPLE_FILE;

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "repo sources config missing (config/repo-sources.json.example)"
    );
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const repos = data.repos || [];

  if (!Array.isArray(repos) || repos.length === 0) {
    throw new Error("repos must be a non-empty array");
  }

  return { repos, source: filePath };
}

function resolveSnapshotPath(snapshotPath) {
  const resolved = path.resolve(ROOT, snapshotPath);

  if (!isPathUnderRoot(resolved, ROOT)) {
    throw new Error(
      `snapshot_path escapes project root: ${snapshotPath}`
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`snapshot_path does not exist: ${snapshotPath}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`snapshot_path is not a directory: ${snapshotPath}`);
  }

  return resolved;
}

function findRepoSource(repoRef, repos) {
  const key = String(repoRef).toLowerCase();
  return (
    repos.find((repo) => String(repo.repo_ref).toLowerCase() === key) || null
  );
}

function resolveRepoRef(repoRef, options = {}) {
  const { repos } = options.repos
    ? { repos: options.repos }
    : loadRepoSources();

  if (!repoRef) {
    throw new Error("repo_ref is required");
  }

  const source = findRepoSource(repoRef, repos);
  if (!source) {
    throw new Error(`unknown repo_ref: ${repoRef}`);
  }

  const absolutePath = resolveSnapshotPath(source.snapshot_path);

  return {
    repo_ref: source.repo_ref,
    display_name: source.display_name || source.repo_ref,
    snapshot_path: source.snapshot_path,
    absolute_path: absolutePath,
    allowed_worker_profiles: source.allowed_worker_profiles || [],
    read_only: source.read_only !== false,
    source,
  };
}

function isWorkerAllowedForRepo(resolvedRepo, workerProfileId) {
  const allowed = resolvedRepo.allowed_worker_profiles || [];
  if (allowed.length === 0) {
    return true;
  }

  return allowed.includes(workerProfileId);
}

function getRepoSnapshotMetadata(resolvedRepo) {
  const entries = fs.readdirSync(resolvedRepo.absolute_path, {
    withFileTypes: true,
  });

  return {
    repo_ref: resolvedRepo.repo_ref,
    display_name: resolvedRepo.display_name,
    snapshot_path: resolvedRepo.snapshot_path,
    absolute_path: resolvedRepo.absolute_path,
    read_only: resolvedRepo.read_only,
    top_level_entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    })),
  };
}

module.exports = {
  SOURCES_FILE,
  SOURCES_EXAMPLE_FILE,
  loadRepoSources,
  resolveRepoRef,
  resolveSnapshotPath,
  findRepoSource,
  isWorkerAllowedForRepo,
  getRepoSnapshotMetadata,
};
