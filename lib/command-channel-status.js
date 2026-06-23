const STATUS_CATEGORIES = {
  PENDING_UNCLAIMED: "pending_unclaimed",
  PENDING_AWAITING_APPROVAL: "pending_awaiting_approval",
  CLAIMED_RUNNING: "claimed_running",
  COMPLETED: "completed",
  FAILED_OR_BLOCKED: "failed_or_blocked",
};

function getJobPayload(job) {
  if (job?.payload && typeof job.payload === "object") {
    return job.payload;
  }
  return {};
}

function readJobField(job, fieldName) {
  if (job?.[fieldName] != null) {
    return job[fieldName];
  }
  const payload = getJobPayload(job);
  if (payload[fieldName] != null) {
    return payload[fieldName];
  }
  return null;
}

function normalizeJob(job) {
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    status: String(job.status || "").toLowerCase(),
    target_worker_profile: job.target_worker_profile || null,
    repo_ref: job.repo_ref || null,
    workspace_ref: job.workspace_ref || readJobField(job, "workspace_ref"),
    task_type: job.task_type || null,
    requested_by: job.requested_by || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
    claimed_at: job.claimed_at || null,
    completed_at: job.completed_at || null,
    claimed_by: job.claimed_by || null,
    approval_required: readJobField(job, "approval_required") === true,
    approval_status: readJobField(job, "approval_status"),
    approved_by: readJobField(job, "approved_by"),
    approved_at: readJobField(job, "approved_at"),
    approval_summary: readJobField(job, "approval_summary"),
    plan_summary: readJobField(job, "plan_summary"),
    prompt: job.prompt || readJobField(job, "prompt"),
    result: job.result ?? null,
    errors: Array.isArray(job.errors) ? job.errors : [],
  };
}

function isApprovedForExecution(job) {
  if (!job.approval_required) {
    return true;
  }
  return String(job.approval_status || "").toLowerCase() === "approved";
}

function classifyJob(rawJob) {
  const job = normalizeJob(rawJob);
  if (!job) {
    return { category: STATUS_CATEGORIES.FAILED_OR_BLOCKED, job: null, reason: "missing job" };
  }

  const status = job.status;

  if (status === "failed" || status === "cancelled") {
    return {
      category: STATUS_CATEGORIES.FAILED_OR_BLOCKED,
      job,
      reason: status,
    };
  }

  if (status === "completed") {
    return {
      category: STATUS_CATEGORIES.COMPLETED,
      job,
      reason: "completed",
      needs_room_notification: true,
    };
  }

  if (status === "claimed") {
    return {
      category: STATUS_CATEGORIES.CLAIMED_RUNNING,
      job,
      reason: "claimed",
    };
  }

  if (status === "pending") {
    if (!isApprovedForExecution(job)) {
      return {
        category: STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL,
        job,
        reason: "awaiting_approval",
      };
    }

    if (!job.claimed_at) {
      return {
        category: STATUS_CATEGORIES.PENDING_UNCLAIMED,
        job,
        reason: "approved_pending_unclaimed",
        stranded: true,
      };
    }

    return {
      category: STATUS_CATEGORIES.FAILED_OR_BLOCKED,
      job,
      reason: "pending_with_claimed_at",
    };
  }

  if (job.errors.length > 0) {
    return {
      category: STATUS_CATEGORIES.FAILED_OR_BLOCKED,
      job,
      reason: "errors_present",
    };
  }

  return {
    category: STATUS_CATEGORIES.FAILED_OR_BLOCKED,
    job,
    reason: `unknown_status:${status || "empty"}`,
  };
}

function buildRecoveryCommand(job, options = {}) {
  const profile = job.target_worker_profile || "joa";
  const jobId = job.id;
  const style = options.style || "powershell";

  if (style === "node") {
    return `node scripts/command-channel-worker.js --http --once --worker-profile ${profile} --job-id ${jobId} --provider codex`;
  }

  return `.\\scripts\\start-juos-worker.ps1 -Profile ${profile} -Provider codex -JobId ${jobId}`;
}

function summarizeJobs(jobs) {
  const buckets = {
    [STATUS_CATEGORIES.PENDING_UNCLAIMED]: [],
    [STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL]: [],
    [STATUS_CATEGORIES.CLAIMED_RUNNING]: [],
    [STATUS_CATEGORIES.COMPLETED]: [],
    [STATUS_CATEGORIES.FAILED_OR_BLOCKED]: [],
  };

  for (const rawJob of jobs) {
    const classified = classifyJob(rawJob);
    buckets[classified.category].push(classified);
  }

  return {
    scanned_at: new Date().toISOString(),
    total: jobs.length,
    stranded_count: buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED].length,
    buckets,
  };
}

function formatJobLine(classified, options = {}) {
  const job = classified.job;
  const parts = [
    job.id,
    `profile=${job.target_worker_profile}`,
    `status=${job.status}`,
    `task=${job.task_type}`,
    `repo=${job.repo_ref}`,
  ];

  if (job.workspace_ref) {
    parts.push(`workspace=${job.workspace_ref}`);
  }
  if (job.created_at) {
    parts.push(`created=${job.created_at}`);
  }
  if (job.approved_at) {
    parts.push(`approved=${job.approved_at}`);
  }
  if (job.claimed_at) {
    parts.push(`claimed=${job.claimed_at}`);
  }
  if (job.completed_at) {
    parts.push(`completed=${job.completed_at}`);
  }

  const lines = [parts.join(" | ")];

  if (classified.category === STATUS_CATEGORIES.PENDING_UNCLAIMED) {
    lines.push(`  RECOVER: ${buildRecoveryCommand(job, options)}`);
  }

  if (job.approval_summary) {
    lines.push(`  approval: ${truncate(job.approval_summary, 120)}`);
  } else if (job.plan_summary) {
    lines.push(`  plan: ${truncate(job.plan_summary, 120)}`);
  }

  if (job.errors.length > 0) {
    lines.push(`  errors: ${job.errors.join("; ")}`);
  }

  if (
    classified.category === STATUS_CATEGORIES.COMPLETED &&
    job.result?.summary
  ) {
    lines.push(`  result: ${truncate(String(job.result.summary), 120)}`);
  }

  return lines.join("\n");
}

