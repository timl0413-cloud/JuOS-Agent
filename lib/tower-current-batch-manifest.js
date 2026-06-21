const fs = require("fs");
const path = require("path");
const { classifyJob, STATUS_CATEGORIES } = require("./command-channel-status");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_FILE = path.join(ROOT, "config", "tower-current-batch.json");

const INTENDED_STATUSES = new Set([
  "done",
  "running",
  "pending",
  "needs_tim",
  "blocked",
]);

const CATEGORY_PRIORITY = {
  [STATUS_CATEGORIES.CLAIMED_RUNNING]: 5,
  [STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL]: 4,
  [STATUS_CATEGORIES.PENDING_UNCLAIMED]: 3,
  [STATUS_CATEGORIES.FAILED_OR_BLOCKED]: 2,
  [STATUS_CATEGORIES.COMPLETED]: 1,
};

function loadTowerCurrentBatchManifest(options = {}) {
  const filePath = options.manifestPath || MANIFEST_FILE;
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function buildJobIndex(summary, jobs) {
  const index = new Map();
  for (const items of Object.values(summary?.buckets || {})) {
    for (const item of items) {
      const job = item.job;
      if (job?.id) {
        index.set(job.id, item);
      }
    }
  }
  if (jobs) {
    for (const rawJob of jobs) {
      const classified = classifyJob(rawJob);
      const job = classified.job;
      if (job?.id && !index.has(job.id)) {
        index.set(job.id, classified);
      }
    }
  }
  return index;
}

function pickLinkedClassified(manifestItem, jobIndex) {
  const ids = manifestItem.linked_job_ids || [];
  let best = null;
  let bestPriority = 0;
  for (const id of ids) {
    const classified = jobIndex.get(id);
    if (!classified) {
      continue;
    }
    const priority = CATEGORY_PRIORITY[classified.category] || 0;
    if (priority > bestPriority) {
      best = classified;
      bestPriority = priority;
    }
  }
  return best;
}

function intendedStatusLabel(status) {
  switch (status) {
    case "done":
      return "done (manifest)";
    case "running":
      return "running (manifest)";
    case "pending":
      return "pending (manifest)";
    case "needs_tim":
      return "needs Tim (manifest)";
    case "blocked":
      return "blocked (manifest)";
    default:
      return status || "pending (manifest)";
  }
}

function manifestBatchState(intendedStatus, BATCH_STATES) {
  switch (intendedStatus) {
    case "done":
      return BATCH_STATES.COMPLETED;
    case "running":
      return BATCH_STATES.RUNNING;
    case "pending":
      return BATCH_STATES.PENDING;
    case "needs_tim":
      return BATCH_STATES.PENDING;
    case "blocked":
      return BATCH_STATES.FAILED;
    default:
      return BATCH_STATES.PENDING;
  }
}

function classifiedBatchState(category, BATCH_STATES) {
  switch (category) {
    case STATUS_CATEGORIES.COMPLETED:
      return BATCH_STATES.COMPLETED;
    case STATUS_CATEGORIES.CLAIMED_RUNNING:
      return BATCH_STATES.RUNNING;
    case STATUS_CATEGORIES.FAILED_OR_BLOCKED:
      return BATCH_STATES.FAILED;
    case STATUS_CATEGORIES.PENDING_UNCLAIMED:
      return BATCH_STATES.FUTURE;
    default:
      return BATCH_STATES.PENDING;
  }
}

function classifiedStatusLabel(classified, options = {}) {
  const job = classified.job;
  const category = classified.category;
  if (category === STATUS_CATEGORIES.CLAIMED_RUNNING) {
    return job.claimed_by ? `running · ${job.claimed_by}` : "running";
  }
  if (category === STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL) {
    return "awaiting Tim approval";
  }
  if (category === STATUS_CATEGORIES.PENDING_UNCLAIMED) {
    return "approved · waiting for worker claim";
  }
  if (category === STATUS_CATEGORIES.COMPLETED) {
    if (options.urgentReview) {
      return "review completed result · recent";
    }
  }
  if (category === STATUS_CATEGORIES.FAILED_OR_BLOCKED) {
    const err = job.errors?.length
      ? job.errors.join("; ")
      : classified.reason || "blocked";
    return err;
  }
  return classified.reason || job.status || "—";
}

function classifiedTimAction(classified, options = {}) {
  const category = classified.category;
  if (category === STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL) {
    return true;
  }
  if (category === STATUS_CATEGORIES.PENDING_UNCLAIMED) {
    return options.firstStranded === true;
  }
  if (category === STATUS_CATEGORIES.FAILED_OR_BLOCKED) {
    return true;
  }
  if (category === STATUS_CATEGORIES.COMPLETED && options.urgentReview) {
    return true;
  }
  if (options.runningTooLong) {
    return true;
  }
  return false;
}

function resolveManifestItemRow(manifestItem, context) {
  const {
    jobIndex,
    runningTooLongIds,
    urgentReviewIds,
    firstStrandedJobId,
    formatBatchTaskEntry,
    BATCH_STATES,
  } = context;

  const linked = pickLinkedClassified(manifestItem, jobIndex);
  const profile =
    manifestItem.profile ||
    linked?.job?.target_worker_profile ||
    "—";
  const repo =
    manifestItem.project ||
    linked?.job?.repo_ref ||
    "—";
  const plan = manifestItem.task_title || "—";
  const purpose = manifestItem.purpose || "—";
  const timNote = manifestItem.tim_action_note || null;

  if (linked?.job?.id) {
    const job = linked.job;
    const urgentReview = urgentReviewIds.has(job.id);
    const runningTooLong = runningTooLongIds.has(job.id);
    const statusLabel = classifiedStatusLabel(linked, {
      urgentReview,
      runningTooLong,
    });
    const timAction = classifiedTimAction(linked, {
      urgentReview,
      runningTooLong,
      firstStranded: firstStrandedJobId === job.id,
    });
    const entry = formatBatchTaskEntry(linked, {
      batch_state: classifiedBatchState(linked.category, BATCH_STATES),
      status_label: statusLabel,
      hint: timNote || statusLabel,
      tim_action_needed: timAction || Boolean(timNote),
    });
    if (entry) {
      entry.plan = plan;
      entry.purpose = purpose;
      entry.profile = profile;
      entry.repo = repo;
      if (timNote && !entry.tim_action_needed) {
        entry.hint = timNote;
      }
    }
    return entry;
  }

  const intended = String(manifestItem.intended_status || "pending").toLowerCase();
  const safeIntended = INTENDED_STATUSES.has(intended) ? intended : "pending";
  const batchState = manifestBatchState(safeIntended, BATCH_STATES);
  const statusLabel = intendedStatusLabel(safeIntended);
  const timAction =
    safeIntended === "needs_tim" ||
    safeIntended === "blocked" ||
    Boolean(timNote);

  return {
    id: "—",
    profile,
    repo,
    plan,
    purpose,
    status: safeIntended,
    status_label: statusLabel,
    batch_state: batchState,
    tim_action_needed: timAction,
    hint: timNote || statusLabel,
    at: null,
    manifest_order: manifestItem.order,
    from_manifest: true,
  };
}

function sortManifestItems(items) {
  return [...items].sort((a, b) => {
    const aOrder = Number(a.order) || 0;
    const bOrder = Number(b.order) || 0;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return String(a.task_title || "").localeCompare(String(b.task_title || ""));
  });
}

module.exports = {
  MANIFEST_FILE,
  loadTowerCurrentBatchManifest,
  buildJobIndex,
  resolveManifestItemRow,
  sortManifestItems,
  pickLinkedClassified,
};
