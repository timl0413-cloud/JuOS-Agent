#!/usr/bin/env node

const http = require("http");
const { URL } = require("url");
const { loadPackageVersion } = require("../lib/config");
const { authorizeCommandChannel } = require("../lib/command-channel-auth");
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

const HOST = process.env.COMMAND_CHANNEL_HOST || "127.0.0.1";
const PORT = Number(process.env.COMMAND_CHANNEL_PORT || 8790);

const ROUTE_SCOPES = {
  "remote-jobs-collection-POST": "remote-jobs:create",
  "remote-jobs-collection-GET": "remote-jobs:list",
  "remote-job-item-GET": "remote-jobs:read",
  "worker-jobs-next-GET": "remote-jobs:claim",
  "worker-job-result-POST": "remote-jobs:result",
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

function parseRoute(urlPath) {
  const parts = urlPath.split("/").filter(Boolean);

  if (parts.length === 1 && parts[0] === "health") {
    return { name: "health" };
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
  if (route.name === "health" || route.name === "not-found") {
    return route.name;
  }
  return `${route.name}-${method}`;
}

function requireAuth(req, res, route, method) {
  const key = routeKey(route, method);
  const requiredScope = ROUTE_SCOPES[key];
  if (!requiredScope) {
    return true;
  }

  const auth = authorizeCommandChannel(req, requiredScope);
  if (!auth.ok) {
    sendJson(res, auth.status, auth.body);
    return false;
  }

  return true;
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
      });
      return;
    }

    if (route.name === "not-found") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (!requireAuth(req, res, route, req.method)) {
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
  console.log(
    `TimOS-Agent command channel listening on http://${HOST}:${PORT} (backend=${backendStatus.backend})`
  );
});
