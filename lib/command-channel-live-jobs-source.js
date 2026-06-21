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

const MISSING_LIST_AUTH_MESSAGE =
  "missing XIAOJU_ACTION_TOKEN or xiaoju-command-channel in config/auth.json";

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

function hasExplicitRemoteCommandChannelUrl() {
  return Boolean(
    process.env.COMMAND_CHANNEL_URL || process.env.COMMAND_CHANNEL_HTTP_URL
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

function listAuthVariableHint(tokenSource) {
  if (tokenSource === "env:XIAOJU_ACTION_TOKEN") {
    return "XIAOJU_ACTION_TOKEN";
  }
  if (tokenSource === XIAOJU_TOKEN_NAME) {
    return "xiaoju-command-channel in config/auth.json";
  }
  return "XIAOJU_ACTION_TOKEN or xiaoju-command-channel in config/auth.json";
}

function buildUnauthorizedListMessage(tokenSource) {
  const hint = listAuthVariableHint(tokenSource);
  return `List token rejected (401 Unauthorized) — verify ${hint} matches the hosted command-channel deployment`;
}

function classifyHttpListFailure(status, tokenSource) {
  if (status === 401) {
    return {
      code: "auth_unauthorized",
      liveStatus: "auth_unauthorized",
      message: buildUnauthorizedListMessage(tokenSource),
      setup:
        "Set XIAOJU_ACTION_TOKEN to the hosted deployment secret (or configure COMMAND_CHANNEL_BACKEND=supabase), then restart npm run server:command-channel.",
    };
  }

  if (status === 403) {
    return {
      code: "auth_forbidden",
      liveStatus: "auth_unauthorized",
      message: "List token lacks remote-jobs:list scope",
      setup:
        "Use xiaoju-command-channel token with remote-jobs:list scope in config/auth.json or XIAOJU_ACTION_TOKEN.",
    };
  }

  return {
    code: "fetch_error",
    liveStatus: "fetch_error",
    message: `remote-jobs list failed (${status})`,
    setup: unavailableSetupMessage("fetch_error"),
  };
}

function mapListFetchError(err, tokenSource) {
  if (err?.code === "auth_missing_list") {
    return {
      code: "auth_missing_list",
      liveStatus: "auth_missing",
      message: MISSING_LIST_AUTH_MESSAGE,
      setup: unavailableSetupMessage("auth_missing_list"),
    };
  }

  if (err?.status) {
    return classifyHttpListFailure(err.status, tokenSource);
  }

  return {
    code: err?.code || "fetch_error",
    liveStatus: "fetch_error",
    message: err?.message || "remote-jobs list failed",
    setup: unavailableSetupMessage(err?.code || "fetch_error"),
  };
}

async function httpListJobs(filter = {}, options = {}) {
  const tokenResult = options.tokenResult || resolveXiaojuListToken();
  if (!tokenResult?.token) {
    const err = new Error(MISSING_LIST_AUTH_MESSAGE);
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
    const failure = classifyHttpListFailure(response.status, tokenResult.source);
    const err = new Error(failure.message);
    err.code = failure.code;
    err.status = response.status;
    err.setup = failure.setup;
    err.liveStatus = failure.liveStatus;
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
  if (reason === "hosted_jobs") {
    return "For hosted jobs set COMMAND_CHANNEL_BACKEND=supabase with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or set COMMAND_CHANNEL_URL with a valid XIAOJU_ACTION_TOKEN.";
  }
  if (reason === "fetch_error") {
    return "Check COMMAND_CHANNEL_URL / COMMAND_CHANNEL_BACKEND and restart the command-channel server.";
  }
  return "Check COMMAND_CHANNEL_URL / COMMAND_CHANNEL_BACKEND and restart the command-channel server.";
}

function buildRemoteFetchFailureLiveSource(err, remoteUrl, refreshedAt, tokenSource) {
  const failure = mapListFetchError(err, tokenSource);
  return buildLiveSourceMeta({
    status: failure.liveStatus,
    mode: "remote-http",
    backend: "remote",
    endpoint: remoteUrl,
    job_count: 0,
    refreshed_at: refreshedAt,
    message: failure.message,
    setup: failure.setup,
  });
}

async function fetchLocalBackendJobs(filter, context) {
  const { refreshedAt, backendName } = context;

  try {
    const jobs = await listJobs(filter);
    const mode =
      backendName === BACKEND_SUPABASE ? "supabase" : "filesystem";

    return {
      jobs,
      live_source: buildLiveSourceMeta({
        status: "connected",
        mode,
        backend: backendName,
        job_count: jobs.length,
        refreshed_at: refreshedAt,
        message:
          jobs.length === 0 && backendName !== BACKEND_SUPABASE
            ? "Local job store empty — hosted jobs require supabase backend or remote list auth"
            : null,
        setup:
          jobs.length === 0 && backendName !== BACKEND_SUPABASE
            ? unavailableSetupMessage("hosted_jobs")
            : null,
      }),
    };
  } catch (err) {
    return {
      jobs: [],
      live_source: buildLiveSourceMeta({
        status: "error",
        mode: backendName === BACKEND_SUPABASE ? "supabase" : "filesystem",
        backend: backendName,
        job_count: 0,
        refreshed_at: refreshedAt,
        message: err.message,
        setup: unavailableSetupMessage(err.code || "error"),
      }),
    };
  }
}

async function fetchLiveJobsForDisplay(filter = {}, options = {}) {
  if (options.loadEnv !== false) {
    loadLocalWorkerEnv();
  }

  const refreshedAt = new Date().toISOString();
  const backendName = getCommandChannelBackendName();
  const backendStatus = getBackendStatus();

  if (options.source === "local_server") {
    return fetchLocalBackendJobs(filter, {
      refreshedAt,
      backendName,
      backendStatus,
    });
  }

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
    (options.forceRemote === true || hasExplicitRemoteCommandChannelUrl());

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
        live_source: buildRemoteFetchFailureLiveSource(
          err,
          remoteUrl,
          refreshedAt,
          tokenResult?.source
        ),
      };
    }
  }

  if (authConfigured() && !tokenResult?.token) {
    return {
      jobs: [],
      live_source: buildLiveSourceMeta({
        status: "auth_missing",
        mode: "remote-http",
        backend: "remote",
        endpoint: remoteUrl,
        job_count: 0,
        refreshed_at: refreshedAt,
        message: MISSING_LIST_AUTH_MESSAGE,
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
            ? unavailableSetupMessage("hosted_jobs")
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
  MISSING_LIST_AUTH_MESSAGE,
  loadLocalWorkerEnv,
  resolveCommandChannelUrl,
  resolveXiaojuListToken,
  classifyHttpListFailure,
  mapListFetchError,
  httpListJobs,
  fetchLiveJobsForDisplay,
  buildLiveSourceMeta,
};
