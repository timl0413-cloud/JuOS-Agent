const { STATUS_CATEGORIES, summarizeJobs } = require("./command-channel-status");
const {
  buildSampleSummary,
  escapeHtml,
  jobTitle,
  formatAge,
} = require("./command-channel-bridge-status-page");
const { normalizeJob } = require("./command-channel-status");
const {
  summarizeTimeSweep,
  WATCHLIST_CATEGORIES,
  ageMinutesSince,
} = require("./command-channel-time-sweep");
const {
  loadTowerCurrentBatchManifest,
  buildJobIndex,
  resolveManifestItemRow,
  sortManifestItems,
  buildUnmatchedLiveJobRows,
  MANIFEST_FILE,
} = require("./tower-current-batch-manifest");
const { buildTowerStaleCodeBannerHtml } = require("./tower-server-build-marker");

// Completed jobs older than this are review history, not urgent tower attention.
const REVIEW_URGENT_MAX_AGE_MINUTES = 120;
const REVIEW_HISTORY_MAX_ITEMS = 10;
// Live running row: no job update within this window → possibly stalled (still claimed).
const RUNNING_STALE_UPDATE_MINUTES = 15;

const WATCH_SECTIONS = [
  [WATCHLIST_CATEGORIES.COMPLETED_NEEDS_ASSISTANT_REVIEW, "Completed · needs review"],
  [WATCHLIST_CATEGORIES.FAILED_NEEDS_ATTENTION, "Failed · needs attention"],
  [WATCHLIST_CATEGORIES.PENDING_OR_STRANDED, "Pending / stranded"],
  [WATCHLIST_CATEGORIES.RUNNING_TOO_LONG, "Running too long"],
  [WATCHLIST_CATEGORIES.NO_ACTION_NEEDED, "No action needed"],
];

// Documentation-aligned lane registry (v0 static; not loaded from config at runtime).
// readiness_category: Active now | Ready to test | Pending setup | Blocked | Not safe yet
const LANE_REGISTRY_V0 = [
  {
    room: "JOA",
    source_room: "JOA",
    active_lane: "joa-dev",
    profile: "joa",
    lane_status: "active",
    readiness_category: "Active now",
    launch_ready: true,
    parallel_slot: 1,
    note: "Station 1 JOA worker loop — primary TimOS-Agent lane (slot 1 in use)",
  },
  {
    room: "NovaBridge (NB)",
    source_room: "NovaBridge",
    active_lane: "nova-dev",
    profile: "nova",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: 2,
    note: "NovaUniverse workspace — smoke test + nova hub before first job",
  },
  {
    room: "Finance / JFA",
    source_room: "JFA",
    active_lane: "finance-dev",
    profile: "finance",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: 3,
    note: "TimFinance workspace — start finance hub + smoke test",
  },
  {
    room: "SpaceA",
    source_room: "SpaceA",
    active_lane: "spacea-bridge",
    profile: "spacea",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: null,
    note: "Per-job repo_ref and workspace_ref; spacea hub required",
  },
  {
    room: "MinistryOps",
    source_room: "MinistryOps",
    active_lane: "ministry-bridge",
    profile: "ministry",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: null,
    note: "Per-job repo_ref and workspace_ref; ministry hub required",
  },
  {
    room: "GSync (direct dev)",
    source_room: "GSync",
    active_lane: "gsync-dev",
    profile: "gsync",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: null,
    note: "juos-knowledge-vault; writes gsync/** only — inspect_only first",
  },
  {
    room: "GSync / JuCore",
    source_room: "GSync",
    active_lane: "gsync-registry",
    profile: "jucore",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: null,
    note: "JuCore scaffold; jucore jobs when JuCore hub is running",
  },
  {
    room: "Station 4 / 5",
    source_room: null,
    active_lane: null,
    profile: "joa",
    lane_status: "bootstrap_pending",
    readiness_category: "Pending setup",
    launch_ready: false,
    parallel_slot: null,
    note: "JOA always-on host bootstrap — moves loop off Station 1",
  },
  {
    room: "JUB",
    source_room: "JUB",
    active_lane: "jub-coordination",
    profile: null,
    lane_status: "blocked",
    readiness_category: "Blocked",
    launch_ready: false,
    parallel_slot: null,
    note: "GSync publish/consume only until OB auth resolved",
  },
  {
    room: "JEX",
    source_room: "JEX",
    active_lane: "jex-handoff",
    profile: null,
    lane_status: "pending",
    readiness_category: "Pending setup",
    launch_ready: false,
    parallel_slot: null,
    note: "GSync handoff only; no worker profile in v0",
  },
];

const PARALLEL_CAPACITY_V0 = {
  active_lane_count: LANE_REGISTRY_V0.filter(
    (lane) => lane.readiness_category === "Active now"
  ).length,
  safe_target_min: 2,
  safe_target_max: 3,
  slots_available: Math.max(
    0,
    2 -
      LANE_REGISTRY_V0.filter((lane) => lane.readiness_category === "Active now")
        .length
  ),
  next_candidate: "NovaBridge (NB)",
  unsafe_pattern:
    "Multiple workers writing the same repo/workspace without locks or queueing",
};

function jobsFromSummary(summary) {
  const seen = new Set();
  const jobs = [];
  for (const items of Object.values(summary.buckets || {})) {
    for (const item of items) {
      if (!item?.job?.id || seen.has(item.job.id)) {
        continue;
      }
      seen.add(item.job.id);
      jobs.push(item.job);
    }
  }
  return jobs;
}

function deriveRunningMotionState(row, nowMs = Date.now()) {
  if (row?.running_too_long) {
    return "stalled";
  }
  const updatedAt = row?.job_updated_at || row?.at;
  if (updatedAt) {
    const staleMinutes = ageMinutesSince(updatedAt, nowMs);
    if (staleMinutes != null && staleMinutes >= RUNNING_STALE_UPDATE_MINUTES) {
      return "possibly_stale";
    }
  }
  return "active";
}

function buildRunningStatusMeta(row, nowMs = Date.now()) {
  const parts = [];
  const claimedAt = row?.job_claimed_at || row?.at;
  if (claimedAt) {
    const elapsed = formatAge(claimedAt);
    if (elapsed) {
      parts.push(elapsed);
    }
  }
  const updatedAt = row?.job_updated_at;
  if (updatedAt) {
    const refreshAge = formatAge(updatedAt);
    if (refreshAge) {
      parts.push(`refresh ${refreshAge} ago`);
    }
  }
  const motionState = deriveRunningMotionState(row, nowMs);
  if (motionState === "stalled") {
    parts.push("running long");
  } else if (motionState === "possibly_stale") {
    parts.push("possibly stalled");
  }
  return parts;
}

function renderLiveRunningStatusCell(row, nowMs = Date.now()) {
  const motionState = deriveRunningMotionState(row, nowMs);
  const label = escapeHtml(row.status_label || row.hint || "Running · live");
  const metaParts = buildRunningStatusMeta(row, nowMs);
  const metaHtml =
    metaParts.length > 0
      ? `<span class="tower-running-meta muted">${escapeHtml(metaParts.join(" · "))}</span>`
      : "";
  const staleNote =
    motionState === "stalled"
      ? '<span class="tower-stale-warn">Running long</span>'
      : motionState === "possibly_stale"
        ? '<span class="tower-stale-warn tower-stale-warn-soft">Possibly stalled</span>'
        : "";

  return `<span class="tower-running-status tower-running-motion-${escapeHtml(motionState)}" role="status">
    <span class="tower-live-dot" aria-hidden="true"></span>
    <span class="batch-status-label">${label}</span>
    ${metaHtml}${staleNote}
  </span>`;
}

