#!/usr/bin/env node
/**
 * JOA local helper: finalize already-reviewed workspace changes safely.
 *
 * Preview (no git writes):
 *   node scripts/joa-finalize-reviewed.js \
 *     --allowlist lib/command-channel-core.js scripts/command-channel-worker.js \
 *     --ignore scripts/joa-finalize-reviewed.js \
 *     --message "Describe the reviewed change"
 *
 * Commit and push (requires explicit approval):
 *   node scripts/joa-finalize-reviewed.js \
 *     --allowlist lib/foo.js \
 *     --ignore scripts/unrelated-dirty.js \
 *     --message "Describe the reviewed change" \
 *     --approve
 *
 * Safety:
 * - JOA workspace only (C:\projects\TimOS-Agent)
 * - Pending paths must exactly match allowlist plus ignore list
 * - Refuses when any modified path is outside allowlist/ignore list
 * - Refuses when allowlisted or ignored paths are missing from pending changes
 * - Ignored paths are reported and never included in git add/commit/push
 * - git add/commit/push run only with --approve
 */

const { spawnSync } = require("child_process");
const path = require("path");
const {
  JOA_REPO_REF,
  JOA_WORKSPACE_REF,
} = require("../lib/command-channel-core");

const WORKER_PROFILE = "joa";

function parseNamedArg(flagName) {
  const eqArg = process.argv.find((arg) => arg.startsWith(`${flagName}=`));
  if (eqArg) {
    return eqArg.slice(flagName.length + 1);
  }

  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }

  return null;
}

function parseRepeatedPathArgs(flagName) {
  const paths = [];

  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flagName && process.argv[index + 1]) {
      paths.push(process.argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${flagName}=`)) {
      paths.push(arg.slice(flagName.length + 1));
    }
  }

  return paths;
}

function parseAllowlistArgs() {
  return parseRepeatedPathArgs("--allowlist");
}

function parseIgnoreArgs() {
  return parseRepeatedPathArgs("--ignore");
}

function normalizeRepoPath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function normalizeWorkspaceRef(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .toLowerCase();
}

function formatWorkerContext(extra = {}) {
  const parts = [
    `worker_profile=${WORKER_PROFILE}`,
    `workspace=${JOA_WORKSPACE_REF}`,
    `repo_ref=${JOA_REPO_REF}`,
  ];
  for (const [key, value] of Object.entries(extra)) {
    if (value != null && value !== "") {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(" ");
}

function fail(message, extra = {}) {
  throw new Error(`${message} (${formatWorkerContext(extra)})`);
}

function runGit(args, cwd, options = {}) {
  const { trim = true } = options;
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    fail(`git ${args.join(" ")} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    fail(`git ${args.join(" ")} exited ${result.status}${detail ? `: ${detail}` : ""}`);
  }

  const stdout = result.stdout || "";
  return trim ? stdout.trim() : stdout.replace(/\r?\n$/, "");
}

function parseGitStatusPaths(statusShort) {
  const renameArrow = " -> ";

  return (statusShort || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = line.match(/^.. (.*)$/);
      let pathPart = (match ? match[1] : line.slice(3)).trim();
      if (pathPart.includes(renameArrow)) {
        pathPart = pathPart.split(renameArrow).pop().trim();
      }
      return pathPart;
    });
}

function readPendingChanges(cwd) {
  const statusShort = runGit(["status", "--short"], cwd, { trim: false });
  const diffStat = runGit(["diff", "--stat"], cwd);
  const pendingPaths = parseGitStatusPaths(statusShort).map(normalizeRepoPath);

  return {
    status_short: statusShort,
    diff_stat: diffStat,
    pending_paths: pendingPaths,
  };
}

function validateWorkspace(cwd) {
  const resolved = path.resolve(cwd);
  const expected = path.resolve(JOA_WORKSPACE_REF);

  if (normalizeWorkspaceRef(resolved) !== normalizeWorkspaceRef(expected)) {
    fail(
      `workspace mismatch: expected "${JOA_WORKSPACE_REF}", got "${resolved}"`,
      { cwd: resolved }
    );
  }
}

