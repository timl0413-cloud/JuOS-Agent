#!/usr/bin/env node

const http = require("http");
const { URL } = require("url");
const { loadPackageVersion } = require("../lib/config");
const {
  authConfigured,
  authorizeCommandChannel,
  isLoopbackAddress,
  isLoopbackHost,
  localLiveBridgeEligible,
} = require("../lib/command-channel-auth");
const {
  createJob,
  getJob,
  listJobs,
  claimJob,
  submitResult,
  getBackendStatus,
  assertBackendReady,
} = require("../lib/command-channel-store");
const { DEFAULT_WORKER_PROFILE } = require("../lib/command-channel-core");
const {
  buildSampleSummary,
  buildBridgeStatusSummary,
  buildViewModel,
  renderBridgeStatusHtml,
} = require("../lib/command-channel-bridge-status-page");
const {
  buildWatchSummary,
  buildTowerSummary,
  buildSampleWatchSummary,
  buildSampleTowerSummary,
  renderWatchHtml,
  renderTowerHtml,
  renderLocalLiveLandingHtml,
} = require("../lib/command-channel-short-status-page");
const {
  recordTowerServerBuildMarker,
  getTowerStaleCodeState,
} = require("../lib/tower-server-build-marker");

const LOCAL_LIVE_BRIDGE_ROUTES = new Set([
  "short-status",
  "short-status-summary",
  "short-watch",
  "short-watch-summary",
  "short-tower",
  "short-tower-summary",
]);

const LOCAL_LIVE_HTML_ROUTES = new Set([
  "short-status",
  "short-watch",
  "short-tower",
]);

const LOCAL_LIVE_ROUTE_ALIASES = {
  "short-status": "status",
  "short-watch": "watch",
  "short-tower": "tower",
};

const HOST = process.env.COMMAND_CHANNEL_HOST || "127.0.0.1";
const PORT = Number(process.env.COMMAND_CHANNEL_PORT || 8790);
const LOCAL_DEV_SERVER = isLoopbackHost(HOST);
const TOWER_STALE_CHECK_ENABLED =
  LOCAL_DEV_SERVER && process.env.COMMAND_CHANNEL_TOWER_STALE_CHECK !== "0";

const SERVER_BUILD_MARKER = recordTowerServerBuildMarker();