function truncateText(text, maxLen = 120) {
  const value = String(text || "");
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen - 1)}…`;
}

function formatLogTimestamp(iso) {
  if (!iso) {
    return "—";
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return String(iso);
  }
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 19);
}

function inferCreatedAt(job) {
  if (job.created_at) {
    return job.created_at;
  }
  return job.approved_at || job.claimed_at || job.completed_at || job.updated_at || null;
}

function buildJobActivityEvents(rawJob) {
  const job = normalizeJob(rawJob);
  if (!job) {
    return [];
  }

  const events = [];
  const profile = job.target_worker_profile || "unknown";
  const repo = job.repo_ref ? ` · ${job.repo_ref}` : "";
  const workspace = job.workspace_ref
    ? ` · ${truncateText(String(job.workspace_ref), 48)}`
    : "";
  const requestedBy = job.requested_by || "system";
  const title = jobTitle(job);
  const createdAt = inferCreatedAt(job);

  if (createdAt) {
    events.push({
      at: createdAt,
      kind: "created",
      text: `${requestedBy} created job ${job.id} for ${profile}${repo}`,
      job_id: job.id,
    });
  }

  if (job.approval_required) {
    const approvalStatus = String(job.approval_status || "").toLowerCase();
    if (approvalStatus !== "approved") {
      events.push({
        at: createdAt || job.updated_at,
        kind: "pending_approval",
        text: `Job ${job.id} pending Tim approval · ${title}`,
        job_id: job.id,
      });
    }
  }

  if (job.approved_at) {
    events.push({
      at: job.approved_at,
      kind: "approved",
      text: `Tim approved job ${job.id} for ${profile}${job.approved_by ? ` (${job.approved_by})` : ""}`,
      job_id: job.id,
    });
  }

  if (job.claimed_at) {
    events.push({
      at: job.claimed_at,
      kind: "claimed",
      text: `Job ${job.id} claimed · ${job.claimed_by || profile} running${workspace}`,
      job_id: job.id,
    });
  }

  if (job.status === "completed") {
    const at = job.completed_at || job.updated_at || job.claimed_at;
    const resultHint = job.result?.summary
      ? ` · ${truncateText(String(job.result.summary), 72)}`
      : "";
    events.push({
      at,
      kind: "completed",
      text: `Job ${job.id} completed · ${profile}${resultHint}`,
      job_id: job.id,
    });
  }

  if (job.status === "failed" || job.status === "cancelled") {
    const err =
      job.errors.length > 0
        ? truncateText(job.errors.join("; "), 96)
        : job.status;
    events.push({
      at: job.completed_at || job.updated_at || createdAt,
      kind: "failed",
      text: `Job ${job.id} ${job.status} · ${profile} · ${err}`,
      job_id: job.id,
    });
  }

  return events.filter((event) => event.at);
}

function jobNeedsExplicitReview(job) {
  if (!job) {
    return false;
  }
  return (
    job.needs_review === true ||
    job.result?.needs_review === true ||
    job.result?.review_required === true
  );
}

function getReviewWatchItems(timeSummary) {
  return (
    timeSummary?.watchlist?.buckets[
      WATCHLIST_CATEGORIES.COMPLETED_NEEDS_ASSISTANT_REVIEW
    ] || []
  );
}

function splitReviewWatchItems(reviewItems, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const urgentMaxAge =
    options.review_urgent_max_age_minutes ?? REVIEW_URGENT_MAX_AGE_MINUTES;
  const urgent = [];
  const historical = [];

  for (const item of reviewItems) {
    const job = item.classified?.job || item.job;
    const completedAt = job?.completed_at || job?.updated_at;
    const ageMinutes =
      item.age_minutes ??
      (completedAt ? ageMinutesSince(completedAt, nowMs) : null);

    if (
      jobNeedsExplicitReview(job) ||
      (ageMinutes != null && ageMinutes <= urgentMaxAge)
    ) {
      urgent.push(item);
    } else {
      historical.push(item);
    }
  }

  const sortedHistorical = [...historical].sort((a, b) => {
    const aJob = a.classified?.job || a.job;
    const bJob = b.classified?.job || b.job;
    const aAt = Date.parse(aJob?.completed_at || aJob?.updated_at || "") || 0;
    const bAt = Date.parse(bJob?.completed_at || bJob?.updated_at || "") || 0;
    return bAt - aAt;
  });

  return {
    urgent,
    historical: sortedHistorical.slice(0, REVIEW_HISTORY_MAX_ITEMS),
    totalHistorical: historical.length,
  };
}

function deriveActionableAttention(summary, timeSummary, reviewSplit) {
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;
  const stranded = summary.stranded_count || 0;
  const failed = summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length;
  const runningTooLong =
    timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG]
      ?.length || 0;
  const urgentReview = reviewSplit?.urgent?.length || 0;

  return {
    count: awaiting + stranded + failed + runningTooLong + urgentReview,
    awaiting,
    stranded,
    failed,
    runningTooLong,
    urgentReview,
    reviewHistoryCount: reviewSplit?.totalHistorical || 0,
    reviewHistoryShown: reviewSplit?.historical?.length || 0,
    totalReviewCount:
      (reviewSplit?.urgent?.length || 0) + (reviewSplit?.totalHistorical || 0),
  };
}

const TOWER_EXECUTION_LABELS = {
  RUNNING: "Running",
  NO_WORKER: "No worker running",
  WAITING_TIM: "Waiting for Tim",
  FAILED: "Failed",
  ALL_DONE: "All done",
};

function pickLastCompletedContext(batchRows, completedJobs) {
  const fromRows = (batchRows || [])
    .filter((row) => row.batch_state === BATCH_STATES.COMPLETED)
    .sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""));
  if (fromRows.length > 0) {
    const row = fromRows[0];
    return {
      id: row.id,
      title: row.plan,
      at: row.at,
      at_display: row.at ? formatLogTimestamp(row.at) : null,
    };
  }
  const fromJobs = (completedJobs || [])
    .map((item) => item.job)
    .filter((job) => job?.id)
    .sort(
      (a, b) =>
        Date.parse(b.completed_at || b.updated_at || "") -
        Date.parse(a.completed_at || a.updated_at || "")
    );
  if (fromJobs.length > 0) {
    const job = fromJobs[0];
    return {
      id: job.id,
      title: jobTitle(job),
      at: job.completed_at || job.updated_at,
      at_display: formatLogTimestamp(job.completed_at || job.updated_at),
    };
  }
  return null;
}

function pickNextPendingContext(batchRows, summary) {
  const pendingRow = (batchRows || []).find(
    (row) =>
      row.batch_state === BATCH_STATES.PENDING ||
      row.batch_state === BATCH_STATES.FUTURE
  );
  if (pendingRow) {
    return {
      id: pendingRow.id !== "—" ? pendingRow.id : null,
      title: pendingRow.plan,
      profile: pendingRow.profile,
    };
  }
  const stranded = summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED][0]?.job;
  if (stranded) {
    return {
      id: stranded.id,
      title: jobTitle(stranded),
      profile: stranded.target_worker_profile,
    };
  }
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL][0]?.job;
  if (awaiting) {
    return {
      id: awaiting.id,
      title: jobTitle(awaiting),
      profile: awaiting.target_worker_profile,
    };
  }
  return null;
}

function deriveTowerExecutionHeader(summary, timeSummary, queueContext, options = {}) {
  const reviewSplit =
    options.reviewSplit ||
    splitReviewWatchItems(getReviewWatchItems(timeSummary), {
      nowMs: options.nowMs,
    });
  const batchRows = queueContext?.batch_rows || [];
  const liveOnlyRows = queueContext?.live_only_rows || [];
  const runningJobs = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING];
  const awaiting = summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL];
  const failed = summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED];
  const stranded = summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED];
  const runningTooLong =
    timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG]
      ?.length || 0;

  const greenRowCount = [...batchRows, ...liveOnlyRows].filter(
    (row) =>
      row.batch_state === BATCH_STATES.RUNNING && row.live_linked === true
  ).length;
  const liveOnlyRowCount = queueContext?.live_only_row_count ?? 0;
  const lastCompleted = pickLastCompletedContext(
    batchRows,
    summary.buckets[STATUS_CATEGORIES.COMPLETED]
  );
  const nextPending = pickNextPendingContext(batchRows, summary);
  const manifestItemCount =
    queueContext?.manifest_item_count ?? batchRows.length ?? null;
  const refreshedAt =
    queueContext?.generated_at || options.generated_at || new Date().toISOString();

  const base = {
    last_completed: lastCompleted,
    next_pending: nextPending,
    manifest_item_count: manifestItemCount,
    live_only_row_count: liveOnlyRowCount,
    green_row_count: greenRowCount,
    refreshed_at: refreshedAt,
    refreshed_at_display: formatLogTimestamp(refreshedAt),
  };

  if (runningJobs.length > 0) {
    const job = runningJobs[0].job;
    const elapsed = job.claimed_at ? formatAge(job.claimed_at) : null;
    const lastRefresh = job.updated_at ? formatAge(job.updated_at) : null;
    const worker = job.claimed_by || job.target_worker_profile || "worker";
    const runningTooLongForJob = (runningTooLong > 0 &&
      (timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG] || [])
        .some((item) => (item.classified || item)?.job?.id === job.id)) ||
      false;
    const motionState = deriveRunningMotionState(
      {
        running_too_long: runningTooLongForJob,
        job_updated_at: job.updated_at || job.claimed_at,
        job_claimed_at: job.claimed_at,
        at: job.claimed_at,
      },
      options.nowMs
    );
    const detailParts = [
      jobTitle(job),
      job.id,
      job.target_worker_profile || "—",
      worker,
    ];
    if (elapsed) {
      detailParts.push(elapsed);
    }
    if (lastRefresh) {
      detailParts.push(`last refresh ${lastRefresh} ago`);
    }
    if (motionState === "stalled") {
      detailParts.push("running long — check worker");
    } else if (motionState === "possibly_stale") {
      detailParts.push("possibly stalled — no recent job update");
    }
    return {
      ...base,
      label: TOWER_EXECUTION_LABELS.RUNNING,
      tone: "running",
      detail: detailParts.join(" · "),
      running_motion_state: motionState,
      running_job: {
        id: job.id,
        title: jobTitle(job),
        profile: job.target_worker_profile,
        claimed_by: job.claimed_by,
        elapsed,
        last_refresh: lastRefresh,
        motion_state: motionState,
      },
    };
  }

  const needsTimApproval = awaiting.length > 0;
  const needsTimRows = batchRows.filter(
    (row) =>
      row.tim_action_needed &&
      row.batch_state !== BATCH_STATES.FAILED &&
      row.batch_state !== BATCH_STATES.COMPLETED
  );
  const needsTimReview = reviewSplit.urgent.length > 0;
  if (needsTimApproval || needsTimRows.length > 0 || needsTimReview || runningTooLong > 0) {
    const detailParts = [];
    if (needsTimApproval) {
      detailParts.push(`${awaiting.length} awaiting approval`);
    }
    if (needsTimRows.length > 0) {
      detailParts.push(`${needsTimRows.length} manifest row(s) need Tim action`);
    }
    if (needsTimReview) {
      detailParts.push(`${reviewSplit.urgent.length} recent completion(s) need review`);
    }
    if (runningTooLong > 0) {
      detailParts.push(`${runningTooLong} job(s) running longer than expected`);
    }
    if (greenRowCount === 0) {
      detailParts.push("no green rows — no live worker running");
    }
    return {
      ...base,
      label: TOWER_EXECUTION_LABELS.WAITING_TIM,
      tone: "waiting",
      detail: detailParts.join(" · "),
    };
  }

  if (failed.length > 0) {
    const job = failed[0].job;
    return {
      ...base,
      label: TOWER_EXECUTION_LABELS.FAILED,
      tone: "failed",
      detail: `${failed.length} failed/blocked · ${jobTitle(job)} · ${job.id}`,
    };
  }

  const activeRows = batchRows.filter(
    (row) => row.batch_state !== BATCH_STATES.COMPLETED
  );
  const hasQueuedWork =
    stranded.length > 0 ||
    activeRows.some(
      (row) =>
        row.batch_state === BATCH_STATES.PENDING ||
        row.batch_state === BATCH_STATES.FUTURE
    );

  if (
    activeRows.length === 0 &&
    batchRows.length > 0 &&
    !hasQueuedWork &&
    greenRowCount === 0
  ) {
    return {
      ...base,
      label: TOWER_EXECUTION_LABELS.ALL_DONE,
      tone: "done",
      detail: `Manifest batch complete · ${batchRows.length} item(s) · no green rows`,
    };
  }

  if (hasQueuedWork || stranded.length > 0 || activeRows.length > 0) {
    const detailParts = [];
    if (stranded.length > 0) {
      detailParts.push(
        `${stranded.length} approved job(s) waiting for worker claim`
      );
    } else if (activeRows.length > 0) {
      detailParts.push(`${activeRows.length} planned/queued manifest row(s)`);
    } else {
      detailParts.push("approved/planned work queued");
    }
    detailParts.push("no live worker running");
    if (greenRowCount === 0) {
      detailParts.push("0 green rows (expected when idle)");
    }
    return {
      ...base,
      label: TOWER_EXECUTION_LABELS.NO_WORKER,
      tone: "idle",
      detail: detailParts.join(" · "),
    };
  }

  return {
    ...base,
    label: TOWER_EXECUTION_LABELS.NO_WORKER,
    tone: "idle",
    detail:
      greenRowCount === 0
        ? "No live worker running · 0 green rows · no approvals pending"
        : "No live worker running · no approvals pending",
  };
}

function deriveTowerStateLine(summary, timeSummary, motionState, reviewSplit) {
  const running = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].length;
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;
  const stranded = summary.stranded_count || 0;
  const failed = summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length;
  const actionable = deriveActionableAttention(summary, timeSummary, reviewSplit);
  const reviewHistoryCount = reviewSplit?.totalHistorical || 0;
  const urgentReview = reviewSplit?.urgent?.length || 0;

  if (running > 0) {
    const job = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING][0].job;
    return {
      state: "Working",
      detail: `${running} running · ${job.claimed_by || job.target_worker_profile || "worker"} on ${jobTitle(job)}`,
    };
  }
  if (awaiting > 0) {
    return {
      state: "Needs Tim",
      detail: `${awaiting} job(s) awaiting approval · no workers running`,
    };
  }
  if (failed > 0) {
    return {
      state: "Blocked",
      detail: `${failed} failed/blocked job(s) need review`,
    };
  }
  if (stranded > 0) {
    return {
      state: "Waiting",
      detail: `${stranded} approved job(s) waiting for worker claim · no workers running`,
    };
  }
  if (actionable.runningTooLong > 0) {
    return {
      state: "Needs Tim",
      detail: `${actionable.runningTooLong} job(s) running longer than expected`,
    };
  }
  if (urgentReview > 0) {
    return {
      state: "Needs Tim",
      detail: `${urgentReview} recently completed job(s) need review`,
    };
  }
  if (motionState === "needs_attention") {
    return {
      state: "Waiting",
      detail: "Approved work queued — worker loop may be idle",
    };
  }
  if (reviewHistoryCount > 0) {
    return {
      state: "Idle",
      detail: `Review history available · ${reviewHistoryCount} older completed job(s) — not blockers · no workers running · no approvals pending`,
    };
  }
  return {
    state: "Idle",
    detail:
      "No workers running · no approved jobs waiting · no approvals pending",
  };
}

function deriveTimActionItems(summary, timeSummary, reviewSplit) {
  const items = [];

  for (const item of summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL]) {
    const job = item.job;
    items.push({
      at: job.created_at || job.updated_at,
      kind: "tim_action",
      text: `Tim action required: approve job ${job.id} · ${jobTitle(job)}`,
      job_id: job.id,
    });
  }

  for (const item of summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED]) {
    const job = item.job;
    items.push({
      at: job.approved_at || job.updated_at || job.created_at,
      kind: "tim_action",
      text: `Tim action required: start ${job.target_worker_profile || "worker"} worker loop for stranded job ${job.id}`,
      job_id: job.id,
    });
  }

  for (const item of summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED]) {
    const job = item.job;
    items.push({
      at: job.updated_at || job.completed_at || job.created_at,
      kind: "tim_action",
      text: `Tim action required: resolve blocked job ${job.id} · ${truncateText(job.errors.join("; ") || item.reason || "blocked", 72)}`,
      job_id: job.id,
    });
  }

  const urgentReviewItems = reviewSplit
    ? reviewSplit.urgent
    : splitReviewWatchItems(getReviewWatchItems(timeSummary)).urgent;
  for (const item of urgentReviewItems) {
    const job = item.classified?.job || item.job;
    if (!job?.id) {
      continue;
    }
    items.push({
      at: job.completed_at || job.updated_at,
      kind: "tim_action",
      text: `Tim action required: review completed job ${job.id} · ${jobTitle(job)}`,
      job_id: job.id,
    });
  }

  return items.filter((entry) => entry.at);
}

const BATCH_STATES = {
  COMPLETED: "completed",
  RUNNING: "running",
  PENDING: "pending",
  FAILED: "failed",
  FUTURE: "future",
};

function jobPurpose(job) {
  if (!job) {
    return null;
  }
  if (
    job.approval_summary &&
    job.plan_summary &&
    job.approval_summary !== job.plan_summary
  ) {
    return truncateText(job.approval_summary, 120);
  }
  if (job.prompt) {
    const lines = String(job.prompt)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      return truncateText(lines.slice(1, 3).join(" · "), 120);
    }
  }
  if (job.task_type) {
    return job.task_type.replace(/_/g, " ");
  }
  return null;
}

function formatBatchTaskEntry(classified, options = {}) {
  const job = classified?.job || classified;
  if (!job?.id) {
    return null;
  }
  const statusLabel =
    options.status_label ||
    options.hint ||
    (job.status === "claimed"
      ? "running"
      : job.status === "pending"
        ? classified?.reason || "pending"
        : job.status);
  return {
    id: job.id,
    profile: job.target_worker_profile || "—",
    repo: job.repo_ref || "—",
    plan: jobTitle(job),
    purpose: jobPurpose(job) || "—",
    status: job.status || "—",
    status_label: statusLabel,
    batch_state: options.batch_state || BATCH_STATES.PENDING,
    tim_action_needed: options.tim_action_needed === true,
    hint: options.hint || statusLabel,
    at: job.claimed_at || job.approved_at || job.completed_at || job.updated_at || job.created_at,
  };
}

function formatQueueJobEntry(classified, hint) {
  const job = classified?.job || classified;
  if (!job?.id) {
    return null;
  }
  const statusHint =
    hint ||
    (job.status === "claimed"
      ? "running"
      : job.status === "pending"
        ? classified?.reason || "pending"
        : job.status);
  return {
    id: job.id,
    profile: job.target_worker_profile || "—",
    repo: job.repo_ref || "—",
    plan: jobTitle(job),
    purpose: jobPurpose(job) || "—",
    status: job.status || "—",
    status_label: statusHint,
    hint: statusHint,
    at: job.claimed_at || job.approved_at || job.completed_at || job.updated_at || job.created_at,
  };
}

function dedupeBatchEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry?.id || seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

function sortQueueEntriesByAt(entries, direction = "asc") {
  const factor = direction === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const aAt = Date.parse(a.at || "") || 0;
    const bAt = Date.parse(b.at || "") || 0;
    if (aAt !== bAt) {
      return (aAt - bAt) * factor;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

function buildCurrentQueueFromManifest(manifest, summary, timeSummary, motionState, options = {}) {
  const reviewSplit = splitReviewWatchItems(getReviewWatchItems(timeSummary), {
    nowMs: options.nowMs,
  });
  const actionable = deriveActionableAttention(summary, timeSummary, reviewSplit);
  const stateLine = deriveTowerStateLine(
    summary,
    timeSummary,
    motionState,
    reviewSplit
  );

  const jobIndex = buildJobIndex(summary, options.jobs);
  const runningTooLongIds = new Set(
    (timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG] || [])
      .map((item) => (item.classified || item)?.job?.id)
      .filter(Boolean)
  );
  const urgentReviewIds = new Set(
    reviewSplit.urgent
      .map((item) => (item.classified || item)?.job?.id)
      .filter(Boolean)
  );
  const firstStrandedJobId =
    summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED][0]?.job?.id || null;

  const resolveContext = {
    jobIndex,
    runningTooLongIds,
    urgentReviewIds,
    firstStrandedJobId,
    formatBatchTaskEntry,
    jobTitleFn: jobTitle,
    BATCH_STATES,
  };

  const batchRows = sortManifestItems(manifest.items)
    .map((item) => resolveManifestItemRow(item, resolveContext))
    .filter(Boolean);

  const liveOnlyRows = buildUnmatchedLiveJobRows(
    manifest,
    jobIndex,
    resolveContext,
    { nowMs: options.nowMs }
  );
  const allDisplayRows = [...liveOnlyRows, ...batchRows];

  const completedItems = batchRows.filter(
    (row) => row.batch_state === BATCH_STATES.COMPLETED
  );
  const runningItems = batchRows.filter(
    (row) => row.batch_state === BATCH_STATES.RUNNING
  );
  const failedItems = batchRows.filter(
    (row) => row.batch_state === BATCH_STATES.FAILED
  );
  const futureItems = batchRows.filter(
    (row) => row.batch_state === BATCH_STATES.FUTURE
  );
  const immediatePending = batchRows.filter(
    (row) =>
      row.batch_state === BATCH_STATES.PENDING && row.tim_action_needed
  );
  const passivePending = batchRows.filter(
    (row) =>
      row.batch_state === BATCH_STATES.PENDING && !row.tim_action_needed
  );

  const batchSections = [
    { state: BATCH_STATES.COMPLETED, label: "Completed", items: completedItems },
    { state: BATCH_STATES.RUNNING, label: "Now running", items: runningItems },
    {
      state: BATCH_STATES.PENDING,
      label: "Next up / Pending",
      items: [...immediatePending, ...passivePending],
    },
    { state: BATCH_STATES.FAILED, label: "Failed / Blocked", items: failedItems },
    { state: BATCH_STATES.FUTURE, label: "Future / Queued", items: futureItems },
  ];

  const reviewHistory = sortQueueEntriesByAt(
    reviewSplit.historical
      .map((item) => {
        const classified = item.classified || item;
        return formatQueueJobEntry(classified, "review history · not a blocker");
      })
      .filter(Boolean),
    "desc"
  );

  const batchName = manifest.batch_name || "current batch";
  const manifestPath = options.manifestPath || MANIFEST_FILE;
  const manifestPathLabel = manifestPath.includes("config")
    ? manifestPath.replace(/^.*[/\\]config[/\\]/, "config/")
    : "config/tower-current-batch.json";
  const manifestNotes = manifest.notes
    ? String(manifest.notes)
    : "Current batch manifest — all items listed in order; no fixed row limit.";

  const activeCount = batchRows.filter(
    (row) => row.batch_state !== BATCH_STATES.COMPLETED
  ).length;

  let idleMessage = null;
  if (activeCount === 0 && completedItems.length > 0 && liveOnlyRows.length === 0) {
    idleMessage = "Manifest batch complete — no active rows";
  }

  const queueDraft = {
    batch_rows: allDisplayRows,
    live_only_row_count: liveOnlyRows.length,
    manifest_item_count: batchRows.length,
    generated_at: options.generated_at || new Date().toISOString(),
  };
  const executionHeader = deriveTowerExecutionHeader(
    summary,
    timeSummary,
    queueDraft,
    { nowMs: options.nowMs, reviewSplit }
  );

  const liveRunningItems = liveOnlyRows.filter(
    (row) => row.batch_state === BATCH_STATES.RUNNING && row.live_linked
  );

  return {
    source: "explicit_manifest",
    label: "Tower Current Batch",
    note: `${manifestNotes} · ${manifestPathLabel}`,
    manifest_batch_name: batchName,
    manifest_path: manifestPathLabel,
    manifest_item_count: batchRows.length,
    live_only_rows: liveOnlyRows,
    live_only_row_count: liveOnlyRows.length,
    generated_at: options.generated_at || new Date().toISOString(),
    current_state: stateLine.state,
    current_state_detail: stateLine.detail,
    execution_header: executionHeader,
    batch_rows: batchRows,
    display_rows: allDisplayRows,
    batch_sections: batchSections,
    now_running: [...liveRunningItems, ...runningItems],
    needs_tim: batchRows.filter((row) => row.tim_action_needed),
    next_up: batchRows.filter(
      (row) =>
        row.batch_state === BATCH_STATES.PENDING ||
        row.batch_state === BATCH_STATES.FUTURE ||
        row.batch_state === BATCH_STATES.RUNNING
    ),
    recently_completed: completedItems,
    review_history: reviewHistory,
    review_history_total: reviewSplit.totalHistorical,
    actionable_attention_count: actionable.count,
    idle_message: idleMessage,
  };
}

function buildCurrentQueue(summary, timeSummary, motionState, options = {}) {
  const manifest =
    options.manifest !== undefined
      ? options.manifest
      : loadTowerCurrentBatchManifest({ manifestPath: options.manifestPath });
  if (manifest?.items?.length > 0) {
    return buildCurrentQueueFromManifest(
      manifest,
      summary,
      timeSummary,
      motionState,
      options
    );
  }

  const maxRecent = options.max_recent ?? 5;
  const reviewSplit = splitReviewWatchItems(getReviewWatchItems(timeSummary), {
    nowMs: options.nowMs,
  });
  const actionable = deriveActionableAttention(summary, timeSummary, reviewSplit);
  const stateLine = deriveTowerStateLine(
    summary,
    timeSummary,
    motionState,
    reviewSplit
  );

  const completedItems = dedupeBatchEntries(
    sortQueueEntriesByAt(
      summary.buckets[STATUS_CATEGORIES.COMPLETED].map((item) => {
        const hint = item.job.result?.summary
          ? truncateText(String(item.job.result.summary), 72)
          : "completed";
        return formatBatchTaskEntry(item, {
          batch_state: BATCH_STATES.COMPLETED,
          status_label: hint,
          hint,
          tim_action_needed: false,
        });
      }).filter(Boolean),
      "desc"
    ).slice(0, maxRecent)
  );

  const runningItems = dedupeBatchEntries(
    summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING]
      .map((item) =>
        formatBatchTaskEntry(item, {
          batch_state: BATCH_STATES.RUNNING,
          status_label: item.job.claimed_by
            ? `Ongoing · ${item.job.claimed_by} · live`
            : "Ongoing · live",
          hint: item.job.claimed_by
            ? `claimed by ${item.job.claimed_by}`
            : "running",
          tim_action_needed: false,
        })
      )
      .filter(Boolean)
  );

  const runningTooLongIds = new Set(
    (timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG] || [])
      .map((item) => (item.classified || item)?.job?.id)
      .filter(Boolean)
  );
  for (const item of runningItems) {
    if (runningTooLongIds.has(item.id)) {
      item.status_label = "Running long · live";
      item.hint = "running longer than expected";
      item.tim_action_needed = true;
      item.running_too_long = true;
    }
    const job = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].find(
      (entry) => entry.job?.id === item.id
    )?.job;
    if (job) {
      item.job_claimed_at = job.claimed_at || null;
      item.job_updated_at = job.updated_at || job.claimed_at || null;
      item.live_linked = true;
    }
  }

  const runningIds = new Set(runningItems.map((item) => item.id));
  const failedIds = new Set(
    summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED]
      .map((item) => item.job?.id)
      .filter(Boolean)
  );

  const pendingItems = dedupeBatchEntries(
    sortQueueEntriesByAt(
      [
        ...summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].map((item) =>
          formatBatchTaskEntry(item, {
            batch_state: BATCH_STATES.PENDING,
            status_label: "awaiting Tim approval",
            hint: "awaiting Tim approval",
            tim_action_needed: true,
          })
        ),
        ...summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED].map((item) =>
          formatBatchTaskEntry(item, {
            batch_state: BATCH_STATES.PENDING,
            status_label: "approved · waiting for worker claim",
            hint: `start ${item.job.target_worker_profile || "worker"} loop to claim`,
            tim_action_needed: true,
          })
        ),
        ...(timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG] || []).map(
          (item) => {
            const classified = item.classified || item;
            return formatBatchTaskEntry(classified, {
              batch_state: BATCH_STATES.PENDING,
              status_label: "running longer than expected",
              hint: "running longer than expected",
              tim_action_needed: true,
            });
          }
        ),
        ...reviewSplit.urgent.map((item) => {
          const classified = item.classified || item;
          return formatBatchTaskEntry(classified, {
            batch_state: BATCH_STATES.PENDING,
            status_label: "review completed result · recent",
            hint: "review completed result · recent",
            tim_action_needed: true,
          });
        }),
      ].filter(Boolean)
    ).filter((item) => !runningIds.has(item.id) && !failedIds.has(item.id))
  );

  const failedItems = dedupeBatchEntries(
    summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].map((item) => {
      const err = item.job.errors?.length
        ? truncateText(item.job.errors.join("; "), 72)
        : item.reason || "blocked";
      return formatBatchTaskEntry(item, {
        batch_state: BATCH_STATES.FAILED,
        status_label: err,
        hint: `resolve: ${err}`,
        tim_action_needed: true,
      });
    }).filter(Boolean)
  );

  const strandedWaiters = pendingItems.filter((item) =>
    String(item.status_label || "").includes("waiting for worker claim")
  );
  const immediatePending = pendingItems.filter(
    (item) => !String(item.status_label || "").includes("waiting for worker claim")
  );
  const futureItems = strandedWaiters.slice(1).map((item) => ({
    ...item,
    batch_state: BATCH_STATES.FUTURE,
    status_label: "queued · not started",
    hint: "next in queue · waiting for worker claim",
    tim_action_needed: false,
  }));
  if (strandedWaiters[0]) {
    immediatePending.push(strandedWaiters[0]);
  }

  const batchRows = [
    ...completedItems,
    ...runningItems,
    ...immediatePending,
    ...failedItems,
    ...futureItems,
  ];

  const batchSections = [
    {
      state: BATCH_STATES.COMPLETED,
      label: "Completed",
      items: completedItems,
    },
    {
      state: BATCH_STATES.RUNNING,
      label: "Now running",
      items: runningItems,
    },
    {
      state: BATCH_STATES.PENDING,
      label: "Next up / Pending",
      items: immediatePending,
    },
    {
      state: BATCH_STATES.FAILED,
      label: "Failed / Blocked",
      items: failedItems,
    },
    {
      state: BATCH_STATES.FUTURE,
      label: "Future / Queued",
      items: futureItems,
    },
  ];

  const reviewHistory = sortQueueEntriesByAt(
    reviewSplit.historical
      .map((item) => {
        const classified = item.classified || item;
        return formatQueueJobEntry(classified, "review history · not a blocker");
      })
      .filter(Boolean),
    "desc"
  );

  const nowRunning = runningItems;
  const needsTim = [...immediatePending, ...failedItems];
  const nextUp = [...strandedWaiters.slice(0, 1), ...futureItems];
  const recentlyCompleted = completedItems;

  const activeCount =
    runningItems.length +
    immediatePending.length +
    failedItems.length +
    futureItems.length;

  let idleMessage = null;
  if (
    activeCount === 0 &&
    completedItems.length === 0 &&
    reviewSplit.totalHistorical === 0
  ) {
    idleMessage = "No known jobs — idle";
  } else if (activeCount === 0 && actionable.count === 0) {
    idleMessage =
      reviewSplit.totalHistorical > 0
        ? "No workers running · no approvals pending · older review history is in Activity Log only"
        : "No workers running · no approvals pending · no approved jobs waiting";
  }

  const queueDraft = {
    batch_rows: batchRows,
    manifest_item_count: batchRows.length,
    generated_at: options.generated_at || new Date().toISOString(),
  };
  const executionHeader = deriveTowerExecutionHeader(
    summary,
    timeSummary,
    queueDraft,
    { nowMs: options.nowMs, reviewSplit }
  );

  return {
    source: "reconstructed_from_jobs",
    label: "Batch Task Table",
    note: "Reconstructed from recent command-channel jobs · no explicit batch_id / current_batch metadata",
    generated_at: options.generated_at || new Date().toISOString(),
    current_state: stateLine.state,
    current_state_detail: stateLine.detail,
    execution_header: executionHeader,
    batch_rows: batchRows,
    batch_sections: batchSections,
    now_running: nowRunning,
    needs_tim: needsTim,
    next_up: nextUp,
    recently_completed: recentlyCompleted,
    review_history: reviewHistory,
    review_history_total: reviewSplit.totalHistorical,
    actionable_attention_count: actionable.count,
    idle_message: idleMessage,
  };
}

function buildActivityLog(jobs, summary, timeSummary, motionState, options = {}) {
  const reviewSplit = splitReviewWatchItems(getReviewWatchItems(timeSummary), {
    nowMs: options.nowMs,
  });
  const historical = [];
  for (const job of jobs) {
    historical.push(...buildJobActivityEvents(job));
  }

  const timActions = deriveTimActionItems(summary, timeSummary, reviewSplit);
  const seenTimAction = new Set();
  const dedupedTimActions = timActions.filter((entry) => {
    const key = `${entry.job_id}:${entry.text}`;
    if (seenTimAction.has(key)) {
      return false;
    }
    seenTimAction.add(key);
    return true;
  });

  const kindOrder = {
    created: 1,
    pending_approval: 2,
    approved: 3,
    claimed: 4,
    completed: 5,
    failed: 6,
    tim_action: 7,
  };

  const events = [...historical, ...dedupedTimActions].sort((a, b) => {
    const delta = Date.parse(a.at) - Date.parse(b.at);
    if (delta !== 0) {
      return delta;
    }
    return (kindOrder[a.kind] || 99) - (kindOrder[b.kind] || 99);
  });

  const maxEvents = options.max_events ?? 200;
  const trimmed =
    events.length > maxEvents ? events.slice(events.length - maxEvents) : events;

  const stateLine = deriveTowerStateLine(
    summary,
    timeSummary,
    motionState,
    reviewSplit
  );

  return {
    source: "reconstructed_from_jobs",
    generated_at: options.generated_at || new Date().toISOString(),
    current_state: stateLine.state,
    current_state_detail: stateLine.detail,
    event_count: trimmed.length,
    events: trimmed.map((event) => ({
      at: event.at,
      at_display: formatLogTimestamp(event.at),
      kind: event.kind,
      text: event.text,
      job_id: event.job_id || null,
    })),
  };
}

function deriveSystemState(summary, timeSummary, reviewSplit) {
  const split =
    reviewSplit ||
    splitReviewWatchItems(getReviewWatchItems(timeSummary));
  const running = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].length;
  const stranded = summary.stranded_count || 0;
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;
  const failed =
    summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length;
  const runningTooLong =
    timeSummary?.watchlist?.buckets[WATCHLIST_CATEGORIES.RUNNING_TOO_LONG]
      ?.length || 0;

  if (running > 0) {
    return "running";
  }
  if (stranded > 0 || awaiting > 0) {
    return "needs_attention";
  }
  if (failed > 0) {
    return "blocked";
  }
  if (split.urgent.length > 0) {
    return "review_pending";
  }
  if (runningTooLong > 0) {
    return "needs_attention";
  }
  return "idle";
}

function deriveWaitingOn(summary, timeSummary, motionState, reviewSplit) {
  const split =
    reviewSplit ||
    splitReviewWatchItems(getReviewWatchItems(timeSummary));
  const actionable = deriveActionableAttention(summary, timeSummary, split);
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;
  const stranded = summary.stranded_count || 0;
  const running = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].length;

  if (running > 0) {
    const job = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING][0].job;
    return job.claimed_by || job.target_worker_profile || "worker";
  }
  if (awaiting > 0) {
    return "Tim";
  }
  if (stranded > 0) {
    const job = summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED][0]?.job;
    return job?.target_worker_profile
      ? `${job.target_worker_profile} worker loop`
      : "worker loop";
  }
  if (motionState === "review_pending") {
    return "assistant / Tim";
  }
  if (motionState === "blocked") {
    return "Tim + JOA";
  }
  if (actionable.count > 0) {
    return "operator";
  }
  return "none";
}

function deriveCurrentFocus(summary, timeSummary, runningRows, reviewSplit) {
  const split =
    reviewSplit ||
    splitReviewWatchItems(getReviewWatchItems(timeSummary));
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;
  const stranded = summary.stranded_count || 0;

  if (runningRows.length > 0) {
    return runningRows.length === 1
      ? runningRows[0].title
      : `${runningRows.length} jobs running (${runningRows[0].title})`;
  }
  if (awaiting > 0) {
    const job = summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL][0].job;
    return `Awaiting Tim approval: ${jobTitle(job)}`;
  }
  if (stranded > 0) {
    const job = summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED][0].job;
    return `Stranded approved job: ${jobTitle(job)}`;
  }
  const failed = summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length;
  if (failed > 0) {
    return `${failed} failed/blocked job(s) need review`;
  }
  if (split.urgent.length > 0) {
    return `${split.urgent.length} recently completed job(s) need review`;
  }
  if (split.totalHistorical > 0) {
    return `Idle — ${split.totalHistorical} item(s) in review history (not blockers)`;
  }
  return "No workers running · no approvals pending · no approved jobs waiting";
}

function formatLaneReadinessSummary(laneRegistry = LANE_REGISTRY_V0) {
  return laneRegistry
    .map((lane) => {
      const category = lane.readiness_category || lane.lane_status;
      const profile = lane.profile ? ` profile=${lane.profile}` : "";
      return `${lane.room}:${category}${profile}`;
    })
    .join("; ");
}

function buildCompactControlTowerBlock(towerModel) {
  const motion = towerModel.motion;
  return {
    now: towerModel.generated_at,
    swept_at: towerModel.swept_at,
    motion_state: motion.system_state,
    active_job_count: motion.running_count,
    pending_approval_count: motion.awaiting_approval_count,
    pending_or_stranded_count: motion.pending_or_stranded_count,
    completed_needs_review_count: motion.completed_needs_review_count,
    review_history_count: motion.review_history_count,
    actionable_attention_count: motion.actionable_attention_count,
    failed_count: motion.failed_count,
    current_focus: towerModel.current_focus,
    waiting_on: towerModel.waiting_on,
    next_action_owner: towerModel.next_up.owner,
    next_action_text: towerModel.next_up.action,
    lane_readiness_summary: towerModel.lane_readiness_summary,
  };
}

function deriveNextUp(summary) {
  const awaiting = summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL];
  if (awaiting.length > 0) {
    const job = awaiting[0].job;
    return {
      owner: "Tim",
      action: "Approve job",
      job_id: job.id,
      title: jobTitle(job),
      profile: job.target_worker_profile,
    };
  }

  const stranded = summary.buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED];
  if (stranded.length > 0) {
    const job = stranded[0].job;
    return {
      owner: `${job.target_worker_profile || "worker"} loop`,
      action: "Claim next approved job",
      job_id: job.id,
      title: jobTitle(job),
      profile: job.target_worker_profile,
    };
  }

  const running = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING];
  if (running.length > 0) {
    const job = running[0].job;
    return {
      owner: job.claimed_by || job.target_worker_profile || "worker",
      action: "Finish in-progress job",
      job_id: job.id,
      title: jobTitle(job),
      profile: job.target_worker_profile,
    };
  }

  return {
    owner: "none",
    action: "No queued work",
    job_id: null,
    title: null,
    profile: null,
  };
}

function summarizeLanes(summary) {
  const lanes = new Map();

  for (const items of Object.values(summary.buckets)) {
    for (const item of items) {
      const profile = item.job?.target_worker_profile || "unknown";
      if (!lanes.has(profile)) {
        lanes.set(profile, {
          profile,
          stranded: 0,
          running: 0,
          completed: 0,
          failed: 0,
          awaiting_approval: 0,
        });
      }
      const lane = lanes.get(profile);
      switch (item.category || item.classified?.category) {
        case STATUS_CATEGORIES.PENDING_UNCLAIMED:
          lane.stranded += 1;
          break;
        case STATUS_CATEGORIES.CLAIMED_RUNNING:
          lane.running += 1;
          break;
        case STATUS_CATEGORIES.COMPLETED:
          lane.completed += 1;
          break;
        case STATUS_CATEGORIES.FAILED_OR_BLOCKED:
          lane.failed += 1;
          break;
        case STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL:
          lane.awaiting_approval += 1;
          break;
        default:
          break;
      }
    }
  }

  return [...lanes.values()].sort((a, b) => a.profile.localeCompare(b.profile));
}

function liveAccessLabel(access) {
  if (access === "local_loopback") {
    return "local browser (127.0.0.1)";
  }
  return "authenticated read-only";
}

function buildWatchSummary(jobs, options = {}) {
  const summary = options.summary || summarizeJobs(jobs);
  const timeSummary = summarizeTimeSweep(jobs, options.timeSweepOptions);
  return {
    data_mode: options.data_mode || "live",
    live_access: options.live_access,
    backend: options.backend || { backend: "unknown" },
    generated_at: options.generated_at || new Date().toISOString(),
    summary,
    time_summary: timeSummary,
  };
}

function buildTowerSummary(jobs, options = {}) {
  const summary = options.summary || summarizeJobs(jobs);
  const timeSummary = summarizeTimeSweep(jobs, options.timeSweepOptions);
  const running = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].map(
    (item) => {
      const job = item.job;
      return {
        id: job.id,
        profile: job.target_worker_profile,
        claimed_at: job.claimed_at,
        claimed_by: job.claimed_by,
        title: jobTitle(job),
        age: formatAge(job.claimed_at),
      };
    }
  );

  const reviewSplit = splitReviewWatchItems(getReviewWatchItems(timeSummary), {
    nowMs: options.timeSweepOptions?.nowMs,
  });
  const actionable = deriveActionableAttention(summary, timeSummary, reviewSplit);
  const systemState = deriveSystemState(summary, timeSummary, reviewSplit);
  const motion = {
    system_state: systemState,
    running_count: running.length,
    stranded_count: summary.stranded_count || 0,
    awaiting_approval_count:
      summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length,
    pending_or_stranded_count:
      timeSummary.watchlist.buckets[WATCHLIST_CATEGORIES.PENDING_OR_STRANDED]
        .length,
    completed_needs_review_count:
      timeSummary.watchlist.buckets[
        WATCHLIST_CATEGORIES.COMPLETED_NEEDS_ASSISTANT_REVIEW
      ].length,
    review_history_count: reviewSplit.totalHistorical,
    failed_count: summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length,
    needs_attention_count: actionable.count,
    actionable_attention_count: actionable.count,
    watchlist_needs_attention_count: timeSummary.needs_attention_count,
  };
  const nextUp = deriveNextUp(summary);
  const waitingOn = deriveWaitingOn(
    summary,
    timeSummary,
    systemState,
    reviewSplit
  );
  const currentFocus = deriveCurrentFocus(
    summary,
    timeSummary,
    running,
    reviewSplit
  );
  const laneReadinessSummary = formatLaneReadinessSummary();

  const tower = {
    data_mode: options.data_mode || "live",
    live_access: options.live_access,
    backend: options.backend || { backend: "unknown" },
    generated_at: options.generated_at || new Date().toISOString(),
    motion,
    running,
    next_up: nextUp,
    waiting_on: waitingOn,
    current_focus: currentFocus,
    lane_readiness_summary: laneReadinessSummary,
    parallel_capacity: PARALLEL_CAPACITY_V0,
    lane_registry: LANE_REGISTRY_V0,
    lanes: summarizeLanes(summary),
    thresholds: timeSummary.thresholds,
    swept_at: timeSummary.swept_at,
  };

  tower.compact = buildCompactControlTowerBlock(tower);
  tower.activity_log = buildActivityLog(jobs, summary, timeSummary, systemState, {
    generated_at: tower.generated_at,
  });
  tower.live_source = options.live_source || null;
  tower.current_queue = buildCurrentQueue(summary, timeSummary, systemState, {
    generated_at: tower.generated_at,
    jobs,
  });
  return tower;
}

function buildSampleWatchSummary() {
  const summary = buildSampleSummary();
  const jobs = jobsFromSummary(summary);
  return buildWatchSummary(jobs, {
    summary,
    data_mode: "sample",
    backend: summary.backend,
    generated_at: summary.generated_at,
  });
}

function buildSampleTowerSummary() {
  const summary = buildSampleSummary();
  const jobs = jobsFromSummary(summary);
  return buildTowerSummary(jobs, {
    summary,
    data_mode: "sample",
    backend: summary.backend,
    generated_at: summary.generated_at,
  });
}

function watchItemRow(item) {
  const job = item.classified.job;
  return `<tr>
    <td class="mono">${escapeHtml(job.id)}</td>
    <td>${escapeHtml(jobTitle(job))}</td>
    <td>${escapeHtml(job.target_worker_profile || "")}</td>
    <td>${item.age_minutes != null ? `${escapeHtml(String(item.age_minutes))}m` : ""}</td>
    <td class="mono muted">${escapeHtml(item.reason || "")}</td>
  </tr>`;
}

function renderWatchHtml(model) {
  const isLive = model.data_mode === "live";
  const badgeLabel = isLive
    ? `LIVE DATA · ${liveAccessLabel(model.live_access)}`
    : "SAMPLE DATA ONLY · not real system state";
  const badgeClass = isLive ? "live" : "proto";
  const watchlist = model.time_summary.watchlist;
  const sections = WATCH_SECTIONS.map(([category, title]) => {
    const items = watchlist.buckets[category] || [];
    const rows =
      items.length === 0
        ? `<tr><td colspan="5" class="empty">(none)</td></tr>`
        : items.map(watchItemRow).join("");
    return `<section>
      <h2>${escapeHtml(title)} <span class="count-pill">${items.length}</span></h2>
      <div class="card"><table>
        <thead><tr><th>Job ID</th><th>Title</th><th>Profile</th><th>Age</th><th>Reason</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }).join("");

  return renderShortStatusShell({
    title: "Assistant Watcher",
    subtitle: "Completed-needs-review, failed, pending/stranded, running-too-long",
    badgeLabel,
    badgeClass,
    meta: `Swept: ${escapeHtml(model.time_summary.swept_at)} · Needs attention: ${watchlist.needs_attention_count} · Mode: ${escapeHtml(model.data_mode)}`,
    summaryCards: [
      { label: "Needs attention", count: watchlist.needs_attention_count, accent: "warn" },
      {
        label: "Completed · review",
        count:
          watchlist.buckets[WATCHLIST_CATEGORIES.COMPLETED_NEEDS_ASSISTANT_REVIEW]
            .length,
        accent: "completed",
      },
      {
        label: "Failed",
        count:
          watchlist.buckets[WATCHLIST_CATEGORIES.FAILED_NEEDS_ATTENTION].length,
        accent: "failed",
      },
      {
        label: "On track",
        count: watchlist.buckets[WATCHLIST_CATEGORIES.NO_ACTION_NEEDED].length,
        accent: "running",
      },
    ],
    body: sections,
    footerNote:
      "CLI equivalent: npm run status:watch · Doc: docs/command-channel/short-status-routes-v0.md",
    navHtml: buildShortStatusNav(model.data_mode),
  });
}

