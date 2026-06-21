const fs = require("fs");
const path = require("path");
const { parseBearerToken, loadAuthTokens, findTokenRecord } = require("./auth");

const XIAOJU_TOKEN_NAME = "xiaoju-command-channel";
const WORKER_TOKEN_NAME = "cloud-readonly-worker";

const XIAOJU_SCOPES = [
  "remote-jobs:create",
  "remote-jobs:read",
  "remote-jobs:list",
];

const WORKER_SCOPES = ["remote-jobs:claim", "remote-jobs:result"];

function authConfigured() {
  if (process.env.XIAOJU_ACTION_TOKEN && process.env.WORKER_TOKEN) {
    return true;
  }

  const tokens = loadAuthTokens();
  if (!tokens) {
    return false;
  }

  const xiaoju =
    tokens.find((entry) => entry.name === XIAOJU_TOKEN_NAME) ||
    tokens.find(
      (entry) =>
        Array.isArray(entry.scope) &&
        entry.scope.includes("remote-jobs:create") &&
        entry.scope.includes("remote-jobs:read")
    );

  const worker =
    tokens.find((entry) => entry.name === WORKER_TOKEN_NAME) ||
    tokens.find(
      (entry) =>
        Array.isArray(entry.scope) &&
        entry.scope.includes("remote-jobs:claim")
    );

  return Boolean(
    xiaoju?.token &&
      xiaoju.token !== "replace-with-xiaoju-command-channel-secret" &&
      worker?.token &&
      worker.token !== "replace-with-cloud-readonly-worker-secret"
  );
}

function resolveTokenRecord(bearer) {
  if (!bearer) {
    return null;
  }

  if (bearer === process.env.XIAOJU_ACTION_TOKEN) {
    return { name: "env:xiaoju", token: bearer, scope: XIAOJU_SCOPES };
  }

  if (bearer === process.env.WORKER_TOKEN) {
    return { name: "env:worker", token: bearer, scope: WORKER_SCOPES };
  }

  const tokens = loadAuthTokens();
  if (!tokens) {
    return null;
  }

  return findTokenRecord(bearer, tokens);
}

function tokenHasScope(tokenRecord, requiredScope) {
  return (
    Array.isArray(tokenRecord.scope) &&
    tokenRecord.scope.includes(requiredScope)
  );
}

function authorizeCommandChannel(req, requiredScope) {
  if (!authConfigured()) {
    return {
      ok: false,
      status: 503,
      body: { error: "auth_not_configured" },
    };
  }

  const bearer = parseBearerToken(req.headers.authorization);
  if (!bearer) {
    return {
      ok: false,
      status: 401,
      body: { error: "invalid_token" },
    };
  }

  const tokenRecord = resolveTokenRecord(bearer);
  if (!tokenRecord) {
    return {
      ok: false,
      status: 401,
      body: { error: "invalid_token" },
    };
  }

  if (!tokenHasScope(tokenRecord, requiredScope)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "insufficient_scope",
        required_scope: requiredScope,
      },
    };
  }

  return { ok: true, token: tokenRecord };
}

const LOCAL_LIVE_BRIDGE_SCOPES = new Set(["remote-jobs:list"]);

function isLoopbackAddress(address) {
  if (!address) {
    return false;
  }

  const normalized = String(address).toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("::ffff:127.0.0.1:")
  );
}

function isLoopbackHost(host) {
  const normalized = String(host || "").toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function localLiveBridgeEligible(req, requiredScope, serverHost) {
  if (!LOCAL_LIVE_BRIDGE_SCOPES.has(requiredScope)) {
    return false;
  }

  if (!isLoopbackHost(serverHost)) {
    return false;
  }

  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return false;
  }

  if (!authConfigured()) {
    return false;
  }

  // Browser-friendly path: only bridge when no Bearer header was sent.
  if (parseBearerToken(req.headers.authorization)) {
    return false;
  }

  return true;
}

function authorizeCommandChannelOrLocalBridge(req, requiredScope, serverHost) {
  const auth = authorizeCommandChannel(req, requiredScope);
  if (auth.ok) {
    return { ok: true, access: "bearer" };
  }

  if (localLiveBridgeEligible(req, requiredScope, serverHost)) {
    return { ok: true, access: "local_loopback" };
  }

  return { ok: false, ...auth };
}

module.exports = {
  XIAOJU_TOKEN_NAME,
  WORKER_TOKEN_NAME,
  XIAOJU_SCOPES,
  WORKER_SCOPES,
  authConfigured,
  authorizeCommandChannel,
  isLoopbackAddress,
  isLoopbackHost,
  localLiveBridgeEligible,
  authorizeCommandChannelOrLocalBridge,
};
