const fs = require("fs");
const path = require("path");
const { classifyJob, STATUS_CATEGORIES } = require("./command-channel-status");

// Current batch manifest: Tower renders every item in config/tower-current-batch.json
// (sorted by order). There is no fixed row limit — batch size is however many items
// Tim lists in the manifest.
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_FILE = path.join(ROOT, "config", "tower-current-batch.json");

const TOWER_ITEM_TAG_RE = /\[tower_item:([a-z0-9_-]+)\]/gi;

const INTENDED_STATUSES = new Set([
  "done",
  "running",
  "pending",
  "needs_tim",
  "blocked",
]);

const LINKED_ID_CATEGORY_PRIORITY = {
  [STATUS_CATEGORIES.FAILED_OR_BLOCKED]: 5,
  [STATUS_CATEGORIES.CLAIMED_RUNNING]: 4,
  [STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL]: 3,
  [STATUS_CATEGORIES.PENDING_UNCLAIMED]: 2,
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

function extractJobMatchText(job) {
  const parts = [
    job?.plan_summary,
    job?.prompt,
    job?.approval_summary,
    job?.result?.summary,
    job?.result?.message,
  ].filter(Boolean);
  return parts.join("\n");
}

function parseTowerItemTags(text) {
  const tags = new Set();
  if (!text) {
    return tags;
  }
  TOWER_ITEM_TAG_RE.lastIndex = 0;
  let match;
  while ((match = TOWER_ITEM_TAG_RE.exec(text)) !== null) {
    tags.add(String(match[1]).toLowerCase());
  }
  return tags;
}

function normalizeMatchTerm(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function jobMatchesManifestItem(manifestItem, classified) {
  const job = classified?.job;
  if (!job?.id) {
    return false;
  }

  const jobText = extractJobMatchText(job);
  const normalizedText = jobText.toLowerCase();
  const tags = parseTowerItemTags(jobText);
  const manifestKey = manifestItem.key
    ? normalizeMatchTerm(manifestItem.key)
    : null;

  if (manifestKey && tags.has(manifestKey)) {
    return true;
  }

  for (const alias of manifestItem.aliases || []) {
    if (tags.has(normalizeMatchTerm(alias))) {
      return true;
    }
  }

  if (manifestKey && normalizedText.includes(manifestKey)) {
    return true;
  }

  const matchers = [
    ...(manifestItem.matchers || []),
    ...(manifestItem.keywords || []),
    ...(manifestItem.aliases || []),
  ];

  for (const matcher of matchers) {
    const term = normalizeMatchTerm(matcher);
    if (term.length >= 4 && normalizedText.includes(term)) {
      return true;
    }
  }

  const title = normalizeMatchTerm(manifestItem.task_title);
  if (
    matchers.length === 0 &&
    title.length >= 8 &&
    normalizedText.includes(title)
  ) {
    return true;
  }

  return false;
}

function inferManifestMatchKind(manifestItem, classified) {
  const job = classified?.job;
  if (!job?.id) {
    return null;
  }

  const linkedIds = manifestItem.linked_job_ids || [];
  if (linkedIds.includes(job.id)) {
    return "linked_job_id";
  }

  const jobText = extractJobMatchText(job);
  const tags = parseTowerItemTags(jobText);
  const manifestKey = manifestItem.key
    ? normalizeMatchTerm(manifestItem.key)
    : null;

  if (manifestKey && tags.has(manifestKey)) {
    return "tower_item_tag";
  }

  for (const alias of manifestItem.aliases || []) {
    if (tags.has(normalizeMatchTerm(alias))) {
      return "tower_item_tag";
    }
  }

  if (manifestKey && jobText.toLowerCase().includes(manifestKey)) {
    return "manifest_key";
  }

  return "keyword";
}

function jobRecencyMs(classified) {
  const job = classified?.job;
  if (!job) {
    return 0;
  }
  return (
    Date.parse(job.updated_at || "") ||
    Date.parse(job.claimed_at || "") ||
    Date.parse(job.approved_at || "") ||
    Date.parse(job.created_at || "") ||
    0
  );
}

function pickBestMatchingClassified(matches) {
  if (!matches.length) {
    return null;
  }

  const sorted = [...matches].sort((a, b) => {
    const aPriority = LINKED_ID_CATEGORY_PRIORITY[a.category] || 0;
    const bPriority = LINKED_ID_CATEGORY_PRIORITY[b.category] || 0;
    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }
    return jobRecencyMs(b) - jobRecencyMs(a);
  });

  return sorted[0];
}

function findMatchingJobs(manifestItem, jobIndex) {
  const matches = [];
  for (const classified of jobIndex.values()) {
    if (jobMatchesManifestItem(manifestItem, classified)) {
      matches.push(classified);
    }
  }
  return matches;
}

function pickLinkedClassified(manifestItem, jobIndex) {
  const ids = manifestItem.linked_job_ids || [];
  const matches = [];
  for (const id of ids) {
    const classified = jobIndex.get(id);
    if (classified) {
      matches.push(classified);
    }
  }
  return pickBestMatchingClassified(matches);
}

function resolveManifestLinkedJob(manifestItem, jobIndex) {
  const explicit = pickLinkedClassified(manifestItem, jobIndex);
  if (explicit) {
    return {
      classified: explicit,
      match_kind: "linked_job_id",
    };
  }

  const matches = findMatchingJobs(manifestItem, jobIndex);
  const best = pickBestMatchingClassified(matches);
  if (!best) {
    return { classified: null, match_kind: null };
  }

  return {
    classified: best,
    match_kind: inferManifestMatchKind(manifestItem, best),
  };
}

function intendedStatusLabel(status) {
  switch (status) {
    case "done":
      return "Done · planned";
    case "running":
      return "Next · planned";
    case "pending":
      return "Queued · planned";
    case "needs_tim":
      return "Needs Tim · planned";
    case "blocked":
      return "Blocked · planned";
    default:
      return "Queued · planned";
  }
}

// Planned/manifest-only rows never use RUNNING (green). Green is live-only.
function manifestBatchState(intendedStatus, BATCH_STATES) {
  switch (intendedStatus) {
    case "done":
      return BATCH_STATES.COMPLETED;
    case "running":
    case "pending":
      return BATCH_STATES.FUTURE;
    case "needs_tim":
      return BATCH_STATES.PENDING;
    case "blocked":
      return BATCH_STATES.FAILED;
    default:
      return BATCH_STATES.FUTURE;
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
    if (options.runningTooLong) {
      return job.claimed_by ? `Running long · ${job.claimed_by}` : "Running long";
    }
    return job.claimed_by ? `Ongoing · ${job.claimed_by}` : "Ongoing";
  }
  if (category === STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL) {
    return "Awaiting approval";
  }
  if (category === STATUS_CATEGORIES.PENDING_UNCLAIMED) {
    return "Waiting · approved";
  }
  if (category === STATUS_CATEGORIES.COMPLETED) {
    if (options.urgentReview) {
      return "Done · review needed";
    }
    return "Done";
  }
  if (category === STATUS_CATEGORIES.FAILED_OR_BLOCKED) {
    const err = job.errors?.length
      ? job.errors.join("; ")
      : classified.reason || "blocked";
    return `Failed · ${err}`;
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

  const { classified: linked, match_kind: matchKind } = resolveManifestLinkedJob(
    manifestItem,
    jobIndex
  );
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
    const liveStatusLabel = classifiedStatusLabel(linked, {
      urgentReview,
      runningTooLong,
    });
    const statusLabel = `${liveStatusLabel} · live`;
    const timAction = classifiedTimAction(linked, {
      urgentReview,
      runningTooLong,
      firstStranded: firstStrandedJobId === job.id,
    });
    // Green (RUNNING) only when live job category is claimed/running/active.
    const liveBatchState =
      linked.category === STATUS_CATEGORIES.CLAIMED_RUNNING
        ? BATCH_STATES.RUNNING
        : classifiedBatchState(linked.category, BATCH_STATES);
    const entry = formatBatchTaskEntry(linked, {
      batch_state: liveBatchState,
      status_label: statusLabel,
      hint: timNote || statusLabel,
      tim_action_needed: timAction || Boolean(timNote),
    });
    if (entry) {
      entry.plan = plan;
      entry.purpose = purpose;
      entry.profile = profile;
      entry.repo = repo;
      entry.live_linked = true;
      entry.status_source = "live";
      entry.match_kind = matchKind;
      entry.manifest_key = manifestItem.key || null;
      if (linked.category === STATUS_CATEGORIES.CLAIMED_RUNNING) {
        entry.job_claimed_at = job.claimed_at || null;
        entry.job_updated_at = job.updated_at || job.claimed_at || null;
        entry.running_too_long = runningTooLong;
      }
      if (timNote && !entry.tim_action_needed) {
        entry.hint = timNote;
      }
    }
    return entry;
  }

  const intended = String(manifestItem.intended_status || "pending").toLowerCase();
  const safeIntended = INTENDED_STATUSES.has(intended) ? intended : "pending";
  const batchState = manifestBatchState(safeIntended, BATCH_STATES);
  // Hard rule: unmatched manifest rows are never green.
  const safeBatchState =
    batchState === BATCH_STATES.RUNNING ? BATCH_STATES.FUTURE : batchState;
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
    batch_state: safeBatchState,
    tim_action_needed: timAction,
    hint: timNote || statusLabel,
    at: null,
    manifest_order: manifestItem.order,
    from_manifest: true,
    live_linked: false,
    status_source: "planned",
    manifest_key: manifestItem.key || null,
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
  TOWER_ITEM_TAG_RE,
  loadTowerCurrentBatchManifest,
  buildJobIndex,
  resolveManifestItemRow,
  sortManifestItems,
  pickLinkedClassified,
  resolveManifestLinkedJob,
  parseTowerItemTags,
  jobMatchesManifestItem,
  findMatchingJobs,
  pickBestMatchingClassified,
  intendedStatusLabel,
  manifestBatchState,
  classifiedStatusLabel,
};