function renderBatchTaskRows(entries, emptyText) {
  if (!entries || entries.length === 0) {
    return `<tr><td colspan="6" class="empty">${escapeHtml(emptyText)}</td></tr>`;
  }
  const nowMs = Date.now();
  return entries
    .map((row) => {
      const batchState = row.batch_state || BATCH_STATES.PENDING;
      const isDynamicLive = row.row_source === "dynamic_live";
      const sourceClass = isDynamicLive
        ? "batch-live-only"
        : row.live_linked
          ? "batch-live-linked"
          : "batch-planned";
      const sourceHint = isDynamicLive
        ? "Command-channel live job — not matched to manifest"
        : row.live_linked
          ? "Manifest + live — matched command-channel job"
          : "Planned — no matching live job yet";
      const sourceMarker =
        row.status_source === "manifest + live"
          ? "manifest + live"
          : row.status_source === "command-channel live"
            ? "command-channel live"
            : row.status_source === "planned"
              ? "planned"
              : "";
      const isLiveRunning =
        batchState === BATCH_STATES.RUNNING && row.live_linked === true;
      const motionState = isLiveRunning
        ? deriveRunningMotionState(row, nowMs)
        : null;
      const motionClass = motionState
        ? ` batch-running-motion-${escapeHtml(motionState)}`
        : "";
      const linkHint = row.link_hint
        ? `<span class="batch-link-hint muted">${escapeHtml(row.link_hint)}</span>`
        : "";
      const statusCell = isLiveRunning
        ? `${renderLiveRunningStatusCell(row, nowMs)}${linkHint ? `<div>${linkHint}</div>` : ""}`
        : `<span class="batch-status-label">${escapeHtml(row.status_label || row.hint || row.status || "")}</span>${linkHint ? `<div>${linkHint}</div>` : ""}`;
      const sourceMeta = sourceMarker
        ? ` · <span class="batch-source-marker">${escapeHtml(sourceMarker)}</span>`
        : "";
      return `<tr class="batch-row batch-state-${escapeHtml(batchState)} ${sourceClass}${motionClass}" title="${escapeHtml(sourceHint)}">
        <td class="batch-task col-task">${escapeHtml(row.plan)}</td>
        <td class="batch-purpose muted col-purpose col-hide-narrow">${escapeHtml(row.purpose || "—")}</td>
        <td class="mono col-job-id">${escapeHtml(row.id)}</td>
        <td class="col-status">${statusCell}</td>
        <td class="col-tim">${row.tim_action_needed ? '<span class="tim-action-yes">Yes</span>' : '<span class="tim-action-no muted">—</span>'}</td>
        <td class="batch-meta muted col-meta col-hide-narrow">${escapeHtml(row.profile)} · ${escapeHtml(row.repo)}${sourceMeta}</td>
      </tr>`;
    })
    .join("");
}

