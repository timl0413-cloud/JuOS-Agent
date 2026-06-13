const fs = require("fs");
const path = require("path");
const { ROOT } = require("./config");

const AUTH_FILE = path.join(ROOT, "config", "auth.json");

function authFileExists() {
  return fs.existsSync(AUTH_FILE);
}

function loadAuthTokens() {
  if (!authFileExists()) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  return data.api_tokens || [];
}

function parseBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function findTokenRecord(token, tokens) {
  return tokens.find((entry) => entry.token === token) || null;
}

function tokenHasScope(tokenRecord, requiredScope) {
  return (
    Array.isArray(tokenRecord.scope) &&
    tokenRecord.scope.includes(requiredScope)
  );
}

function authorizeRequest(req, requiredScope) {
  const tokens = loadAuthTokens();
  if (!tokens) {
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

  const tokenRecord = findTokenRecord(bearer, tokens);
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

module.exports = {
  AUTH_FILE,
  authFileExists,
  loadAuthTokens,
  parseBearerToken,
  authorizeRequest,
};
