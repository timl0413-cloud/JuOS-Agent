const fs = require("fs");
const path = require("path");
const { loadAuthTokens, findTokenByName } = require("./auth");
const {
  XIAOJU_TOKEN_NAME,
  authConfigured,
} = require("./command-channel-auth");
const {
  listJobs,
  getBackendStatus,
  getCommandChannelBackendName,
  BACKEND_SUPABASE,
} = require("./command-channel-store");

const DEFAULT_COMMAND_CHANNEL_URL =
  "https://juos.vercel.app/api/command-channel";

function loadLocalWorkerEnv() {
  const root = path.resolve(__dirname, "..");
  const candidates = [
    path.join(root, "config", "command-channel-worker.env"),
    path.join(process.cwd(), ".env.command-channel-worker"),
    path.join(process.cwd(), ".env.juos.prod.local"),
    path.join(process.cwd(), ".env.vercel.production.local"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }

    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function resolveCommandChannelUrl() {
  return (
    process.env.COMMAND_CHANNEL_URL ||
    process.env.COMMAND_CHANNEL_HTTP_URL ||
    DEFAULT_COMMAND_CHANNEL_URL
  );
}

function resolveXiaojuListToken() {
  if (process.env.XIAOJU_ACTION_TOKEN) {
    return {
      token: process.env.XIAOJU_ACTION_TOKEN,
      source: "env:XIAOJU_ACTION_TOKEN",
    };
  }

  const tokens = loadAuthTokens();
  if (!tokens) {
    return null;
  }

  const record = findTokenByName(XIAOJU_TOKEN_NAME, tokens);
  if (
    !record?.token ||
    record.token === "replace-with-xiaoju-command-channel-secret"
  ) {
    return null;
  }

  return { token: record.token, source: XIAOJU_TOKEN_NAME };
}

function buildListQuery(filter = {}) {
  const params = new URLSearchParams();
  if (filter.status) {
    params.set("status", filter.status);
  }
  if (filter.target_worker_profile) {
    params.set("target_worker_profile", filter.target_worker_profile);
  }
  if (filter.requested_by) {
    params.set("requested_by", filter.requested_by);
  }
  return params.toString();
}

async function httpListJobs(filter = {}, options = {}) {
  const tokenResult = options.tokenResult || resolveXiaojuListToken();
  if (!tokenResult?.token) {
    const err = new Error(
      "XiaoJu list token missing: set XIAOJU_ACTION_TOKEN or config/auth.json"
    );
    err.code = "auth_missing_list";
    throw err;
  }

  const baseUrl = options.baseUrl || resolveCommandChannelUrl();
  const query = buildListQuery(filter);
  const url = `${baseUrl.replace(/\/$/, "")}/remote-jobs${query ? `?${query}` : ""}`;
  const fetchImpl = options.fetchImpl || fetch;

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${tokenResult.token}`,
    },
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(
      `remote-jobs list failed (${response.status}): ${JSON.stringify(data)}`
    );
    err.code = "fetch_error";
    err.status = response.status;
    throw err;
  }

  return Array.isArray(data?.jobs) ? data.jobs : [];
}

function buildLiveSourceMeta(partial = {}) {
  return {
    status: partial.status || "unknown",
    mode: partial.mode || "unknown",
    job_count: partial.job_count ?? 0,
    refreshed_at: partial.refreshed_at || new Date().toISOString(),
    endpoint: partial.endpoint || null,
    backend: partial.backend || null,
    message: partial.message || null,
    setup: partial.setup || null,
  };
}

function unavailableSetupMessage(reason) {
  if (reason === "auth_missing_list") {
    return "Set XIAOJU_ACTION_TOKEN or configure xiaoju-command-channel in config/auth.json, then restart npm run server:command-channel from a token-loaded shell.";
  }
  if (reason === "auth_not_configured") {
    return "Restart npm run server:command-channel from a token-loaded supervisor shell (see .\\scripts\\start-control-tower.ps1).";
  }
  return "Check COMMAND_CHANNEL_URL / COMMAND_CHANNEL_BACKEND and restart the command-channel server.";
}

async function fetchLiveJobsForDisplay(filter = {}, options = {}) {
  if (options.loadEnv !== false) {
    loadLocalWorkerEnv();
  }

  const refreshedAt = new Date().toISOString();
  const backendName = getCommandChannelBackendName();
  const backendStatus = getBackendStatus();

  if (
    backendName === BACKEND_SUPABASE &&
    backendStatus.supabase_configured
  ) {
    const jobs = await listJobs(filter);
    return {
      jobs,
      live_source: buildLiveSourceMeta({
        status: "connected",
        mode: "supabase",
        backend: backendName,
        job_count: jobs.length,
        refreshed_at: refreshedAt,
      }),
    };
  }

  const tokenResult = resolveXiaojuListToken();
  const remoteUrl = resolveCommandChannelUrl();
  const shouldUseRemote =
    Boolean(tokenResult?.token) &&
    (backendName !== "filesystem" ||
      Boolean(process.env.COMMAND_CHANNEL_URL) ||
      authConfigured());

  if (shouldUseRemote) {
    try {
      const jobs = await httpListJobs(filter, {
        tokenResult,
        baseUrl: remoteUrl,
        fetchImpl: options.fetchImpl,
      });
      return {
        jobs,
        live_source: buildLiveSourceMeta({
          status: "connected",
          mode: "remote-http",
          backend: "remote",
          endpoint: remoteUrl,
          job_count: jobs.length,
          refreshed_at: refreshedAt,
        }),
      };
    } catch (err) {
      return {
        jobs: [],
        live_source: buildLiveSourceMeta({
          status: err.code === "auth_missing_list" ? "auth_missing" : "fetch_error",
          mode: "remote-http",
          backend: "remote",
          endpoint: remoteUrl,
          job_count: 0,
          refreshed_at: refreshedAt,
          message: err.message,
          setup: unavailableSetupMessage(err.code),
        }),
      };
    }
  }

  if (authConfigured()) {
    return {
      jobs: [],
      live_source: buildLiveSourceMeta({
        status: "auth_missing",
        mode: "remote-http",
        backend: "remote",
        endpoint: remoteUrl,
        job_count: 0,
        refreshed_at: refreshedAt,
        message: "XiaoJu list token not available for remote job fetch",
        setup: unavailableSetupMessage("auth_missing_list"),
      }),
    };
  }

  try {
    const jobs = await listJobs(filter);
    return {
      jobs,
      live_source: buildLiveSourceMeta({
        status: "connected",
        mode: "filesystem",
        backend: backendName,
        job_count: jobs.length,
        refreshed_at: refreshedAt,
        message:
          jobs.length === 0
            ? "Local filesystem job store is empty — hosted jobs require remote list auth"
            : null,
        setup:
          jobs.length === 0
            ? unavailableSetupMessage("auth_not_configured")
            : null,
      }),
    };
  } catch (err) {
    return {
      jobs: [],
      live_source: buildLiveSourceMeta({
        status: "error",
        mode: "filesystem",
        backend: backendName,
        job_count: 0,
        refreshed_at: refreshedAt,
        message: err.message,
        setup: unavailableSetupMessage("error"),
      }),
    };
  }
}

module.exports = {
  DEFAULT_COMMAND_CHANNEL_URL,
  loadLocalWorkerEnv,
  resolveCommandChannelUrl,
  resolveXiaojuListToken,
  httpListJobs,
  fetchLiveJobsForDisplay,
  buildLiveSourceMeta,
};