function renderSingleBatchTable(batchRows, emptyText) {
  return `<div class="card batch-table-primary">
    <table class="batch-task-table">
      <thead><tr><th class="col-task">Task</th><th class="col-purpose col-hide-narrow">Purpose</th><th class="col-job-id">Job ID</th><th class="col-status">Status</th><th class="col-tim">Tim action</th><th class="col-meta col-hide-narrow">Profile · Repo</th></tr></thead>
      <tbody>${renderBatchTaskRows(batchRows, emptyText)}</tbody>
    </table>
  </div>`;
}

function splitPlannedManifestRows(manifestRows) {
  const activePlannedRows = [];
  const completedInfraRows = [];
  for (const row of manifestRows || []) {
    const isCompletedInfra =
      row.batch_state === BATCH_STATES.COMPLETED &&
      row.status_source === "planned" &&
      row.live_linked !== true;
    if (isCompletedInfra) {
      completedInfraRows.push(row);
    } else {
      activePlannedRows.push(row);
    }
  }
  return { activePlannedRows, completedInfraRows };
}

function renderQueueJobRows(entries, emptyText) {
  if (!entries || entries.length === 0) {
    return `<tr><td colspan="5" class="empty">${escapeHtml(emptyText)}</td></tr>`;
  }
  return entries
    .map(
      (row) => `<tr>
        <td class="mono">${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.profile)}</td>
        <td>${escapeHtml(row.repo)}</td>
        <td>${escapeHtml(row.plan)}</td>
        <td class="mono muted">${escapeHtml(row.hint || row.status || "")}</td>
      </tr>`
    )
    .join("");
}

