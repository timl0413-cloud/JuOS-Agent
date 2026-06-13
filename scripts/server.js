#!/usr/bin/env node

const http = require("http");
const { URL } = require("url");
const { loadPackageVersion } = require("../lib/config");
const { authorizeRequest } = require("../lib/auth");
const {
  listJobs,
  readJob,
  createApiJob,
  approveJob,
} = require("../lib/jobs");
const { dispatchApprovedJob } = require("../lib/runner");

const HOST = process.env.TIMOS_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.TIMOS_AGENT_PORT || 8787);

const ROUTE_SCOPES = {
  "jobs-collection-GET": "jobs:read",
  "job-item-GET": "jobs:read",
  "jobs-collection-POST": "jobs:create",
  "job-approve-POST": "jobs:approve",
  "job-run-POST": "jobs:run",
};

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
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

  if (parts.length === 1 && parts[0] === "jobs") {
    return { name: "jobs-collection" };
  }

  if (parts.length === 2 && parts[0] === "jobs") {
    return { name: "job-item", jobId: parts[1] };
  }

  if (parts.length === 3 && parts[0] === "jobs" && parts[2] === "approve") {
    return { name: "job-approve", jobId: parts[1] };
  }

  if (parts.length === 3 && parts[0] === "jobs" && parts[2] === "run") {
    return { name: "job-run", jobId: parts[1] };
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

  const auth = authorizeRequest(req, requiredScope);
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
        service: "TimOS-Agent",
        version: loadPackageVersion(),
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

    if (route.name === "jobs-collection" && req.method === "GET") {
      sendJson(res, 200, { jobs: listJobs() });
      return;
    }

    if (route.name === "job-item" && req.method === "GET") {
      const job = readJob(route.jobId);
      if (!job) {
        sendJson(res, 404, { error: `Job not found: ${route.jobId}` });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (route.name === "jobs-collection" && req.method === "POST") {
      const body = await readJsonBody(req);
      const job = createApiJob(body);
      sendJson(res, 201, job);
      return;
    }

    if (route.name === "job-approve" && req.method === "POST") {
      const body = await readJsonBody(req);
      const job = approveJob(route.jobId, body);
      sendJson(res, 200, job);
      return;
    }

    if (route.name === "job-run" && req.method === "POST") {
      const body = await readJsonBody(req);
      const job = readJob(route.jobId);

      if (!job) {
        sendJson(res, 404, { error: `Job not found: ${route.jobId}` });
        return;
      }

      const finished = dispatchApprovedJob(job, body.confirm_execution === true);
      sendJson(res, 200, finished);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    const message = err.message || "Internal server error";
    const statusCode =
      message.includes("not found") && message.includes("Job")
        ? 404
        : message.includes("required") ||
            message.includes("Unknown") ||
            message.includes("Invalid JSON")
          ? 400
          : message.includes("not approved") ||
              message.includes("awaiting approval") ||
              message.includes("approval is required") ||
              message.includes("confirm_execution") ||
              message.includes("not queued")
            ? 403
            : 500;

    sendJson(res, statusCode, { error: message });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`TimOS-Agent API listening on http://${HOST}:${PORT}`);
});
