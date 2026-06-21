const { classifyJob, STATUS_CATEGORIES } = require("./command-channel-status");

const TIME_SWEEP_CATEGORIES = {
  TRIGGER_NOW: "trigger_now",
  STRANDED: "stranded",
  RUNNING_TOO_LONG: "running_too_long",
  COMPLETED_NEEDS_NOTIFICATION: "completed_needs_notification",
  FAILED: "failed",
  ON_TRACK: "on_track",
  AWAITING_APPROVAL: "awaiting_approval",
};

const DEFAULT_THRESHOLDS = {
  strandedMinutes: 5,
  runningTooLongMinutes: 60,
};

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function minutesBetween(fromMs, toMs) {
  if (fromMs == null || toMs == null) {
    return null;
  }
  return Math.max(0, Math.round((toMs - fromMs) / 60000));
}

function ageMinutesSince(value, nowMs) {
  const at = parseTimestamp(value);
  if (at == null) {
    return null;
  }
  return minutesBetween(at, nowMs);
}

function classifyJobTimeSweep(rawJob, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const classified = classifyJob(rawJob);
  const job = classified.job;

  if (!job) {
    return {
      time_category: TIME_SWEEP_CATEGORIES.FAILED,
      trigger_now: true,
      classified,
      reason: "missing job",
      age_minutes: null,
      reference_at: null,
    };
  }

  const approvedAge = ageMinutesSince(job.approved_at || job.created_at, nowMs);
  const claimedAge = ageMinutesSince(job.claimed_at, nowMs);
  const referenceAt = job.claimed_at || job.approved_at || job.created_at;

  if (classified.category === STATUS_CATEGORIES.FAILED_OR_BLOCKED) {
    return {
      time_category: TIME_SWEEP_CATEGORIES.FAILED,
      trigger_now: true,
      classified,
      reason: classified.reason,
      age_minutes: ageMinutesSince(job.updated_at || job.created_at, nowMs),
      reference_at: job.updated_at || job.created_at,
    };
  }

  if (classified.category === STATUS_CATEGORIES.COMPLETED) {
    return {
      time_category: TIME_SWEEP_CATEGORIES.COMPLETED_NEEDS_NOTIFICATION,
      trigger_now: true,
      classified,
      reason: "completed_needs_room_notification",
      age_minutes: ageMinutesSince(job.completed_at, nowMs),
      reference_at: job.completed_at,
    };
  }

  if (classified.category === STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL) {
    return {
      time_category: TIME_SWEEP_CATEGORIES.AWAITING_APPROVAL,
      trigger_now: true,
      classified,
      reason: "awaiting_tim_approval",
      age_minutes: ageMinutesSince(job.created_at, nowMs),
      reference_at: job.created_at,
    };
  }

  if (classified.category === STATUS_CATEGORIES.PENDING_UNCLAIMED) {
    const isStranded =
      approvedAge == null || approvedAge >= thresholds.strandedMinutes;
    return {
      time_category: isStranded
        ? TIME_SWEEP_CATEGORIES.STRANDED
        : TIME_SWEEP_CATEGORIES.TRIGGER_NOW,
      trigger_now: true,
      classified,
      reason: isStranded ? "approved_unclaimed_past_threshold" : "approved_unclaimed_fresh",
      age_minutes: approvedAge,
      reference_at: job.approved_at || job.created_at,
    };
  }

  if (classified.category === STATUS_CATEGORIES.CLAIMED_RUNNING) {
    const tooLong =
      claimedAge != null && claimedAge >= thresholds.runningTooLongMinutes;
    return {
      time_category: tooLong
        ? TIME_SWEEP_CATEGORIES.RUNNING_TOO_LONG
        : TIME_SWEEP_CATEGORIES.ON_TRACK,
      trigger_now: tooLong,
      classified,
      reason: tooLong ? "claimed_past_runtime_threshold" : "claimed_within_runtime_threshold",
      age_minutes: claimedAge,
      reference_at: job.claimed_at,
    };
  }

  return {
    time_category: TIME_SWEEP_CATEGORIES.FAILED,
    trigger_now: true,
    classified,
    reason: classified.reason || "unknown",
    age_minutes: ageMinutesSince(referenceAt, nowMs),
    reference_at: referenceAt,
  };
}

function summarizeTimeSweep(jobs, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const sweptAt = new Date(nowMs).toISOString();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };

  const buckets = {
    [TIME_SWEEP_CATEGORIES.TRIGGER_NOW]: [],
    [TIME_SWEEP_CATEGORIES.STRANDED]: [],
    [TIME_SWEEP_CATEGORIES.RUNNING_TOO_LONG]: [],
    [TIME_SWEEP_CATEGORIES.COMPLETED_NEEDS_NOTIFICATION]: [],
    [TIME_SWEEP_CATEGORIES.FAILED]: [],
    [TIME_SWEEP_CATEGORIES.ON_TRACK]: [],
    [TIME_SWEEP_CATEGORIES.AWAITING_APPROVAL]: [],
  };

  const items = [];

  for (const rawJob of jobs) {
    const item = classifyJobTimeSweep(rawJob, { nowMs, thresholds });
    items.push(item);
    buckets[item.time_category].push(item);
    if (item.trigger_now && item.time_category !== TIME_SWEEP_CATEGORIES.TRIGGER_NOW) {
      buckets[TIME_SWEEP_CATEGORIES.TRIGGER_NOW].push(item);
    }
  }

  const triggerNow = buckets[TIME_SWEEP_CATEGORIES.TRIGGER_NOW];

  return {
    swept_at: sweptAt,
    now_iso: sweptAt,
    total: jobs.length,
    trigger_now_count: triggerNow.length,
    thresholds,
    buckets,
    items,
  };
}

