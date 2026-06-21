const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Renderer / server code — Node caches these at startup; restart required after edits.
const TOWER_CODE_FILES = [
  "lib/command-channel-live-jobs-source.js",
  "lib/command-channel-short-status-page.js",
  "lib/tower-current-batch-manifest.js",
  "lib/tower-server-build-marker.js",
  "scripts/server-command-channel.js",
];

// Local watch restart targets (includes live-reload manifest + startup helper).
const TOWER_WATCH_FILES = [
  "config/tower-current-batch.json",
  "lib/command-channel-live-jobs-source.js",
  "lib/tower-current-batch-manifest.js",
  "lib/tower-server-build-marker.js",
  "lib/command-channel-short-status-page.js",
  "scripts/start-control-tower.ps1",
];

const DEFAULT_RESTART_COMMAND =
  ".\\scripts\\start-control-tower.ps1 -Start -ForceStop -OpenBrowser";

let serverStartedAtMs = null;
let loadedCodeSnapshots = null;

function resolveRepoFile(relativePath) {
  return path.join(ROOT, relativePath);
}

function getFileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function recordTowerServerBuildMarker(options = {}) {
  const startedAtMs = options.startedAtMs ?? Date.now();
  serverStartedAtMs = startedAtMs;
  loadedCodeSnapshots = Object.fromEntries(
    TOWER_CODE_FILES.map((rel) => [rel, getFileMtimeMs(resolveRepoFile(rel))])
  );
  return {
    server_started_at: new Date(startedAtMs).toISOString(),
    loaded_code_files: { ...loadedCodeSnapshots },
  };
}

function getTowerStaleCodeState(options = {}) {
  if (options.enabled === false) {
    return { stale: false, reason: "disabled" };
  }
  if (!loadedCodeSnapshots || serverStartedAtMs == null) {
    return { stale: false, reason: "no_marker" };
  }

  const staleFiles = [];
  for (const rel of TOWER_CODE_FILES) {
    const current = getFileMtimeMs(resolveRepoFile(rel));
    const loaded = loadedCodeSnapshots[rel];
    if (current == null) {
      continue;
    }
    if (loaded == null || current > loaded) {
      staleFiles.push({
        path: rel,
        loaded_mtime_ms: loaded,
        current_mtime_ms: current,
      });
    }
  }

  if (staleFiles.length === 0) {
    return {
      stale: false,
      server_started_at: new Date(serverStartedAtMs).toISOString(),
    };
  }

  return {
    stale: true,
    server_started_at: new Date(serverStartedAtMs).toISOString(),
    stale_files: staleFiles.map((entry) => entry.path),
    restart_command: options.restartCommand || DEFAULT_RESTART_COMMAND,
  };
}

function buildTowerStaleCodeBannerHtml(staleState) {
  if (!staleState?.stale) {
    return "";
  }

  const fileList = (staleState.stale_files || [])
    .map((rel) => `<li><code>${rel}</code></li>`)
    .join("");
  const restartCmd = staleState.restart_command || DEFAULT_RESTART_COMMAND;

  return `<div class="stale-code-banner" role="alert">
      <strong>Tower server is running old code — restart required</strong>
      <p>These files changed after this server process started. Job/status data still refreshes; renderer and manifest logic need a restart.</p>
      <ul class="stale-file-list">${fileList}</ul>
      <span class="cmd">${restartCmd}</span>
    </div>`;
}

module.exports = {
  TOWER_CODE_FILES,
  TOWER_WATCH_FILES,
  DEFAULT_RESTART_COMMAND,
  recordTowerServerBuildMarker,
  getTowerStaleCodeState,
  buildTowerStaleCodeBannerHtml,
};