function analyzePendingPaths({ allowlist, ignorelist, pendingPaths }) {
  const normalizedAllowlist = allowlist.map(normalizeRepoPath);
  const normalizedIgnorelist = ignorelist.map(normalizeRepoPath);
  const pendingSet = new Set(pendingPaths);
  const allowSet = new Set(normalizedAllowlist);
  const ignoreSet = new Set(normalizedIgnorelist);

  const overlap = normalizedAllowlist.filter((filePath) => ignoreSet.has(filePath));
  if (overlap.length > 0) {
    fail(
      `refusing: paths cannot be both allowlisted and ignored: ${overlap.join(", ")}`,
      { overlap_count: overlap.length }
    );
  }

  const unexpected = pendingPaths.filter(
    (filePath) => !allowSet.has(filePath) && !ignoreSet.has(filePath)
  );
  const missingAllowed = normalizedAllowlist.filter((filePath) => !pendingSet.has(filePath));
  const missingIgnored = normalizedIgnorelist.filter((filePath) => !pendingSet.has(filePath));

  return {
    allowlist: normalizedAllowlist,
    ignorelist: normalizedIgnorelist,
    unexpected,
    missingAllowed,
    missingIgnored,
  };
}

function assertValidPendingPaths(classification) {
  const { unexpected, missingAllowed, missingIgnored } = classification;

  if (unexpected.length > 0) {
    fail(
      `refusing: unexpected modified paths outside allowlist/ignore list: ${unexpected.join(", ")}`,
      { unexpected_count: unexpected.length }
    );
  }

  if (missingAllowed.length > 0) {
    fail(
      `refusing: allowlisted paths have no pending changes: ${missingAllowed.join(", ")}`,
      { allowlist_count: classification.allowlist.length }
    );
  }

  if (missingIgnored.length > 0) {
    fail(
      `refusing: ignored paths have no pending changes: ${missingIgnored.join(", ")}`,
      { ignore_count: classification.ignorelist.length }
    );
  }
}

function validateAllowlistAgainstPending(allowlist, pendingPaths, ignorelist = []) {
  const classification = analyzePendingPaths({ allowlist, ignorelist, pendingPaths });
  assertValidPendingPaths(classification);
  return classification.allowlist;
}

function printPathSection(title, paths, emptyLabel) {
  console.log(`${title}:`);
  if (paths.length === 0) {
    console.log(`  ${emptyLabel}`);
    return;
  }
  for (const filePath of paths) {
    console.log(`  - ${filePath}`);
  }
}

function printPreview({ allowlist, ignorelist, unexpected, message, pending, approved }) {
  console.log("");
  console.log("Pending git status:");
  console.log(pending.status_short || "(clean)");
  console.log("");
  if (pending.diff_stat) {
    console.log("Diff stat:");
    console.log(pending.diff_stat);
    console.log("");
  }
  printPathSection("Allowed paths (will be finalized)", allowlist, "(none)");
  console.log("");
  printPathSection("Ignored paths (left unchanged)", ignorelist, "(none)");
  console.log("");
  printPathSection("Unexpected paths", unexpected, "(none)");
  console.log("");
  console.log(`Commit message: ${message}`);
  console.log("");
  if (!approved) {
    console.log("Preview only. Re-run with --approve to git add, commit, and push.");
  }
}

function finalizeChanges({ cwd, allowlist, message }) {
  for (const filePath of allowlist) {
    runGit(["add", "--", filePath], cwd);
  }

  runGit(["commit", "-m", message], cwd);
  runGit(["push"], cwd);
}

function main() {
  const allowlist = parseAllowlistArgs();
  const ignorelist = parseIgnoreArgs();
  const message = parseNamedArg("--message");
  const approved = process.argv.includes("--approve");
  const cwd = process.cwd();

  console.log(formatWorkerContext({ mode: approved ? "finalize" : "preview", approved: approved ? "yes" : "no" }));

  if (allowlist.length === 0) {
    fail("at least one --allowlist path is required");
  }

  if (!message || !message.trim()) {
    fail("--message is required");
  }

  validateWorkspace(cwd);

  const pending = readPendingChanges(cwd);
  const classification = analyzePendingPaths({
    allowlist,
    ignorelist,
    pendingPaths: pending.pending_paths,
  });

  printPreview({
    allowlist: classification.allowlist,
    ignorelist: classification.ignorelist,
    unexpected: classification.unexpected,
    message: message.trim(),
    pending,
    approved,
  });

  assertValidPendingPaths(classification);

  if (!approved) {
    return;
  }

  finalizeChanges({
    cwd,
    allowlist: classification.allowlist,
    message: message.trim(),
  });

  console.log("Finalized: git add, commit, and push completed.");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }
}

module.exports = {
  normalizeRepoPath,
  parseGitStatusPaths,
  analyzePendingPaths,
  assertValidPendingPaths,
  validateAllowlistAgainstPending,
};