function formatTimeSweepLine(item, options = {}) {
  const job = item.classified.job;
  const parts = [
    job.id,
    `time=${item.time_category}`,
    `profile=${job.target_worker_profile}`,
    `status=${job.status}`,
    `task=${job.task_type}`,
  ];

  if (item.age_minutes != null) {
    parts.push(`age_min=${item.age_minutes}`);
  }
  if (item.reference_at) {
    parts.push(`ref=${item.reference_at}`);
  }

  const lines = [parts.join(" | ")];

  if (item.classified.category === STATUS_CATEGORIES.PENDING_UNCLAIMED) {
    const { buildRecoveryCommand } = require("./command-channel-status");
    lines.push(`  RECOVER: ${buildRecoveryCommand(job, options)}`);
  }

  if (item.time_category === TIME_SWEEP_CATEGORIES.COMPLETED_NEEDS_NOTIFICATION) {
    lines.push("  NOTIFY: post result.summary to requesting room");
  }

  return lines.join("\n");
}

function formatTimeSweepReport(summary, options = {}) {
  const lines = [
    "=== Command Channel Time-Aware Sweep (v0) ===",
    `Swept: ${summary.total} job(s) at ${summary.swept_at}`,
    `Trigger now: ${summary.trigger_now_count}`,
    `Thresholds: stranded>=${summary.thresholds.strandedMinutes}m after approval, running-too-long>=${summary.thresholds.runningTooLongMinutes}m after claim`,
    "",
  ];

  const sections = [
    [TIME_SWEEP_CATEGORIES.TRIGGER_NOW, "TRIGGER NOW - operator attention"],
    [TIME_SWEEP_CATEGORIES.STRANDED, "STRANDED - approved + unclaimed past threshold"],
    [TIME_SWEEP_CATEGORIES.RUNNING_TOO_LONG, "RUNNING TOO LONG - claimed past threshold"],
    [
      TIME_SWEEP_CATEGORIES.COMPLETED_NEEDS_NOTIFICATION,
      "COMPLETED - needs room notification",
    ],
    [TIME_SWEEP_CATEGORIES.AWAITING_APPROVAL, "AWAITING APPROVAL"],
    [TIME_SWEEP_CATEGORIES.FAILED, "FAILED / BLOCKED"],
    [TIME_SWEEP_CATEGORIES.ON_TRACK, "ON TRACK - claimed within threshold"],
  ];

  for (const [category, title] of sections) {
    const items = summary.buckets[category];
    lines.push(`## ${title}: ${items.length}`);
    if (items.length === 0) {
      lines.push("(none)");
    } else {
      for (const item of items) {
        lines.push(formatTimeSweepLine(item, options));
      }
    }
    lines.push("");
  }

  lines.push("Sweep rule: each status check captures `swept_at` (now); no background timer required.");
  lines.push("Station 4/5 setup: see docs/command-channel/time-aware-status-sweep-v0.md");

  return lines.join("\n");
}

function classifyTimosTask(task, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const status = String(task?.status || "").toLowerCase();
  const targetCompletion = parseTimestamp(task?.target_completion || task?.due_at);
  const scheduledDate = parseTimestamp(task?.date || task?.scheduled_date);
  const completedAt = parseTimestamp(task?.completed_at);

  const isDone = ["done", "completed", "closed"].includes(status);
  const isActive = ["in_progress", "active", "started", "claimed"].includes(status);

  if (isDone) {
    if (targetCompletion != null && completedAt != null && completedAt < targetCompletion) {
      return { timos_category: "ahead", trigger_now: false, reason: "completed_before_target" };
    }
    return { timos_category: "done", trigger_now: false, reason: "completed" };
  }

  if (targetCompletion != null && nowMs > targetCompletion) {
    return { timos_category: "delayed", trigger_now: true, reason: "past_target_completion" };
  }

  if (scheduledDate != null && nowMs >= scheduledDate && !isActive && !isDone) {
    return { timos_category: "trigger_now", trigger_now: true, reason: "scheduled_start_reached" };
  }

  if (isActive) {
    return { timos_category: "on_track", trigger_now: false, reason: "active_within_window" };
  }

  return { timos_category: "on_track", trigger_now: false, reason: "not_yet_due" };
}

module.exports = {
  TIME_SWEEP_CATEGORIES,
  DEFAULT_THRESHOLDS,
  parseTimestamp,
  ageMinutesSince,
  classifyJobTimeSweep,
  summarizeTimeSweep,
  formatTimeSweepLine,
  formatTimeSweepReport,
  classifyTimosTask,
};