function renderTowerExecutionHeaderHtml(executionHeader, liveSource, isLive) {
  if (!executionHeader?.label) {
    return "";
  }

  const tone = executionHeader.tone || "idle";
  const motionState = executionHeader.running_motion_state || null;
  const motionClass =
    tone === "running" && motionState
      ? ` tower-exec-live-${escapeHtml(motionState)}`
      : "";

  const headlineInner =
    tone === "running"
      ? `<span class="tower-exec-headline-inner"><span class="tower-live-dot" aria-hidden="true"></span>${escapeHtml(executionHeader.label)}</span>`
      : escapeHtml(executionHeader.label);

  let detailText = executionHeader.detail || "";
  if (tone === "running" && executionHeader.running_job) {
    const job = executionHeader.running_job;
    const parts = [
      job.title,
      job.id,
      job.profile,
      job.claimed_by,
    ].filter(Boolean);
    detailText = parts.join(" · ");
  } else if (detailText.length > 140) {
    detailText = `${detailText.slice(0, 137)}…`;
  }

  const motionNote =
    motionState === "stalled"
      ? `<span class="tower-stale-warn">Running long</span>`
      : motionState === "possibly_stale"
        ? `<span class="tower-stale-warn tower-stale-warn-soft">Possibly stalled</span>`
        : "";

  const liveSourceInline = renderLiveSourceStatusHtml(liveSource, isLive, {
    compact: true,
  });

  const line2Parts = [];
  if (liveSourceInline) {
    line2Parts.push(liveSourceInline);
  }
  if (executionHeader.live_only_row_count > 0) {
    line2Parts.push(
      `<span class="tower-exec-inline-meta">${escapeHtml(String(executionHeader.live_only_row_count))} unmatched live job(s)</span>`
    );
  }
  if (executionHeader.refreshed_at_display) {
    line2Parts.push(
      `<span class="tower-exec-inline-meta muted">Refreshed ${escapeHtml(executionHeader.refreshed_at_display)} UTC</span>`
    );
  }

  const line2Html =
    line2Parts.length > 0
      ? `<div class="tower-exec-strip-line2">${line2Parts.join('<span class="tower-exec-sep"> · </span>')}</div>`
      : "";

  return `<div class="tower-execution-strip tone-${escapeHtml(tone)}${motionClass}" role="status" aria-live="polite">
    <div class="tower-exec-strip-line1">
      <span class="tower-exec-headline">${headlineInner}</span>
      ${detailText ? `<span class="tower-exec-detail-compact">${escapeHtml(detailText)}</span>` : ""}
      ${motionNote}
    </div>
    ${line2Html}
  </div>`;
}

function renderLiveSourceStatusHtml(liveSource, isLive, options = {}) {
  if (!isLive || !liveSource) {
    return "";
  }

  const compact = options.compact === true;
  const refreshedDisplay = formatLogTimestamp(liveSource.refreshed_at);

  if (liveSource.status === "connected") {
    const modeLabel =
      liveSource.mode === "remote-http"
        ? "remote"
        : liveSource.mode === "supabase"
          ? "supabase"
          : liveSource.mode === "filesystem"
            ? "local fs"
            : liveSource.mode;
    if (compact) {
      return `<span class="live-source-inline live-source-connected">Live source: connected · ${escapeHtml(String(modeLabel))} · ${liveSource.job_count} job(s)</span>`;
    }
    const endpointNote = liveSource.endpoint
      ? ` · ${escapeHtml(liveSource.endpoint)}`
      : "";
    const emptyNote =
      liveSource.job_count === 0 && liveSource.message
        ? ` · ${escapeHtml(liveSource.message)}`
        : "";
    return `<p class="live-source-status live-source-connected" role="status">Live source: connected · ${escapeHtml(String(modeLabel))} · ${liveSource.job_count} job(s) loaded · refreshed ${escapeHtml(refreshedDisplay)}${endpointNote}${emptyNote}</p>`;
  }

  const setup = liveSource.setup
    ? `<span class="live-source-setup">${escapeHtml(liveSource.setup)}</span>`
    : "";
  const message = liveSource.message
    ? escapeHtml(liveSource.message)
    : "Live command-channel jobs unavailable";
  const statusLabel =
    liveSource.status === "auth_missing"
      ? "auth missing"
      : liveSource.status === "auth_unauthorized"
        ? "auth invalid"
        : liveSource.status === "fetch_error"
          ? "fetch error"
          : "unavailable";

  if (compact) {
    return `<span class="live-source-inline live-source-unavailable" role="alert">Live source: ${escapeHtml(statusLabel)} · ${message}</span>`;
  }

  return `<p class="live-source-status live-source-unavailable" role="alert">Live source: ${escapeHtml(statusLabel)} · ${message}. ${setup} Manifest planned rows below may be static only — not a substitute for live jobs.</p>`;
}

function renderCurrentQueueBlock(currentQueue, isLive, liveSource) {
  if (!currentQueue) {
    return "";
  }

  const executionHeaderHtml = renderTowerExecutionHeaderHtml(
    currentQueue.execution_header,
    liveSource,
    isLive
  );
  const reviewHistoryTotal = currentQueue.review_history_total || 0;
  const reviewHistoryNote =
    reviewHistoryTotal > 0
      ? `<p class="muted batch-history-note">${reviewHistoryTotal} older completed job(s) in review history — see Activity Log below · not current-batch blockers</p>`
      : "";

  const liveOnlyRows = currentQueue.live_only_rows || [];
  const manifestRows =
    currentQueue.batch_rows ||
    (currentQueue.batch_sections || []).flatMap((section) => section.items || []);
  const { activePlannedRows, completedInfraRows } =
    splitPlannedManifestRows(manifestRows);
  const mainTableRows = [...liveOnlyRows, ...activePlannedRows];
  const batchName = currentQueue.manifest_batch_name || "current batch";
  const manifestPath = currentQueue.manifest_path || "config/tower-current-batch.json";
  const refreshNote = isLive ? " · auto-refresh 30s" : "";

  const completedInfraBlock =
    completedInfraRows.length > 0
      ? `<details class="completed-infra-subsection">
    <summary>Completed infrastructure <span class="count-pill">${completedInfraRows.length}</span></summary>
    <p class="muted completed-infra-note">Historical done items — batch/data-source scaffolding, not the active plan</p>
    ${renderSingleBatchTable(completedInfraRows, "(none)")}
  </details>`
      : "";

  const plannedBatchBlock = `<div class="planned-batch-section">
    <h2 class="tower-batch-container-title">${escapeHtml(currentQueue.label || "Tower Current Batch")} <span class="count-pill">${mainTableRows.length + completedInfraRows.length}</span></h2>
    <p class="tower-batch-subtitle muted">${escapeHtml(batchName)} · ${escapeHtml(manifestPath)}${refreshNote}</p>
    <h3 class="planned-items-heading">Planned Batch Items <span class="count-pill">${mainTableRows.length}</span></h3>
    ${renderSingleBatchTable(mainTableRows, "(no active planned items)")}
    ${completedInfraBlock}
  </div>`;

  return `<section class="batch-section batch-section-primary">
    ${executionHeaderHtml}
    ${plannedBatchBlock}
    ${reviewHistoryNote}
    <details class="batch-legend-details">
      <summary class="muted">Status legend</summary>
      <p class="batch-legend muted">Row colors: grey = Done · planned · vivid green = Running · live (claimed job only — pulsing dot when active) · yellow = Waiting / Needs Tim / Awaiting approval · red = Failed · blue = Planned / not launched · link hint shows whether a live job is linked · amber/orange = possibly stalled / running long</p>
    </details>
  </section>`;
}

