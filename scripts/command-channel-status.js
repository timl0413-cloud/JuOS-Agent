#!/usr/bin/env node

const { listJobs, getJob, getBackendStatus } = require("../lib/command-channel-store");
const {
  classifyJob,
  summarizeJobs,
  formatStatusReport,
  renderStatusPacket,
  buildRecoveryCommand,
  STATUS_CATEGORIES,
} = require("../lib/command-channel-status");
const { XIAOJU_TOKEN_NAME } = require("../lib/command-channel-auth");

function loadLocalWorkerEnv() {
  const fs = require("fs");
  const path = require("path");

  const candidates = [
    path.join(__dirname, "..", "config", "command-channel-worker.env"),
    path.join(process.cwd(), ".env.command-channel-worker"),
    path.join(process.cwd(), ".env.juos.prod.local"),
    path.join(process.cwd(), ".env.vercel.production.local"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;

    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) continue;

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

function getXiaojuToken() {
  if (process.env.XIAOJU_ACTION_TOKEN) {
    return { token: process.env.XIAOJU_ACTION_TOKEN, source: "env:XIAOJU_ACTION_TOKEN" };
  }

  const { loadAuthTokens, findTokenByName } = require("../lib/auth");
  const tokens = loadAuthTokens();
  if (!tokens) {
    throw new Error(
      "XiaoJu list token missing: set XIAOJU_ACTION_TOKEN or config/auth.json"
    );
  }

  const record = findTokenByName(XIAOJU_TOKEN_NAME, tokens);
  if (!record?.token || record.token === "replace-with-xiaoju-command-channel-secret") {
    throw new Error(`XiaoJu token "${XIAOJU_TOKEN_NAME}" is not configured`);
  }

  return { token: record.token, source: XIAOJU_TOKEN_NAME };
}

async function httpListJobs(filter = {}) {
  const baseUrl =
    process.env.COMMAND_CHANNEL_URL ||
    "https://juos.vercel.app/api/command-channel";
  const { token } = getXiaojuToken();

  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.target_worker_profile) {
    params.set("target_worker_profile", filter.target_worker_profile);
  }
  if (filter.requested_by) params.set("requested_by", filter.requested_by);

  const query = params.toString();
  const url = `${baseUrl.replace(/\/$/, "")}/remote-jobs${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
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
    throw new Error(
      `remote-jobs list failed (${response.status}): ${JSON.stringify(data)}`
    );
  }

  return Array.isArray(data?.jobs) ? data.jobs : [];
}

async function httpGetJob(jobId) {
  const baseUrl =
    process.env.COMMAND_CHANNEL_URL ||
    "https://juos.vercel.app/api/command-channel";
  const { token } = getXiaojuToken();

  const url = `${baseUrl.replace(/\/$/, "")}/remote-jobs/${jobId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `remote-jobs read failed (${response.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

function resolveMode() {
  if (process.argv.includes("--local")) {
    return "local";
  }
  if (process.argv.includes("--http")) {
    return "http";
  }
  if (process.env.COMMAND_CHANNEL_URL) {
    return "http";
  }
  return "local";
}

async function fetchJobs(options = {}) {
  const filter = {};
  if (options.profile) {
    filter.target_worker_profile = options.profile;
  }
  if (options.status) {
    filter.status = options.status;
  }

  if (options.mode === "http") {
    return httpListJobs(filter);
  }

  return listJobs(filter);
}

async function fetchJob(jobId, mode) {
  if (mode === "http") {
    return httpGetJob(jobId);
  }
  return getJob(jobId);
}

async function main() {
  loadLocalWorkerEnv();

  const mode = resolveMode();
  const profile = parseNamedArg("--profile");
  const statusFilter = parseNamedArg("--status");
  const jobId = parseNamedArg("--job-id");
  const asJson = process.argv.includes("--json");
  const asPacket = process.argv.includes("--packet");
  const recoveryOnly = process.argv.includes("--recovery");
  const recoveryPackets = process.argv.includes("--recovery-packets");
  const targetRoom = parseNamedArg("--target-room") || "room";
  const recoveryStyle = process.argv.includes("--recovery-node") ? "node" : "powershell";

  if (jobId && asPacket) {
    const job = await fetchJob(jobId, mode);
    if (!job) {
      console.error(`Job not found: ${jobId}`);
      process.exit(1);
    }
    const classified = classifyJob(job);
    console.log(
      renderStatusPacket(classified, {
        target_room: targetRoom,
        style: recoveryStyle,
      })
    );
    return;
  }

  const jobs = await fetchJobs({
    mode,
    profile,
    status: statusFilter,
  });

  const summary = summarizeJobs(jobs);
  const stranded = summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED];

  if (recoveryOnly || recoveryPackets) {
    if (stranded.length === 0) {
      console.log("No stranded jobs (approved + pending + unclaimed).");
      if (recoveryOnly && !recoveryPackets) {
        console.log("");
        console.log(
          "Keep worker loop running: .\\scripts\\start-joa-worker-loop.ps1"
        );
      }
      return;
    }

    for (const classified of stranded) {
      const job = classified.job;
      if (recoveryPackets) {
        console.log(
          renderStatusPacket(classified, {
            target_room: targetRoom,
            style: recoveryStyle,
          })
        );
        console.log("");
        continue;
      }

      console.log(`${job.id} | profile=${job.target_worker_profile} | task=${job.task_type}`);
      console.log(`  RECOVER: ${buildRecoveryCommand(job, { style: recoveryStyle })}`);
      if (job.approval_summary) {
        console.log(`  approval: ${job.approval_summary}`);
      }
      console.log("");
    }

    if (recoveryOnly && !recoveryPackets) {
      console.log(
        "Preferred fix: start persistent loop — .\\scripts\\start-joa-worker-loop.ps1"
      );
    }
    return;
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode,
          backend: mode === "local" ? getBackendStatus() : { backend: "http" },
          ...summary,
        },
        null,
        2
      )
    );
    return;
  }

  const header =
    mode === "http"
      ? `Backend: http (${process.env.COMMAND_CHANNEL_URL || "https://juos.vercel.app/api/command-channel"})`
      : `Backend: local (${JSON.stringify(getBackendStatus())})`;

  console.log(formatStatusReport(summary, { style: recoveryStyle }));
  console.log(header);

  if (summary.stranded_count > 0) {
    console.log("");
    console.log("Quick recovery: run the RECOVER line for each stranded job.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  resolveMode,
  fetchJobs,
  fetchJob,
  httpListJobs,
};