const ROUTE_SCOPES = {
  "remote-jobs-collection-POST": "remote-jobs:create",
  "remote-jobs-collection-GET": "remote-jobs:list",
  "remote-job-item-GET": "remote-jobs:read",
  "worker-jobs-next-GET": "remote-jobs:claim",
  "worker-job-result-POST": "remote-jobs:result",
  "joa-bridge-status-GET": "remote-jobs:list",
  "joa-bridge-status-summary-GET": "remote-jobs:list",
  "short-status-GET": "remote-jobs:list",
  "short-status-summary-GET": "remote-jobs:list",
  "short-watch-GET": "remote-jobs:list",
  "short-watch-summary-GET": "remote-jobs:list",
  "short-tower-GET": "remote-jobs:list",
  "short-tower-summary-GET": "remote-jobs:list",
};

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function sendHtml(res, statusCode, body) {
  const payload = String(body);
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function requestRemoteAddress(req) {
  return req.socket?.remoteAddress || req.connection?.remoteAddress;
}

function requestHostName(req) {
  const host = req.headers.host || "";
  return host.split(":")[0].toLowerCase();
}

function isLoopbackRequest(req) {
  if (isLoopbackAddress(requestRemoteAddress(req))) {
    return true;
  }
  return isLoopbackHost(requestHostName(req));
}

function prefersHtmlResponse(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  if (req.headers["x-requested-with"] === "XMLHttpRequest") {
    return false;
  }
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return false;
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Invalid JSON body"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function parseShortAliasRoute(parts) {
  const alias = parts[0];
  if (!["status", "watch", "tower"].includes(alias)) {
    return null;
  }

  if (parts.length === 1) {
    return { name: `short-${alias}` };
  }

  if (parts.length === 2 && parts[1] === "preview") {
    return { name: `short-${alias}-preview` };
  }

  if (parts.length === 2 && parts[1] === "summary") {
    return { name: `short-${alias}-summary` };
  }

  return null;
}

function parseRoute(urlPath) {
  const parts = urlPath.split("/").filter(Boolean);

  if (parts.length === 1 && parts[0] === "health") {
    return { name: "health" };
  }

  const shortRoute = parts.length <= 2 ? parseShortAliasRoute(parts) : null;
  if (shortRoute) {
    return shortRoute;
  }

  if (
    parts.length === 2 &&
    parts[0] === "joa" &&
    parts[1] === "bridge-status"
  ) {
    return { name: "joa-bridge-status" };
  }

  if (
    parts.length === 3 &&
    parts[0] === "joa" &&
    parts[1] === "bridge-status" &&
    parts[2] === "preview"
  ) {
    return { name: "joa-bridge-status-preview" };
  }

  if (
    parts.length === 3 &&
    parts[0] === "joa" &&
    parts[1] === "bridge-status" &&
    parts[2] === "summary"
  ) {
    return { name: "joa-bridge-status-summary" };
  }

  if (parts.length === 1 && parts[0] === "remote-jobs") {
    return { name: "remote-jobs-collection" };
  }

  if (parts.length === 2 && parts[0] === "remote-jobs") {
    return { name: "remote-job-item", jobId: parts[1] };
  }

  if (
    parts.length === 3 &&
    parts[0] === "worker" &&
    parts[1] === "jobs" &&
    parts[2] === "next"
  ) {
    return { name: "worker-jobs-next" };
  }

  if (
    parts.length === 4 &&
    parts[0] === "worker" &&
    parts[1] === "jobs" &&
    parts[3] === "result"
  ) {
    return { name: "worker-job-result", jobId: parts[2] };
  }

  return { name: "not-found" };
}

function routeKey(route, method) {
  if (
    route.name === "health" ||
    route.name === "not-found" ||
    route.name === "joa-bridge-status-preview" ||
    route.name === "short-status-preview" ||
    route.name === "short-watch-preview" ||
    route.name === "short-tower-preview"
  ) {
    return route.name;
  }
  return `${route.name}-${method}`;
}

function buildStatusFilter(url) {
  return {
    target_worker_profile: url.searchParams.get("profile") || undefined,
    status: url.searchParams.get("status") || undefined,
    requested_by: url.searchParams.get("requested_by") || undefined,
  };
}

async function fetchJobsForStatus(url) {
  return listJobs(buildStatusFilter(url));
}

async function buildBridgeStatusView(url, options = {}) {
  const jobs = await fetchJobsForStatus(url);
  const summary = buildBridgeStatusSummary(jobs, {
    backend: getBackendStatus(),
    live_access: options.live_access,
  });
  const viewModel = buildViewModel(summary);
  const controlTower = buildTowerSummary(jobs, {
    summary,
    backend: getBackendStatus(),
    live_access: options.live_access,
  });
  return {
    ...viewModel,
    control_tower: controlTower.compact,
  };
}

async function buildWatchStatusView(url, options = {}) {
  const jobs = await fetchJobsForStatus(url);
  return buildWatchSummary(jobs, {
    backend: getBackendStatus(),
    live_access: options.live_access,
  });
}

async function buildTowerStatusView(url, options = {}) {
  const jobs = await fetchJobsForStatus(url);
  const tower = buildTowerSummary(jobs, {
    backend: getBackendStatus(),
    live_access: options.live_access,
  });
  if (TOWER_STALE_CHECK_ENABLED) {
    tower.stale_code = getTowerStaleCodeState();
  }
  return tower;
}

function requireAuth(req, res, route, method) {
  const key = routeKey(route, method);
  const requiredScope = ROUTE_SCOPES[key];
  if (!requiredScope) {
    return { ok: true };
  }

  const auth = authorizeCommandChannel(req, requiredScope);
  if (auth.ok) {
    return { ok: true, live_access: "bearer" };
  }

  if (
    LOCAL_LIVE_BRIDGE_ROUTES.has(route.name) &&
    localLiveBridgeEligible(req, requiredScope, HOST)
  ) {
    return { ok: true, live_access: "local_loopback" };
  }

  if (
    method === "GET" &&
    LOCAL_LIVE_HTML_ROUTES.has(route.name) &&
    isLoopbackRequest(req) &&
    prefersHtmlResponse(req)
  ) {
    const alias = LOCAL_LIVE_ROUTE_ALIASES[route.name] || "tower";
    const reason =
      auth.body?.error === "auth_not_configured"
        ? "auth_not_configured"
        : "auth_required";
    sendHtml(
      res,
      auth.status === 503 ? 503 : 401,
      renderLocalLiveLandingHtml({
        route: alias,
        reason,
        host: HOST,
        port: PORT,
      })
    );
    return { ok: false, handled: true };
  }

  sendJson(res, auth.status, auth.body);
  return { ok: false };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const route = parseRoute(url.pathname);

  try {
    if (route.name === "health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        service: "TimOS-Agent Command Channel",
        version: loadPackageVersion(),
        backend: getBackendStatus(),
        server_started_at: SERVER_BUILD_MARKER.server_started_at,
        ...(TOWER_STALE_CHECK_ENABLED
          ? { tower_stale_code: getTowerStaleCodeState() }
          : {}),
      });
      return;
    }

    if (route.name === "not-found") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (
      (route.name === "joa-bridge-status-preview" ||
        route.name === "short-status-preview") &&
      req.method === "GET"
    ) {
      const viewModel = buildViewModel(buildSampleSummary());
      sendHtml(res, 200, renderBridgeStatusHtml(viewModel));
      return;
    }

    if (route.name === "short-watch-preview" && req.method === "GET") {
      sendHtml(res, 200, renderWatchHtml(buildSampleWatchSummary()));
      return;
    }

    if (route.name === "short-tower-preview" && req.method === "GET") {
      sendHtml(res, 200, renderTowerHtml(buildSampleTowerSummary()));
      return;
    }

    const authResult = requireAuth(req, res, route, req.method);
    if (!authResult.ok) {
      return;
    }

    const liveAccess = authResult.live_access || "bearer";
    const viewOptions = { live_access: liveAccess };

    if (
      (route.name === "joa-bridge-status" || route.name === "short-status") &&
      req.method === "GET"
    ) {
      const viewModel = await buildBridgeStatusView(url, viewOptions);
      sendHtml(res, 200, renderBridgeStatusHtml(viewModel));
      return;
    }

    if (
      (route.name === "joa-bridge-status-summary" ||
        route.name === "short-status-summary") &&
      req.method === "GET"
    ) {
      const viewModel = await buildBridgeStatusView(url, viewOptions);
      sendJson(res, 200, viewModel);
      return;
    }

    if (route.name === "short-watch" && req.method === "GET") {
      sendHtml(res, 200, renderWatchHtml(await buildWatchStatusView(url, viewOptions)));
      return;
    }

    if (route.name === "short-watch-summary" && req.method === "GET") {
      sendJson(res, 200, await buildWatchStatusView(url, viewOptions));
      return;
    }

    if (route.name === "short-tower" && req.method === "GET") {
      sendHtml(res, 200, renderTowerHtml(await buildTowerStatusView(url, viewOptions)));
      return;
    }

    if (route.name === "short-tower-summary" && req.method === "GET") {
      sendJson(res, 200, await buildTowerStatusView(url, viewOptions));
      return;
    }

    if (route.name === "remote-jobs-collection" && req.method === "POST") {
      const body = await readJsonBody(req);
      const job = await createJob(body);
      sendJson(res, 201, job);
      return;
    }

    if (route.name === "remote-jobs-collection" && req.method === "GET") {
      const filter = {
        status: url.searchParams.get("status") || undefined,
        requested_by: url.searchParams.get("requested_by") || undefined,
        target_worker_profile:
          url.searchParams.get("target_worker_profile") || undefined,
      };
      sendJson(res, 200, { jobs: await listJobs(filter) });
      return;
    }

    if (route.name === "remote-job-item" && req.method === "GET") {
      const job = await getJob(route.jobId);
      if (!job) {
        sendJson(res, 404, { error: `Job not found: ${route.jobId}` });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (route.name === "worker-jobs-next" && req.method === "GET") {
      const workerProfile =
        url.searchParams.get("worker_profile") || DEFAULT_WORKER_PROFILE;
      const jobId = url.searchParams.get("job_id") || undefined;
      const job = await claimJob(workerProfile, { jobId });

      if (!job) {
        sendNoContent(res);
        return;
      }

      sendJson(res, 200, { job });
      return;
    }

    if (route.name === "worker-job-result" && req.method === "POST") {
      const body = await readJsonBody(req);
      const job = await submitResult(route.jobId, body);
      sendJson(res, 200, job);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    const message = err.message || "Internal server error";
    const validationErrors = err.validation_errors;

    const statusCode = validationErrors
      ? 400
      : err.code === "supabase_not_configured"
        ? 503
        : message.includes("not found")
        ? 404
        : message.includes("not pending") ||
            message.includes("not claimed") ||
            message.includes("mismatch")
          ? 409
          : 500;

    sendJson(res, statusCode, {
      error: message,
      ...(validationErrors ? { validation_errors: validationErrors } : {}),
    });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

try {
  assertBackendReady();
} catch (err) {
  console.error(`Command channel backend error: ${err.message}`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  const backendStatus = getBackendStatus();
  const liveUrl = `http://127.0.0.1:${PORT}/tower`;
  const previewUrl = `http://127.0.0.1:${PORT}/tower/preview`;
  console.log(
    `TimOS-Agent command channel listening on http://${HOST}:${PORT} (backend=${backendStatus.backend})`
  );
  if (authConfigured()) {
    console.log(`Local live bridge: available (auth loaded in this process)`);
    if (isLoopbackHost(HOST)) {
      console.log(`Local live tower (browser, no Bearer): ${liveUrl}`);
    }
  } else {
    console.log(
      "Local live bridge: unavailable — auth not configured in this process"
    );
    console.log(
      "Restart from a token-loaded supervisor shell, then open:",
      liveUrl
    );
    if (isLoopbackHost(HOST)) {
      console.log(`Setup page (browser, not live): ${liveUrl}`);
    }
  }
  console.log(`Sample preview (not live): ${previewUrl}`);
});