function renderTowerHtml(model) {
  const isLive = model.data_mode === "live";
  const badgeLabel = isLive
    ? `LIVE DATA · ${liveAccessLabel(model.live_access)}`
    : "SAMPLE DATA ONLY · not real system state";
  const badgeClass = isLive ? "live" : "proto";
  const stateLabel = model.motion.system_state.replace(/_/g, " ");

  const laneRows =
    model.lanes.length === 0
      ? `<tr><td colspan="6" class="empty">(none)</td></tr>`
      : model.lanes
          .map(
            (lane) => `<tr>
              <td>${escapeHtml(lane.profile)}</td>
              <td>${lane.running}</td>
              <td>${lane.stranded}</td>
              <td>${lane.awaiting_approval}</td>
              <td>${lane.completed}</td>
              <td>${lane.failed}</td>
            </tr>`
          )
          .join("");

  const registryRows = (model.lane_registry || LANE_REGISTRY_V0)
    .map(
      (lane) => `<tr>
        <td>${escapeHtml(lane.room)}</td>
        <td class="mono">${escapeHtml(lane.source_room || "—")}</td>
        <td class="mono">${escapeHtml(lane.active_lane || "—")}</td>
        <td>${escapeHtml(lane.profile || "—")}</td>
        <td><span class="readiness-${readinessClass(lane.readiness_category)}">${escapeHtml(lane.readiness_category || lane.lane_status)}</span></td>
        <td>${lane.launch_ready ? "yes" : "no"}</td>
        <td>${lane.parallel_slot != null ? escapeHtml(String(lane.parallel_slot)) : "—"}</td>
        <td>${escapeHtml(lane.note)}</td>
      </tr>`
    )
    .join("");

  const capacity = model.parallel_capacity || PARALLEL_CAPACITY_V0;
  const capacityBlock = `<div class="capacity-block">
    <div class="capacity-metric"><span class="capacity-label">Active lanes</span><span class="capacity-value">${capacity.active_lane_count}</span></div>
    <div class="capacity-metric"><span class="capacity-label">Safe target</span><span class="capacity-value">${capacity.safe_target_min}–${capacity.safe_target_max}</span></div>
    <div class="capacity-metric"><span class="capacity-label">Slots to open</span><span class="capacity-value">${capacity.slots_available}</span></div>
    <div class="capacity-metric"><span class="capacity-label">Next candidate</span><span class="capacity-value capacity-text">${escapeHtml(capacity.next_candidate || "—")}</span></div>
  </div>`;

  const nextUp = model.next_up;
  const nextBlock = `<div class="motion-block">
    <div class="motion-label">Who owns next</div>
    <div class="motion-value">${escapeHtml(nextUp.owner)}</div>
    <div class="motion-action">${escapeHtml(nextUp.action)}</div>
    ${
      nextUp.job_id
        ? `<p class="mono muted">${escapeHtml(nextUp.job_id)} · ${escapeHtml(nextUp.title || "")}</p>`
        : ""
    }
  </div>`;

  const activityLog = model.activity_log;
  const activityLines =
    activityLog && activityLog.events.length > 0
      ? activityLog.events
          .map(
            (event) =>
              `<div class="activity-line kind-${escapeHtml(event.kind)}"><span class="activity-ts mono">${escapeHtml(event.at_display)}</span> ${escapeHtml(event.text)}</div>`
          )
          .join("")
      : `<div class="activity-line empty">No command-channel events yet.</div>`;

  const activityBlock = activityLog
    ? `<details class="activity-section activity-section-secondary">
      <summary>Activity log <span class="count-pill">${activityLog.event_count}</span></summary>
      <p class="muted activity-note">History and prior batches · reconstructed from command-channel job records${isLive ? " · auto-refresh 30s" : ""}</p>
      <div class="activity-log" id="activity-log">${activityLines}</div>
    </details>`
    : "";

  const currentQueueBlock = renderCurrentQueueBlock(
    model.current_queue,
    isLive,
    model.live_source
  );

  const body = `
    ${currentQueueBlock}
    ${activityBlock}
    <details class="tower-secondary">
      <summary>Lane capacity &amp; job counts</summary>
    <div class="motion-grid">
      <div class="motion-block state-${escapeHtml(model.motion.system_state)}">
        <div class="motion-label">System motion</div>
        <div class="motion-value">${escapeHtml(stateLabel)}</div>
        <div class="motion-action">${model.motion.running_count} running · ${model.motion.stranded_count} stranded · ${model.motion.actionable_attention_count} needs attention</div>
        <div class="motion-action">Waiting on: ${escapeHtml(model.waiting_on || "none")}</div>
        <div class="motion-action muted">Focus: ${escapeHtml(model.current_focus || "")}</div>
      </div>
      ${nextBlock}
    </div>

    <section>
      <h2>Job counts by profile</h2>
      <div class="card"><table>
        <thead><tr><th>Profile</th><th>Running</th><th>Stranded</th><th>Awaiting approval</th><th>Completed</th><th>Failed</th></tr></thead>
        <tbody>${laneRows}</tbody>
      </table></div>
    </section>

    <section>
      <h2>Parallel lane capacity</h2>
      <p class="muted" style="margin: 0 0 0.65rem;">One writer per repo/workspace. Target: ${capacity.safe_target_min}–${capacity.safe_target_max} simultaneous jobs via separate lanes.</p>
      ${capacityBlock}
      <p class="muted" style="margin: 0.65rem 0;">${escapeHtml(model.lane_readiness_summary || "")}</p>
      <div class="card"><table>
        <thead><tr><th>Room</th><th>source_room</th><th>active_lane</th><th>Profile</th><th>Readiness</th><th>Launch ready</th><th>Slot</th><th>Note</th></tr></thead>
        <tbody>${registryRows}</tbody>
      </table></div>
    </section>
    </details>`;

  const staleCodeBanner =
    isLive && model.stale_code?.stale
      ? buildTowerStaleCodeBannerHtml(model.stale_code)
      : "";

  return renderShortStatusShell({
    title: "Control Tower",
    subtitle: "Current batch plan first — compact execution status, then planned items",
    badgeLabel,
    badgeClass,
    meta: `Swept: ${escapeHtml(model.swept_at)} · ${model.motion.running_count} running · ${model.motion.actionable_attention_count} needs attention · Mode: ${escapeHtml(model.data_mode)}`,
    summaryCards: [],
    headerExtra: staleCodeBanner,
    body,
    footerNote:
      "CLI: npm run status:tower · Doc: docs/command-channel/control-tower-motion-v0.md",
    navHtml: buildShortStatusNav(model.data_mode),
    headExtra: isLive ? '<meta http-equiv="refresh" content="30">' : "",
    bodyScript: isLive
      ? `<script>window.addEventListener("load",function(){var el=document.getElementById("activity-log");if(el){el.scrollTop=el.scrollHeight;}});</script>`
      : "",
  });
}