function truncate(text, maxLen) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen - 3)}...`;
}

function formatStatusReport(summary, options = {}) {
  const lines = [
    "=== Command Channel Status (no-stranded-job v0) ===",
    `Scanned: ${summary.total} job(s) at ${summary.scanned_at}`,
    `Stranded (approved + pending + unclaimed): ${summary.stranded_count}`,
    "",
  ];

  const sections = [
    [STATUS_CATEGORIES.PENDING_UNCLAIMED, "STRANDED — approved + pending + unclaimed"],
    [STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL, "AWAITING APPROVAL — pending, not approved"],
    [STATUS_CATEGORIES.CLAIMED_RUNNING, "CLAIMED / RUNNING"],
    [STATUS_CATEGORIES.COMPLETED, "COMPLETED — verify room notified"],
    [STATUS_CATEGORIES.FAILED_OR_BLOCKED, "FAILED / BLOCKED"],
  ];

  for (const [category, title] of sections) {
    const items = summary.buckets[category];
    lines.push(`## ${title}: ${items.length}`);
    if (items.length === 0) {
      lines.push("(none)");
    } else {
      for (const item of items) {
        lines.push(formatJobLine(item, options));
      }
    }
    lines.push("");
  }

  lines.push("Operating rule: approved != running; pending != handled; completed != notified.");
  lines.push("Rooms must not assume execution until claimed_at or result proves it.");

  return lines.join("\n");
}

function renderStatusPacket(classified, options = {}) {
  const job = classified.job;
  const category = classified.category;
  const now = new Date().toISOString().slice(0, 10);
  const packetType = "command-channel-status";
  const targetRoom = options.target_room || "room";
  const sourceRoom = options.source_room || "JOA";

  const categoryTitles = {
    [STATUS_CATEGORIES.PENDING_UNCLAIMED]: "Job approved but not yet claimed",
    [STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL]: "Job pending Tim approval",
    [STATUS_CATEGORIES.CLAIMED_RUNNING]: "Job claimed and running",
    [STATUS_CATEGORIES.COMPLETED]: "Job completed — notify room",
    [STATUS_CATEGORIES.FAILED_OR_BLOCKED]: "Job failed or blocked",
  };

  const nextActions = {
    [STATUS_CATEGORIES.PENDING_UNCLAIMED]: buildRecoveryCommand(job, options),
    [STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL]:
      "Tim must approve before worker claim is valid.",
    [STATUS_CATEGORIES.CLAIMED_RUNNING]:
      "Wait for worker result; do not assume completion.",
    [STATUS_CATEGORIES.COMPLETED]:
      "Post completion summary to requesting room; include result summary if present.",
    [STATUS_CATEGORIES.FAILED_OR_BLOCKED]:
      "Review errors with Tim; do not retry automatically.",
  };

  const blockerFlag =
    category === STATUS_CATEGORIES.PENDING_UNCLAIMED ||
    category === STATUS_CATEGORIES.FAILED_OR_BLOCKED;

  return [
    "---",
    `packet_id: "${job.id.slice(0, 8)}_${category}"`,
    `title: "Command Channel ${category.replace(/_/g, " ")}"`,
    `packet_type: "${packetType}"`,
    `domain: "command-channel"`,
    `status: "${category}"`,
    `freshness: "current"`,
    `source: "${sourceRoom}"`,
    `target: "${targetRoom}"`,
    `owner: "JOA"`,
    `job_id: "${job.id}"`,
    `target_worker_profile: "${job.target_worker_profile || ""}"`,
    `repo_ref: "${job.repo_ref || ""}"`,
    `workspace_ref: "${job.workspace_ref || ""}"`,
    `created_at: "${job.created_at || now}"`,
    `approved_at: "${job.approved_at || ""}"`,
    `claimed_at: "${job.claimed_at || ""}"`,
    `completed_at: "${job.completed_at || ""}"`,
    `blocker_flag: ${blockerFlag}`,
    `recovery_command: "${buildRecoveryCommand(job, options).replace(/"/g, '\\"')}"`,
    "---",
    "",
    "# Summary",
    "",
    categoryTitles[category] || category,
    "",
    `- Job \`${job.id}\` | profile \`${job.target_worker_profile}\` | task \`${job.task_type}\``,
    `- Repo: \`${job.repo_ref}\` | Workspace: \`${job.workspace_ref || "(none)"}\``,
    "",
    "# Timestamps",
    "",
    `- created: ${job.created_at || "(unknown)"}`,
    `- approved: ${job.approved_at || "(none)"}`,
    `- claimed: ${job.claimed_at || "(none)"}`,
    `- completed: ${job.completed_at || "(none)"}`,
    "",
    "# Next Action",
    "",
    nextActions[category] || "Review with Tim.",
    "",
    "# Room Guidance",
    "",
    "- approved != running",
    "- pending != handled",
    "- completed != notified",
    "- Do not assume execution until `claimed_at` or `result` is present",
    "",
  ].join("\n");
}

module.exports = {
  STATUS_CATEGORIES,
  normalizeJob,
  classifyJob,
  buildRecoveryCommand,
  summarizeJobs,
  formatJobLine,
  formatStatusReport,
  renderStatusPacket,
};
