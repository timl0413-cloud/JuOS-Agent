#!/usr/bin/env node

const HOST = process.env.TIMOS_AGENT_HOST || "127.0.0.1";
const PORT = Number(process.env.TIMOS_AGENT_PORT || 8787);
const BASE_URL = `http://${HOST}:${PORT}`;
const shouldRun = process.argv.includes("--run");

async function request(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log(`Smoke test against ${BASE_URL}`);

  const health = await request("GET", "/health");
  console.log("health:", health);

  const job = await request("POST", "/jobs", {
    workspace: "timfinance",
    worker: "cursor",
    prompt: "Inspect the repository and summarize the app structure. Do not modify files.",
    requested_by: "xiaoju",
    mode: "read_only",
  });
  console.log("created job:", job.id, job.status);

  const approved = await request("POST", `/jobs/${job.id}/approve`, {
    approved_by: "tim",
    approval_note: "Approved read-only inspection",
  });
  console.log("approved job:", approved.id, approved.status);

  if (shouldRun) {
    const finished = await request("POST", `/jobs/${job.id}/run`, {
      confirm_execution: true,
    });
    console.log("ran job:", finished.id, finished.status);
  } else {
    console.log("Skipped POST /jobs/:id/run (pass --run to execute Cursor)");
  }

  console.log("Smoke test passed.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