function readinessClass(category) {
  if (!category) {
    return "unknown";
  }
  return category
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function buildShortStatusNav(dataMode) {
  if (dataMode === "sample") {
    return `<a href="/tower/preview">/tower/preview (sample)</a><a href="/watch/preview">/watch/preview (sample)</a><a href="/status/preview">/status/preview (sample)</a><a href="/tower">/tower (live — local browser)</a>`;
  }
  return `<a href="/tower">/tower (live)</a><a href="/watch">/watch (live)</a><a href="/status">/status (live)</a><span class="nav-sep">·</span><a href="/tower/preview">preview (sample only)</a>`;
}

function renderLocalLiveLandingHtml(options = {}) {
  const route = options.route || "tower";
  const port = options.port || 8790;
  const liveUrl = `http://127.0.0.1:${port}/${route}`;
  const previewUrl = `http://127.0.0.1:${port}/${route}/preview`;
  const titles = {
    tower: "Control Tower",
    watch: "Assistant Watcher",
    status: "Bridge Status",
  };
  const cliCommands = {
    tower: "npm run status:tower",
    watch: "npm run status:watch",
    status: "npm run status:bridge",
  };
  const title = titles[route] || "Command Channel Status";
  const reason = options.reason || "auth_not_configured";
  const isAuthMissing = reason === "auth_not_configured";
  const headline = isAuthMissing
    ? "This is not live yet"
    : "Live access not available";
  const reasonText = isAuthMissing
    ? "The server is running, but command-channel auth is not configured in this process. Live data cannot be served until auth is loaded."
    : "Live data requires local setup with auth loaded in the server process, or a valid Bearer token.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — setup required</title>
  <style>
    :root { --bg: #0f1419; --surface: #1a2332; --text: #e7ecf3; --muted: #9aa8bc; --border: #334155; --running: #38bdf8; --proto: #a78bfa; --warn: #f59e0b; --sans: system-ui, sans-serif; --mono: "Cascadia Code", Consolas, monospace; }
    body { margin: 0; font-family: var(--sans); background: var(--bg); color: var(--text); line-height: 1.55; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    h1 { margin: 0 0 0.35rem; font-size: 1.45rem; }
    .subtitle { color: var(--muted); margin: 0 0 1rem; }
    .badge { display: inline-block; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid rgba(245,158,11,0.35); background: rgba(245,158,11,0.12); color: var(--warn); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; margin: 1rem 0; }
    .card h2 { margin: 0 0 0.5rem; font-size: 1rem; }
    code, .cmd { font-family: var(--mono); font-size: 0.88rem; background: #0b1220; border: 1px solid var(--border); border-radius: 6px; padding: 0.45rem 0.55rem; display: block; margin-top: 0.35rem; white-space: pre-wrap; }
    a { color: var(--running); }
    .warn { color: var(--warn); }
    ul, ol { margin: 0.5rem 0 0; padding-left: 1.2rem; }
    .checklist { list-style: none; padding-left: 0; }
    .checklist li { margin: 0.35rem 0; padding-left: 1.4rem; position: relative; }
    .checklist li::before { content: "•"; position: absolute; left: 0.35rem; color: var(--warn); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">Local live view — setup required before this page shows real data</p>
    <span class="badge">${escapeHtml(headline)}</span>
    <div class="card">
      <h2>What is happening</h2>
      <p>${escapeHtml(reasonText)}</p>
      <ul class="checklist">
        <li><strong>This is not live yet.</strong> You are not looking at real command-channel state.</li>
        <li>The server process is up, but auth is not configured here.</li>
        <li><a href="${escapeHtml(previewUrl)}"><strong>/${escapeHtml(route)}/preview</strong></a> is <span class="warn">SAMPLE DATA ONLY</span> — fake jobs for layout testing.</li>
        <li><strong>Do not paste tokens into chat</strong> or into the browser address bar.</li>
      </ul>
    </div>
    <div class="card">
      <h2>Fix — restart from a token-loaded supervisor shell</h2>
      <ol>
        <li>Open a supervisor shell where command-channel auth is already loaded (env or <code>config/auth.json</code> in that session).</li>
        <li>Stop this server (<kbd>Ctrl+C</kbd>) and start it again from that shell:</li>
      </ol>
      <span class="cmd">npm run server:command-channel</span>
      <p>After restart, open the live URL in your browser (no Bearer header needed on 127.0.0.1):</p>
      <span class="cmd">${escapeHtml(liveUrl)}</span>
    </div>
    <div class="card">
      <h2>CLI live (no server)</h2>
      <p>Reads the local job store directly — same live data, text output:</p>
      <span class="cmd">${escapeHtml(cliCommands[route] || "npm run status:tower")}</span>
    </div>
    <p class="subtitle">Doc: docs/command-channel/local-live-tower-v0.md</p>
  </div>
</body>
</html>`;
}

function renderShortStatusShell(options) {
  const summaryCards = options.summaryCards || [];
  const cards = summaryCards
    .map(
      (card) =>
        `<div class="summary-card ${escapeHtml(card.accent)}"><div class="label">${escapeHtml(card.label)}</div><div class="count">${card.count}</div></div>`
    )
    .join("");
  const summaryGrid =
    summaryCards.length > 0
      ? `<div class="summary-grid">${cards}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${options.headExtra || ""}
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root {
      --bg: #0f1419; --surface: #1a2332; --surface-2: #243044; --text: #e7ecf3;
      --muted: #9aa8bc; --border: #334155; --stranded: #f59e0b; --running: #38bdf8;
      --completed: #34d399; --failed: #f87171; --proto: #a78bfa; --live: #34d399;
      --batch-completed: #6b7280; --batch-running: #22c55e; --batch-pending: #fbbf24; --batch-failed: #f87171; --batch-future: #38bdf8; --batch-idle: #9aa8bc;
      --mono: "Cascadia Code", "Consolas", "SF Mono", monospace;
      --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--sans); background: var(--bg); color: var(--text); line-height: 1.5; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
    header { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    header h1 { margin: 0 0 0.35rem; font-size: 1.45rem; font-weight: 650; }
    .subtitle { color: var(--muted); font-size: 0.95rem; margin: 0; }
    .badge { display: inline-block; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.2rem 0.55rem; border-radius: 999px; margin-top: 0.75rem; border: 1px solid; }
    .badge.proto { background: rgba(167, 139, 250, 0.15); color: var(--proto); border-color: rgba(167, 139, 250, 0.35); }
    .badge.live { background: rgba(52, 211, 153, 0.15); color: var(--live); border-color: rgba(52, 211, 153, 0.35); }
    .meta { margin-top: 0.6rem; font-size: 0.82rem; color: var(--muted); }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.75rem; }
    .summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.9rem 1rem; border-top: 3px solid var(--accent, var(--border)); }
    .summary-card.warn { --accent: var(--stranded); }
    .summary-card.running { --accent: var(--running); }
    .summary-card.completed { --accent: var(--completed); }
    .summary-card.failed { --accent: var(--failed); }
    .summary-card .label { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .summary-card .count { font-size: 2rem; font-weight: 700; line-height: 1.1; margin-top: 0.15rem; }
    section { margin-bottom: 1.75rem; }
    section h2 { font-size: 1.05rem; margin: 0 0 0.65rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .count-pill { font-size: 0.75rem; background: var(--surface-2); padding: 0.1rem 0.45rem; border-radius: 999px; color: var(--muted); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { text-align: left; padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { background: var(--surface-2); color: var(--muted); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
    tr:last-child td { border-bottom: none; }
    .empty { color: var(--muted); font-style: italic; }
    .mono { font-family: var(--mono); font-size: 0.8rem; word-break: break-all; }
    .muted { color: var(--muted); }
    .motion-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; margin-bottom: 1.75rem; }
    .motion-block { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; border-left: 3px solid var(--running); }
    .motion-block.state-running { border-left-color: var(--running); }
    .motion-block.state-idle { border-left-color: var(--completed); }
    .motion-block.state-needs_attention { border-left-color: var(--stranded); }
    .motion-block.state-blocked { border-left-color: var(--failed); }
    .motion-label { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .motion-value { font-size: 1.35rem; font-weight: 650; margin-top: 0.25rem; text-transform: capitalize; }
    .motion-action { color: var(--muted); font-size: 0.9rem; margin-top: 0.35rem; }
    .footer-note { margin-top: 1.5rem; font-size: 0.82rem; color: var(--muted); }
    .nav { margin-top: 0.75rem; font-size: 0.82rem; }
    .nav a { color: var(--running); margin-right: 0.75rem; }
    .nav-sep { color: var(--muted); margin-right: 0.75rem; }
    .activity-section { margin-bottom: 1.75rem; }
    .activity-note { margin: 0 0 0.65rem; font-size: 0.82rem; }
    .activity-state { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.45rem 0.75rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 0.65rem; border-left: 3px solid var(--running); }
    .activity-state.state-working { border-left-color: var(--running); }
    .activity-state.state-waiting { border-left-color: var(--stranded); }
    .activity-state.state-needs-tim { border-left-color: var(--stranded); }
    .activity-state.state-idle { border-left-color: var(--completed); }
    .activity-state.state-blocked { border-left-color: var(--failed); }
    .activity-state-label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .activity-state-value { font-size: 1.15rem; font-weight: 650; }
    .activity-state-detail { color: var(--muted); font-size: 0.88rem; flex: 1 1 100%; }
    .activity-log { background: #0b1220; border: 1px solid var(--border); border-radius: 10px; max-height: 320px; overflow-y: auto; padding: 0.65rem 0.75rem; font-family: var(--mono); font-size: 0.78rem; line-height: 1.45; }
    .activity-line { padding: 0.2rem 0; border-bottom: 1px solid rgba(51,65,85,0.45); }
    .activity-line:last-child { border-bottom: none; }
    .activity-line.kind-tim_action { color: #fbbf24; }
    .activity-line.kind-failed { color: var(--failed); }
    .activity-line.kind-completed { color: var(--completed); }
    .activity-line.kind-claimed { color: var(--running); }
    .activity-ts { color: var(--muted); margin-right: 0.45rem; }
    .queue-section { margin-bottom: 1.75rem; }
    .batch-section { margin-bottom: 1.75rem; }
    .queue-note { margin: 0 0 0.65rem; font-size: 0.82rem; }
    .queue-idle { margin: 0 0 0.65rem; font-size: 0.88rem; }
    .batch-history-note { margin: 0 0 0.65rem; font-size: 0.78rem; }
    .batch-section-primary { margin-bottom: 1.25rem; }
    .tower-execution-strip, .tower-execution-header { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.55rem 0.75rem; margin-bottom: 0.65rem; border-left: 3px solid var(--running); }
    .tower-execution-strip.tone-running, .tower-execution-header.tone-running { border-left-color: var(--batch-running); background: rgba(34, 197, 94, 0.08); }
    .tower-execution-strip.tone-running.tower-exec-live-active, .tower-execution-header.tone-running.tower-exec-live-active { animation: tower-header-live-pulse 2.4s ease-in-out infinite; }
    .tower-execution-strip.tone-running.tower-exec-live-active::after, .tower-execution-header.tone-running.tower-exec-live-active::after {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, rgba(134, 239, 172, 0.85), transparent);
      background-size: 200% 100%; animation: tower-header-shimmer 2.2s linear infinite;
    }
    .tower-execution-strip.tone-running.tower-exec-live-possibly_stale, .tower-execution-header.tone-running.tower-exec-live-possibly_stale {
      border-left-color: var(--batch-pending); background: rgba(251, 191, 36, 0.1); animation: none;
    }
    .tower-execution-strip.tone-running.tower-exec-live-possibly_stale .tower-exec-headline-inner, .tower-execution-header.tone-running.tower-exec-live-possibly_stale .tower-exec-headline-inner { color: #fde68a; }
    .tower-execution-strip.tone-running.tower-exec-live-stalled, .tower-execution-header.tone-running.tower-exec-live-stalled {
      border-left-color: #fb923c; background: rgba(251, 146, 60, 0.12); animation: none;
    }
    .tower-execution-strip.tone-running.tower-exec-live-stalled .tower-exec-headline-inner, .tower-execution-header.tone-running.tower-exec-live-stalled .tower-exec-headline-inner { color: #fdba74; }
    .tower-execution-strip, .tower-execution-header { position: relative; overflow: hidden; }
    .tower-execution-strip.tone-idle, .tower-execution-header.tone-idle { border-left-color: var(--batch-future); background: rgba(56, 189, 248, 0.08); }
    .tower-execution-strip.tone-waiting, .tower-execution-header.tone-waiting { border-left-color: var(--batch-pending); background: rgba(251, 191, 36, 0.1); }
    .tower-execution-strip.tone-failed, .tower-execution-header.tone-failed { border-left-color: var(--batch-failed); background: rgba(248, 113, 113, 0.12); }
    .tower-execution-strip.tone-done, .tower-execution-header.tone-done { border-left-color: var(--batch-completed); background: rgba(107, 114, 128, 0.12); }
    .tower-exec-strip-line1 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.65rem; }
    .tower-exec-strip-line2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.55rem; margin-top: 0.3rem; font-size: 0.78rem; }
    .tower-exec-sep { color: var(--muted); }
    .tower-exec-inline-meta { color: var(--muted); font-size: 0.78rem; }
    .tower-exec-headline { font-size: 1rem; font-weight: 700; line-height: 1.25; }
    .tower-exec-detail-compact { color: var(--muted); font-size: 0.82rem; flex: 1 1 auto; min-width: 0; }
    .tower-exec-headline-inner { display: inline-flex; align-items: center; gap: 0.45rem; }
    .tower-execution-strip.tone-running .tower-exec-headline, .tower-execution-header.tone-running .tower-exec-headline { color: #86efac; }
    .tower-execution-strip.tone-idle .tower-exec-headline, .tower-execution-header.tone-idle .tower-exec-headline { color: #bae6fd; }
    .tower-execution-strip.tone-waiting .tower-exec-headline, .tower-execution-header.tone-waiting .tower-exec-headline { color: #fde68a; }
    .tower-execution-strip.tone-failed .tower-exec-headline, .tower-execution-header.tone-failed .tower-exec-headline { color: #fca5a5; }
    .tower-execution-strip.tone-done .tower-exec-headline, .tower-execution-header.tone-done .tower-exec-headline { color: #d1d5db; }
    .tower-exec-detail { color: var(--muted); font-size: 0.9rem; margin-top: 0.35rem; }
    .tower-exec-context { display: flex; flex-wrap: wrap; gap: 0.45rem 0.85rem; margin-top: 0.65rem; font-size: 0.82rem; }
    .tower-exec-context-item { color: var(--text); }
    .tower-exec-context-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; font-size: 0.72rem; margin-right: 0.35rem; }
    .tower-exec-green-note { color: var(--muted); font-size: 0.82rem; }
    .tower-exec-green-zero { color: #bae6fd; }
    .batch-table-primary { margin-top: 0.65rem; }
    .batch-legend { margin: 0.55rem 0 0; font-size: 0.75rem; }
    tr.batch-row.batch-state-completed { background: rgba(107, 114, 128, 0.12); }
    tr.batch-row.batch-state-completed td { color: var(--muted); }
    tr.batch-row.batch-state-completed td:first-child { box-shadow: inset 3px 0 0 var(--batch-completed); }
    tr.batch-row.batch-state-running { background: rgba(34, 197, 94, 0.18); }
    tr.batch-row.batch-state-running td:first-child { box-shadow: inset 4px 0 0 var(--batch-running); }
    tr.batch-row.batch-live-linked.batch-state-running { background: rgba(34, 197, 94, 0.24); animation: batch-running-pulse 2.4s ease-in-out infinite; }
    tr.batch-row.batch-live-only.batch-state-running { background: rgba(34, 197, 94, 0.24); animation: batch-running-pulse 2.4s ease-in-out infinite; }
    tr.batch-row.batch-live-linked.batch-state-running.batch-running-motion-possibly_stale {
      background: rgba(251, 191, 36, 0.14); animation: batch-running-pulse 3.6s ease-in-out infinite;
    }
    tr.batch-row.batch-live-linked.batch-state-running.batch-running-motion-stalled {
      background: rgba(251, 146, 60, 0.16); animation: none;
    }
    tr.batch-row.batch-live-only.batch-state-running.batch-running-motion-possibly_stale {
      background: rgba(251, 191, 36, 0.14); animation: batch-running-pulse 3.6s ease-in-out infinite;
    }
    tr.batch-row.batch-live-only.batch-state-running.batch-running-motion-stalled {
      background: rgba(251, 146, 60, 0.16); animation: none;
    }
    tr.batch-row.batch-live-linked.batch-state-running td:first-child { box-shadow: inset 4px 0 0 #4ade80; }
    tr.batch-row.batch-live-only.batch-state-running td:first-child { box-shadow: inset 4px 0 0 #4ade80; }
    tr.batch-row.batch-live-linked.batch-state-running.batch-running-motion-possibly_stale td:first-child { box-shadow: inset 4px 0 0 #fbbf24; }
    tr.batch-row.batch-live-linked.batch-state-running.batch-running-motion-stalled td:first-child { box-shadow: inset 4px 0 0 #fb923c; }
    tr.batch-row.batch-live-linked.batch-state-running .batch-status-label { color: #86efac; font-weight: 600; }
    tr.batch-row.batch-live-only.batch-state-running .batch-status-label { color: #86efac; font-weight: 600; }
    .live-jobs-subsection { margin: 0 0 1.1rem; padding-bottom: 0.85rem; border-bottom: 1px solid var(--border); }
    .live-jobs-subsection h3 { font-size: 0.95rem; margin: 0 0 0.45rem; display: flex; align-items: center; gap: 0.45rem; color: #86efac; }
    .live-jobs-inline { margin: 0.35rem 0 0.65rem; padding: 0.45rem 0 0.55rem; border-top: 1px solid var(--border); }
    .live-jobs-inline-heading { font-size: 0.88rem; margin: 0 0 0.35rem; display: flex; align-items: center; gap: 0.45rem; color: #86efac; }
    .live-jobs-note { margin: 0 0 0.55rem; font-size: 0.78rem; }
    .live-source-status { margin: 0 0 0.55rem; padding: 0.55rem 0.7rem; border-radius: 8px; font-size: 0.8rem; line-height: 1.45; border: 1px solid var(--border); }
    .live-source-inline { font-size: 0.78rem; line-height: 1.35; }
    .live-source-inline.live-source-connected { color: #bbf7d0; }
    .live-source-inline.live-source-unavailable { color: #fde68a; }
    .live-source-connected { background: rgba(52, 211, 153, 0.08); border-color: rgba(52, 211, 153, 0.35); color: #bbf7d0; }
    .live-source-unavailable { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.45); color: #fde68a; }
    .live-source-setup { display: block; margin-top: 0.35rem; color: var(--muted); font-size: 0.76rem; }
    .planned-batch-section { margin-top: 0.15rem; }
    .tower-batch-container-title { font-size: 1.05rem; margin: 0 0 0.2rem; display: flex; align-items: center; gap: 0.45rem; color: var(--text); font-weight: 650; }
    .tower-batch-subtitle { margin: 0 0 0.3rem; font-size: 0.82rem; }
    .planned-items-heading { font-size: 0.92rem; margin: 0.25rem 0 0.3rem; display: flex; align-items: center; gap: 0.45rem; }
    .planned-items-note { margin: 0 0 0.45rem; font-size: 0.76rem; }
    .batch-link-hint { display: block; font-size: 0.72rem; margin-top: 0.15rem; }
    .batch-legend-details { margin: 0.45rem 0 0; font-size: 0.78rem; }
    .batch-legend-details summary { cursor: pointer; margin-bottom: 0.25rem; }
    .completed-infra-subsection { margin: 0.85rem 0 0; opacity: 0.88; }
    .completed-infra-subsection summary { cursor: pointer; font-size: 0.82rem; color: var(--muted); margin-bottom: 0.45rem; display: flex; align-items: center; gap: 0.45rem; }
    .completed-infra-note { margin: 0 0 0.45rem; font-size: 0.74rem; }
    tr.batch-row.batch-infra-done { opacity: 0.82; }
    .batch-source-marker { color: #86efac; font-size: 0.72rem; text-transform: lowercase; }
    tr.batch-row.batch-planned .batch-source-marker { color: #bae6fd; }
    @keyframes batch-running-pulse { 0%, 100% { background-color: rgba(34, 197, 94, 0.2); } 50% { background-color: rgba(34, 197, 94, 0.32); } }
    @keyframes tower-header-live-pulse { 0%, 100% { background-color: rgba(34, 197, 94, 0.08); } 50% { background-color: rgba(34, 197, 94, 0.14); } }
    @keyframes tower-header-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes tower-live-dot-pulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); opacity: 1; }
      50% { transform: scale(1.12); box-shadow: 0 0 0 5px rgba(74, 222, 128, 0); opacity: 0.92; }
    }
    @keyframes tower-live-dot-slow {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    @keyframes tower-shimmer { 0% { left: -100%; } 100% { left: 200%; } }
    .tower-running-status {
      display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
      border-radius: 6px; padding: 0.15rem 0.4rem; position: relative; overflow: hidden;
    }
    .tower-running-motion-active {
      background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(74, 222, 128, 0.35);
    }
    .tower-running-motion-active::after {
      content: ""; position: absolute; top: 0; left: -100%; width: 55%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(134, 239, 172, 0.28), transparent);
      animation: tower-shimmer 2.2s ease-in-out infinite; pointer-events: none;
    }
    .tower-running-motion-possibly_stale {
      background: rgba(251, 191, 36, 0.12); border: 1px solid rgba(251, 191, 36, 0.45);
    }
    .tower-running-motion-possibly_stale .tower-live-dot {
      background: #fbbf24; animation: tower-live-dot-slow 2.8s ease-in-out infinite;
    }
    .tower-running-motion-stalled {
      background: rgba(251, 146, 60, 0.14); border: 1px solid rgba(251, 146, 60, 0.5);
    }
    .tower-running-motion-stalled .tower-live-dot {
      background: #fb923c; animation: tower-live-dot-slow 1.8s ease-in-out infinite;
    }
    .tower-live-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; flex-shrink: 0;
      animation: tower-live-dot-pulse 1.4s ease-in-out infinite;
    }
    .tower-running-meta { font-size: 0.75rem; }
    .tower-stale-warn {
      font-size: 0.72rem; font-weight: 650; color: #fb923c; text-transform: uppercase; letter-spacing: 0.03em;
    }
    .tower-stale-warn-soft { color: #fbbf24; }
    @media (prefers-reduced-motion: reduce) {
      tr.batch-row.batch-live-linked.batch-state-running,
      tr.batch-row.batch-live-only.batch-state-running,
      .tower-execution-strip.tone-running.tower-exec-live-active,
      .tower-execution-header.tone-running.tower-exec-live-active,
      .tower-live-dot,
      .tower-running-motion-active::after,
      .tower-execution-strip.tone-running.tower-exec-live-active::after,
      .tower-execution-header.tone-running.tower-exec-live-active::after {
        animation: none !important;
      }
      .tower-live-dot { box-shadow: none; opacity: 1; transform: none; }
    }
    tr.batch-row.batch-state-pending { background: rgba(251, 191, 36, 0.1); }
    tr.batch-row.batch-state-pending td:first-child { box-shadow: inset 3px 0 0 var(--batch-pending); }
    tr.batch-row.batch-state-failed { background: rgba(248, 113, 113, 0.14); }
    tr.batch-row.batch-state-failed td:first-child { box-shadow: inset 3px 0 0 var(--batch-failed); }
    tr.batch-row.batch-state-future { background: rgba(56, 189, 248, 0.1); }
    tr.batch-row.batch-state-future td:first-child { box-shadow: inset 3px 0 0 var(--batch-future); }
    tr.batch-row.batch-state-future td { color: #bae6fd; }
    .batch-task { font-weight: 550; }
    .batch-purpose { font-size: 0.84rem; max-width: 16rem; }
    .batch-meta { font-size: 0.78rem; max-width: 8rem; }
    .batch-status-label { font-size: 0.82rem; }
    .activity-section-secondary { opacity: 0.95; margin-top: 0.85rem; }
    .activity-section-secondary summary { cursor: pointer; color: var(--muted); font-size: 0.88rem; font-weight: 600; margin-bottom: 0.45rem; display: flex; align-items: center; gap: 0.45rem; }
    .tower-secondary { margin-top: 1.25rem; padding: 0.75rem 0; border-top: 1px solid var(--border); }
    .tower-secondary summary { cursor: pointer; color: var(--muted); font-size: 0.88rem; font-weight: 600; margin-bottom: 0.75rem; }
    .tim-action-yes { color: var(--batch-pending); font-weight: 600; font-size: 0.82rem; }
    .tim-action-no { font-size: 0.82rem; }
    .queue-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem; }
    .queue-block h3 { font-size: 0.92rem; margin: 0 0 0.45rem; display: flex; align-items: center; gap: 0.45rem; }
    .queue-block-note, .queue-history-note { margin: 0 0 0.45rem; font-size: 0.78rem; }
    .queue-block table { font-size: 0.82rem; }
    .queue-block th, .queue-block td { padding: 0.45rem 0.65rem; }
    .capacity-block { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.65rem; margin: 0.65rem 0; }
    .stale-code-banner { background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 10px; padding: 0.85rem 1rem; margin-bottom: 1rem; color: #fde68a; }
    .stale-code-banner strong { display: block; font-size: 0.95rem; margin-bottom: 0.35rem; color: #fbbf24; }
    .stale-code-banner p { margin: 0.35rem 0; font-size: 0.88rem; color: var(--text); }
    .stale-file-list { margin: 0.45rem 0 0.55rem; padding-left: 1.2rem; font-size: 0.84rem; }
    .stale-file-list code { font-family: var(--mono); font-size: 0.82rem; }
    .stale-code-banner .cmd { font-family: var(--mono); font-size: 0.84rem; background: #0b1220; border: 1px solid var(--border); border-radius: 6px; padding: 0.45rem 0.55rem; display: block; margin-top: 0.35rem; white-space: pre-wrap; color: var(--text); }
    @media (max-width: 640px) {
      .wrap { padding: 0.75rem 0.55rem 2rem; }
      header { margin-bottom: 1rem; padding-bottom: 0.75rem; }
      header h1 { font-size: 1.2rem; }
      .meta, .nav { font-size: 0.76rem; }
      .nav a { display: inline-block; margin: 0.15rem 0.55rem 0.15rem 0; }
      .tower-execution-strip, .tower-execution-header { padding: 0.45rem 0.55rem; margin-bottom: 0.5rem; }
      .tower-exec-headline { font-size: 0.92rem; }
      .tower-exec-detail-compact { flex-basis: 100%; font-size: 0.76rem; line-height: 1.35; }
      .tower-exec-strip-line2 { font-size: 0.72rem; gap: 0.25rem 0.4rem; margin-top: 0.25rem; }
      .live-source-inline { font-size: 0.72rem; word-break: break-word; }
      .tower-live-dot { width: 7px; height: 7px; }
      .tower-running-status { padding: 0.12rem 0.3rem; gap: 0.3rem; }
      .tower-batch-container-title { font-size: 0.98rem; }
      .tower-batch-subtitle { font-size: 0.74rem; word-break: break-word; }
      .planned-items-heading { font-size: 0.86rem; }
      .batch-table-primary { margin-top: 0.45rem; }
      .batch-task-table { table-layout: fixed; font-size: 0.78rem; }
      .batch-task-table th, .batch-task-table td { padding: 0.42rem 0.38rem; }
      .batch-task-table .col-hide-narrow { display: none; }
      .batch-task-table .col-task { width: 34%; word-break: break-word; max-width: none; }
      .batch-task-table .col-job-id { width: 24%; word-break: break-all; }
      .batch-task-table .col-status { width: 28%; }
      .batch-task-table .col-tim { width: 14%; white-space: nowrap; text-align: center; }
      .batch-task-table .mono { font-size: 0.7rem; }
      .batch-status-label { font-size: 0.76rem; }
      .batch-link-hint { font-size: 0.68rem; }
      .tim-action-yes, .tim-action-no { font-size: 0.76rem; }
      tr.batch-row.batch-live-linked.batch-state-running,
      tr.batch-row.batch-live-only.batch-state-running { animation-duration: 2.8s; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${options.headerExtra || ""}
    <header>
      <h1>${escapeHtml(options.title)}</h1>
      <p class="subtitle">${escapeHtml(options.subtitle)}</p>
      <span class="badge ${options.badgeClass}">${escapeHtml(options.badgeLabel)}</span>
      <p class="meta">${options.meta}</p>
      <p class="nav">${options.navHtml || buildShortStatusNav("live")}</p>
    </header>
    ${summaryGrid}
    ${options.body}
    <p class="footer-note">${escapeHtml(options.footerNote)}</p>
  </div>
  ${options.bodyScript || ""}
</body>
</html>`;
}

function formatControlTowerReport(model) {
  const compact = model.compact || buildCompactControlTowerBlock(model);
  const lines = [
    "=== Control Tower Motion (v0) ===",
    `Now: ${compact.now}`,
    `Swept: ${compact.swept_at}`,
    `Motion: ${compact.motion_state}`,
    `Active: ${compact.active_job_count} | Pending approval: ${compact.pending_approval_count} | Pending/stranded: ${compact.pending_or_stranded_count}`,
    `Actionable attention: ${compact.actionable_attention_count} | Review history: ${compact.review_history_count} | Completed needs review (total): ${compact.completed_needs_review_count} | Failed: ${compact.failed_count}`,
    "",
    `Current focus: ${compact.current_focus}`,
    `Waiting on: ${compact.waiting_on}`,
    `Next owner: ${compact.next_action_owner}`,
    `Next action: ${compact.next_action_text}`,
    "",
    `Lane readiness: ${compact.lane_readiness_summary}`,
  ];

  if (model.next_up.job_id) {
    lines.push(`Next job: ${model.next_up.job_id} | ${model.next_up.title || ""}`);
  }

  lines.push("", "Running now:");
  if (model.running.length === 0) {
    lines.push("(none — workers idle)");
  } else {
    for (const row of model.running) {
      lines.push(
        `${row.id} | profile=${row.profile} | claimed=${row.claimed_at || ""} | ${row.title}`
      );
    }
  }

  lines.push("", "Lanes:");
  if (model.lanes.length === 0) {
    lines.push("(none)");
  } else {
    for (const lane of model.lanes) {
      lines.push(
        `${lane.profile}: running=${lane.running} stranded=${lane.stranded} awaiting=${lane.awaiting_approval} completed=${lane.completed} failed=${lane.failed}`
      );
    }
  }

  lines.push("", "Routes: GET /tower (live) · GET /tower/preview (sample)");

  if (model.activity_log) {
    const log = model.activity_log;
    lines.push(
      "",
      "=== Activity Log (reconstructed) ===",
      `Current state: ${log.current_state} — ${log.current_state_detail}`,
      `Events: ${log.event_count}`
    );
    for (const event of log.events) {
      lines.push(`${event.at_display}  ${event.text}`);
    }
  }

  if (model.current_queue) {
    const queue = model.current_queue;
    const liveOnlyRows = queue.live_only_rows || [];
    const batchRows =
      queue.batch_rows ||
      (queue.batch_sections || []).flatMap((section) => section.items || []);
    const displayRows = queue.display_rows || [...liveOnlyRows, ...batchRows];

    const queueHeader =
      queue.source === "explicit_manifest"
        ? `=== ${queue.label} (explicit manifest) ===`
        : `=== ${queue.label} (reconstructed) ===`;
    lines.push(
      "",
      queueHeader,
      queue.note ||
        (queue.source === "explicit_manifest"
          ? "Current batch manifest — all items in config/tower-current-batch.json; no fixed row limit"
          : "Reconstructed from recent command-channel jobs"),
      `Current state: ${queue.current_state} — ${queue.current_state_detail}`
    );
    if (queue.manifest_item_count != null) {
      lines.push(`Manifest items: ${queue.manifest_item_count}`);
    }
    if (queue.live_only_row_count > 0) {
      lines.push(`Live-only (unmatched): ${queue.live_only_row_count}`);
    }
    if (queue.idle_message) {
      lines.push(queue.idle_message);
    }
    if (queue.execution_header?.label) {
      lines.push(
        `Execution: ${queue.execution_header.label} — ${queue.execution_header.detail || ""}`
      );
      if (queue.execution_header.green_row_count === 0) {
        lines.push("Green rows: 0 (no live worker running)");
      }
    }
    if (queue.review_history_total > 0) {
      lines.push(
        `${queue.review_history_total} older completed job(s) in review history — see Activity Log · not current-batch blockers`
      );
    }
    lines.push("", "Batch rows (live-only → manifest):");
    if (displayRows.length === 0) {
      lines.push("(none)");
    } else {
      for (const row of displayRows) {
        const timAction = row.tim_action_needed ? " · Tim action: yes" : "";
        const source = row.status_source ? ` · ${row.status_source}` : "";
        lines.push(
          `[${row.batch_state || "pending"}] ${row.id} | ${row.plan} | ${row.purpose || "—"} | ${row.status_label || row.hint || row.status}${timAction}${source} | ${row.profile} · ${row.repo}`
        );
      }
    }
  }

  return lines.join("\n");
}

module.exports = {
  LANE_REGISTRY_V0,
  MANIFEST_FILE,
  loadTowerCurrentBatchManifest,
  buildWatchSummary,
  buildTowerSummary,
  buildActivityLog,
  buildCurrentQueue,
  buildCurrentQueueFromManifest,
  deriveTowerExecutionHeader,
  deriveRunningMotionState,
  renderLiveRunningStatusCell,
  renderLiveSourceStatusHtml,
  splitPlannedManifestRows,
  TOWER_EXECUTION_LABELS,
  buildCompactControlTowerBlock,
  buildSampleWatchSummary,
  buildSampleTowerSummary,
  renderWatchHtml,
  renderTowerHtml,
  renderLocalLiveLandingHtml,
  formatControlTowerReport,
};
