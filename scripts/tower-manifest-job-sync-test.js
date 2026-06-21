#!/usr/bin/env node

const { STATUS_CATEGORIES, classifyJob, summarizeJobs } = require("../lib/command-channel-status");
const {
  buildJobIndex,
  resolveManifestItemRow,
  resolveManifestLinkedJob,
  parseTowerItemTags,
  jobMatchesManifestItem,
  loadTowerCurrentBatchManifest,
  buildUnmatchedLiveJobRows,
} = require("../lib/tower-current-batch-manifest");
const {
  buildCurrentQueueFromManifest,
  deriveTowerExecutionHeader,
  deriveRunningMotionState,
  renderLiveRunningStatusCell,
  renderLiveSourceStatusHtml,
  buildSampleTowerSummary,
  renderTowerHtml,
  splitPlannedManifestRows,
  TOWER_EXECUTION_LABELS,
} = require("../lib/command-channel-short-status-page");
const { summarizeTimeSweep } = require("../lib/command-channel-time-sweep");
const {
  buildLiveSourceMeta,
  fetchLiveJobsForDisplay,
  httpListJobs,
  mapListFetchError,
  classifyHttpListFailure,
  MISSING_LIST_AUTH_MESSAGE,
} = require("../lib/command-channel-live-jobs-source");
const { BATCH_STATES } = {
  BATCH_STATES: {
    COMPLETED: "completed",
    RUNNING: "running",
    PENDING: "pending",
    FAILED: "failed",
    FUTURE: "future",
  },
};

function assertCase(name, condition, details = "") {
  return { name, passed: Boolean(condition), details };
}

function formatBatchTaskEntry(classified, options = {}) {
  const job = classified?.job || classified;
  if (!job?.id) {
    return null;
  }
  return {
    id: job.id,
    profile: job.target_worker_profile || "—",
    repo: job.repo_ref || "—",
    plan: job.plan_summary || "—",
    purpose: "—",
    status: job.status || "—",
    status_label: options.status_label || job.status,
    batch_state: options.batch_state || "pending",
    tim_action_needed: options.tim_action_needed === true,
    hint: options.hint || options.status_label || job.status,
    at: job.claimed_at || job.updated_at || job.created_at,
  };
}

function sampleClaimedJob(overrides = {}) {
  return {
    id: "9c0a2526-122c-416e-b895-a4036a1f9b9c",
    status: "claimed",
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    requested_by: "xiaoju",
    task_type: "supervised_implement",
    plan_summary:
      "Implement Tower manifest/job live status sync [tower_item:tower_manifest_job_sync]",
    prompt:
      "Implement Tower manifest/job live status sync.\n\n[tower_item:tower_manifest_job_sync]",
    claimed_at: "2026-06-21T11:00:00.000Z",
    claimed_by: "joa",
    updated_at: "2026-06-21T11:04:00.000Z",
    created_at: "2026-06-21T10:52:17.008+00:00",
    approval_required: true,
    approval_status: "approved",
    ...overrides,
  };
}

const TEST_NOW_MS = Date.parse("2026-06-21T11:05:00.000Z");

async function runTests() {
  const results = [];

  const tags = parseTowerItemTags(
    "Plan text [tower_item:tower_manifest_job_sync] end"
  );
  results.push(
    assertCase(
      "parseTowerItemTags extracts tower_item key",
      tags.has("tower_manifest_job_sync"),
      [...tags].join(", ")
    )
  );

  const manifestItem = {
    order: 8,
    key: "tower_manifest_job_sync",
    task_title: "Tower manifest/job live status sync",
    purpose: "Live sync test purpose",
    profile: "joa",
    project: "TimOS-Agent",
    linked_job_ids: [],
    matchers: ["tower_manifest_job_sync", "manifest/job live status"],
    intended_status: "running",
  };

  const claimedJob = sampleClaimedJob();
  const classified = classifyJob(claimedJob);
  results.push(
    assertCase(
      "sample job classifies as claimed_running",
      classified.category === STATUS_CATEGORIES.CLAIMED_RUNNING,
      classified.category
    )
  );

  results.push(
    assertCase(
      "jobMatchesManifestItem matches tower_item tag",
      jobMatchesManifestItem(manifestItem, classified),
      claimedJob.id
    )
  );

  const jobIndex = buildJobIndex(null, [claimedJob]);
  const linked = resolveManifestLinkedJob(manifestItem, jobIndex);
  results.push(
    assertCase(
      "resolveManifestLinkedJob finds claimed job by tag",
      linked.classified?.job?.id === claimedJob.id,
      linked.match_kind || "no match"
    )
  );
  results.push(
    assertCase(
      "match kind is tower_item_tag",
      linked.match_kind === "tower_item_tag",
      linked.match_kind || "—"
    )
  );

  const row = resolveManifestItemRow(manifestItem, {
    jobIndex,
    runningTooLongIds: new Set(),
    urgentReviewIds: new Set(),
    firstStrandedJobId: null,
    formatBatchTaskEntry,
    BATCH_STATES,
  });

  results.push(
    assertCase(
      "matched row is live-linked with job id",
      row?.live_linked === true && row?.id === claimedJob.id,
      `${row?.live_linked} · ${row?.id}`
    )
  );
  results.push(
    assertCase(
      "matched row status source is manifest + live",
      row?.status_source === "manifest + live",
      row?.status_source || "—"
    )
  );
  results.push(
    assertCase(
      "matched running row uses green running batch_state",
      row?.batch_state === BATCH_STATES.RUNNING,
      row?.batch_state || "—"
    )
  );
  results.push(
    assertCase(
      "matched running row status label includes live",
      String(row?.status_label || "").includes("live"),
      row?.status_label || "—"
    )
  );
  results.push(
    assertCase(
      "matched running row status label uses Running · live",
      String(row?.status_label || "") === "Running · live",
      row?.status_label || "—"
    )
  );
  results.push(
    assertCase(
      "matched running row exposes job timestamps for motion",
      row?.job_claimed_at && row?.job_updated_at,
      `${row?.job_claimed_at} · ${row?.job_updated_at}`
    )
  );
  results.push(
    assertCase(
      "fresh claimed row motion state is active",
      deriveRunningMotionState(row, TEST_NOW_MS) === "active",
      deriveRunningMotionState(row, TEST_NOW_MS)
    )
  );
  const runningStatusHtml = renderLiveRunningStatusCell(row, TEST_NOW_MS);
  results.push(
    assertCase(
      "live running status cell includes heartbeat dot",
      runningStatusHtml.includes("tower-live-dot") &&
        runningStatusHtml.includes("tower-running-motion-active"),
      runningStatusHtml.slice(0, 120)
    )
  );

  const emptyJobIndex = new Map();
  const runningUnmatchedRow = resolveManifestItemRow(manifestItem, {
    jobIndex: emptyJobIndex,
    runningTooLongIds: new Set(),
    urgentReviewIds: new Set(),
    firstStrandedJobId: null,
    formatBatchTaskEntry,
    BATCH_STATES,
  });
  results.push(
    assertCase(
      "unmatched intended_status=running must not render green",
      runningUnmatchedRow?.batch_state !== BATCH_STATES.RUNNING,
      runningUnmatchedRow?.batch_state || "—"
    )
  );
  results.push(
    assertCase(
      "unmatched intended_status=running uses blue future/next state",
      runningUnmatchedRow?.batch_state === BATCH_STATES.FUTURE,
      runningUnmatchedRow?.batch_state || "—"
    )
  );
  results.push(
    assertCase(
      "unmatched intended_status=running shows Planned / not launched label",
      String(runningUnmatchedRow?.status_label || "").includes("Planned / not launched") &&
        !String(runningUnmatchedRow?.status_label || "").toLowerCase().includes("in queue"),
      runningUnmatchedRow?.status_label || "—"
    )
  );
  results.push(
    assertCase(
      "unmatched manifest row includes no live job linked hint",
      runningUnmatchedRow?.link_hint === "No live job linked",
      runningUnmatchedRow?.link_hint || "—"
    )
  );
  results.push(
    assertCase(
      "matched manifest row includes linked job hint",
      row?.link_hint === `Linked job: ${claimedJob.id.slice(0, 8)}`,
      row?.link_hint || "—"
    )
  );

  const manifest = loadTowerCurrentBatchManifest();
  if (manifest?.items?.length) {
    const allPlannedRows = manifest.items.map((item) =>
      resolveManifestItemRow(item, {
        jobIndex: emptyJobIndex,
        runningTooLongIds: new Set(),
        urgentReviewIds: new Set(),
        firstStrandedJobId: null,
        formatBatchTaskEntry,
        BATCH_STATES,
      })
    );
    const anyGreenWithoutLive = allPlannedRows.some(
      (r) => r?.batch_state === BATCH_STATES.RUNNING
    );
    results.push(
      assertCase(
        "no manifest row is green when no live running jobs exist",
        !anyGreenWithoutLive,
        `${allPlannedRows.filter((r) => r?.batch_state === BATCH_STATES.RUNNING).length} green row(s)`
      )
    );
    results.push(
      assertCase(
        "manifest includes all expected current-batch items (17 rows)",
        manifest.items.length === 17,
        `count=${manifest.items.length}`
      )
    );
    const titles = manifest.items.map((i) => i.task_title);
    results.push(
      assertCase(
        "manifest includes status vocabulary cleanup item",
        titles.some((t) => t.includes("status vocabulary")),
        titles.join("; ")
      )
    );
    results.push(
      assertCase(
        "manifest includes stuck-green fix item",
        titles.some((t) => t.includes("stuck-green")),
        titles.join("; ")
      )
    );
    results.push(
      assertCase(
        "manifest includes XiaoJu Status Context item",
        titles.some((t) => t.includes("Status Context")),
        titles.join("; ")
      )
    );
    results.push(
      assertCase(
        "manifest includes Station 4/5 Taiwan-trip item",
        titles.some((t) => t.includes("Station 4/5")),
        titles.join("; ")
      )
    );
  }

  const pendingManifestItem = {
    order: 99,
    task_title: "Unrelated future task with no matchers",
    purpose: "Should stay planned",
    intended_status: "pending",
    linked_job_ids: [],
  };
  const pendingRow = resolveManifestItemRow(pendingManifestItem, {
    jobIndex,
    runningTooLongIds: new Set(),
    urgentReviewIds: new Set(),
    firstStrandedJobId: null,
    formatBatchTaskEntry,
    BATCH_STATES,
  });
  results.push(
    assertCase(
      "unmatched manifest row stays planned without job id",
      pendingRow?.live_linked === false &&
        pendingRow?.id === "—" &&
        pendingRow?.status_source === "planned",
      `${pendingRow?.status_source} · ${pendingRow?.id}`
    )
  );
  results.push(
    assertCase(
      "unmatched manifest row shows planned status label",
      String(pendingRow?.status_label || "").includes("planned"),
      pendingRow?.status_label || "—"
    )
  );
  results.push(
    assertCase(
      "unmatched pending row uses blue future state",
      pendingRow?.batch_state === BATCH_STATES.FUTURE,
      pendingRow?.batch_state || "—"
    )
  );

  const explicitItem = {
    ...manifestItem,
    linked_job_ids: [claimedJob.id],
  };
  const explicitLinked = resolveManifestLinkedJob(explicitItem, jobIndex);
  results.push(
    assertCase(
      "explicit linked_job_ids resolve to job",
      explicitLinked.classified?.job?.id === claimedJob.id,
      explicitLinked.match_kind || "—"
    )
  );
  results.push(
    assertCase(
      "explicit link match kind is linked_job_id",
      explicitLinked.match_kind === "linked_job_id",
      explicitLinked.match_kind || "—"
    )
  );

  const strandedJob = {
    id: "b1c2d3e4-5678-90ab-cdef-111111111111",
    status: "pending",
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    task_type: "supervised_implement",
    plan_summary: "Stranded approved job waiting for worker",
    approval_required: true,
    approval_status: "approved",
    approved_at: "2026-06-21T11:00:00.000Z",
    created_at: "2026-06-21T10:55:00.000Z",
    updated_at: "2026-06-21T11:00:00.000Z",
    errors: [],
  };
  const idleSummary = summarizeJobs([strandedJob]);
  const idleTimeSummary = summarizeTimeSweep([strandedJob], { nowMs: TEST_NOW_MS });
  const idleManifest = {
    batch_name: "header idle test",
    items: [
      {
        order: 1,
        key: "idle_test_item",
        task_title: "Idle manifest row",
        purpose: "Should stay blue when no live worker",
        intended_status: "pending",
        linked_job_ids: [],
      },
    ],
  };
  const idleQueue = buildCurrentQueueFromManifest(
    idleManifest,
    idleSummary,
    idleTimeSummary,
    "needs_attention",
    { jobs: [strandedJob], generated_at: "2026-06-21T11:05:00.000Z" }
  );
  const idleGreenRows = (idleQueue.batch_rows || []).filter(
    (row) => row.batch_state === BATCH_STATES.RUNNING
  );
  results.push(
    assertCase(
      "no live running job yields zero green rows",
      idleGreenRows.length === 0,
      `${idleGreenRows.length} green row(s)`
    )
  );
  results.push(
    assertCase(
      "no live running job header says No worker running",
      idleQueue.execution_header?.label === TOWER_EXECUTION_LABELS.NO_WORKER ||
        idleQueue.execution_header?.label === TOWER_EXECUTION_LABELS.WAITING_TIM,
      idleQueue.execution_header?.label || "—"
    )
  );
  results.push(
    assertCase(
      "idle header reports zero green rows",
      idleQueue.execution_header?.green_row_count === 0,
      String(idleQueue.execution_header?.green_row_count)
    )
  );

  const runningSummary = summarizeJobs([claimedJob]);
  const runningTimeSummary = summarizeTimeSweep([claimedJob], { nowMs: TEST_NOW_MS });
  const runningManifest = {
    batch_name: "header running test",
    items: [manifestItem],
  };
  const runningQueue = buildCurrentQueueFromManifest(
    runningManifest,
    runningSummary,
    runningTimeSummary,
    "running",
    {
      jobs: [claimedJob],
      generated_at: "2026-06-21T11:05:00.000Z",
      nowMs: TEST_NOW_MS,
    }
  );
  const runningGreenRows = (runningQueue.batch_rows || []).filter(
    (row) => row.batch_state === BATCH_STATES.RUNNING && row.live_linked
  );
  results.push(
    assertCase(
      "claimed live job yields one green row",
      runningGreenRows.length === 1,
      `${runningGreenRows.length} green row(s)`
    )
  );
  results.push(
    assertCase(
      "claimed live job header says Running",
      runningQueue.execution_header?.label === TOWER_EXECUTION_LABELS.RUNNING,
      runningQueue.execution_header?.label || "—"
    )
  );
  results.push(
    assertCase(
      "claimed live job header motion state is active",
      runningQueue.execution_header?.running_motion_state === "active",
      runningQueue.execution_header?.running_motion_state || "—"
    )
  );

  const staleRow = {
    ...row,
    job_updated_at: "2026-06-21T09:00:00.000Z",
    running_too_long: false,
  };
  results.push(
    assertCase(
      "old job update yields possibly_stale motion",
      deriveRunningMotionState(staleRow, Date.parse("2026-06-21T11:05:00.000Z")) ===
        "possibly_stale",
      deriveRunningMotionState(staleRow, Date.parse("2026-06-21T11:05:00.000Z"))
    )
  );
  results.push(
    assertCase(
      "running too long yields stalled motion",
      deriveRunningMotionState({ ...row, running_too_long: true }) === "stalled",
      deriveRunningMotionState({ ...row, running_too_long: true })
    )
  );

  const sampleTowerHtml = renderTowerHtml(buildSampleTowerSummary());
  results.push(
    assertCase(
      "sample tower HTML includes live running motion markup",
      sampleTowerHtml.includes("tower-live-dot") &&
        sampleTowerHtml.includes("tower-running-motion-"),
      "missing motion classes"
    )
  );
  results.push(
    assertCase(
      "sample tower HTML includes reduced-motion CSS",
      sampleTowerHtml.includes("prefers-reduced-motion"),
      "missing reduced-motion media query"
    )
  );
  results.push(
    assertCase(
      "idle queue HTML has no live running motion badge",
      !renderTowerHtml({
        data_mode: "sample",
        swept_at: "2026-06-21T11:05:00.000Z",
        motion: {
          system_state: "needs_attention",
          running_count: 0,
          stranded_count: 1,
          awaiting_approval_count: 0,
          pending_or_stranded_count: 0,
          completed_needs_review_count: 0,
          review_history_count: 0,
          failed_count: 0,
          actionable_attention_count: 0,
        },
        running: [],
        next_up: { owner: "joa loop", action: "Claim next approved job" },
        waiting_on: "worker loop",
        current_focus: "Stranded approved job",
        lane_readiness_summary: "",
        parallel_capacity: {},
        lane_registry: [],
        lanes: [],
        activity_log: { events: [], event_count: 0 },
        current_queue: idleQueue,
      }).includes("batch-running-motion-active"),
      "unexpected active motion on idle view"
    )
  );

  const idleHeaderDirect = deriveTowerExecutionHeader(
    idleSummary,
    idleTimeSummary,
    { batch_rows: idleQueue.batch_rows, manifest_item_count: 1 },
    { generated_at: "2026-06-21T11:05:00.000Z" }
  );
  results.push(
    assertCase(
      "deriveTowerExecutionHeader idle label matches",
      idleHeaderDirect.label === TOWER_EXECUTION_LABELS.NO_WORKER,
      idleHeaderDirect.label || "—"
    )
  );

  const smokeTestJob = {
    id: "7510ed9c-fcaf-4d51-a847-f10868331ebe",
    status: "claimed",
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    requested_by: "xiaoju",
    task_type: "supervised_implement",
    plan_summary: "Fix Tower unmatched live-job visibility",
    prompt: "Fix Tower unmatched live-job visibility.\n\nRead-only smoke test.",
    claimed_at: "2026-06-21T12:04:39.055Z",
    claimed_by: "joa",
    updated_at: "2026-06-21T12:04:45.000Z",
    created_at: "2026-06-21T12:06:59.327+00:00",
    approval_required: true,
    approval_status: "approved",
    approved_at: "2026-06-21T12:07:02.662Z",
    errors: [],
  };
  const unmatchedManifest = {
    batch_name: "unmatched live test",
    items: [
      {
        order: 1,
        key: "unrelated_item",
        task_title: "Unrelated manifest task",
        purpose: "No match to smoke test",
        intended_status: "pending",
        linked_job_ids: [],
      },
    ],
  };
  const unmatchedNowMs = Date.parse("2026-06-21T12:05:00.000Z");
  const unmatchedSummary = summarizeJobs([smokeTestJob]);
  const unmatchedTimeSummary = summarizeTimeSweep([smokeTestJob], {
    nowMs: unmatchedNowMs,
  });
  const unmatchedQueue = buildCurrentQueueFromManifest(
    unmatchedManifest,
    unmatchedSummary,
    unmatchedTimeSummary,
    "running",
    {
      jobs: [smokeTestJob],
      generated_at: "2026-06-21T12:05:00.000Z",
      nowMs: unmatchedNowMs,
    }
  );
  const unmatchedLiveRows = unmatchedQueue.live_only_rows || [];
  const unmatchedDynamicRow = unmatchedLiveRows.find(
    (row) => row.id === smokeTestJob.id
  );
  results.push(
    assertCase(
      "unmatched claimed job appears as dynamic live-only row",
      unmatchedDynamicRow?.row_source === "dynamic_live" &&
        unmatchedDynamicRow?.status_source === "command-channel live",
      `${unmatchedDynamicRow?.row_source || "—"} · ${unmatchedDynamicRow?.status_source || "—"}`
    )
  );
  results.push(
    assertCase(
      "unmatched claimed job is green running row",
      unmatchedDynamicRow?.batch_state === BATCH_STATES.RUNNING &&
        unmatchedDynamicRow?.live_linked === true,
      `${unmatchedDynamicRow?.batch_state || "—"} · live=${unmatchedDynamicRow?.live_linked}`
    )
  );
  results.push(
    assertCase(
      "unmatched claimed job contributes to Running header",
      unmatchedQueue.execution_header?.label === TOWER_EXECUTION_LABELS.RUNNING,
      unmatchedQueue.execution_header?.label || "—"
    )
  );
  results.push(
    assertCase(
      "unmatched claimed job increments green row count",
      unmatchedQueue.execution_header?.green_row_count === 1,
      String(unmatchedQueue.execution_header?.green_row_count)
    )
  );
  results.push(
    assertCase(
      "unmatched claimed job motion state is active",
      deriveRunningMotionState(unmatchedDynamicRow, unmatchedNowMs) === "active",
      deriveRunningMotionState(unmatchedDynamicRow, unmatchedNowMs)
    )
  );
  const unmatchedRunningHtml = renderLiveRunningStatusCell(
    unmatchedDynamicRow,
    unmatchedNowMs
  );
  results.push(
    assertCase(
      "unmatched claimed job running cell has motion markup",
      unmatchedRunningHtml.includes("tower-live-dot") &&
        unmatchedRunningHtml.includes("tower-running-motion-active"),
      unmatchedRunningHtml.slice(0, 120)
    )
  );
  const unmatchedTowerHtml = renderTowerHtml({
    data_mode: "sample",
    swept_at: "2026-06-21T12:05:00.000Z",
    motion: {
      system_state: "running",
      running_count: 1,
      stranded_count: 0,
      awaiting_approval_count: 0,
      pending_or_stranded_count: 0,
      completed_needs_review_count: 0,
      review_history_count: 0,
      failed_count: 0,
      actionable_attention_count: 0,
    },
    running: [{ id: smokeTestJob.id, profile: "joa", title: smokeTestJob.plan_summary }],
    next_up: { owner: "joa", action: "Finish in-progress job", job_id: smokeTestJob.id },
    waiting_on: "joa",
    current_focus: smokeTestJob.plan_summary,
    lane_readiness_summary: "",
    parallel_capacity: {},
    lane_registry: [],
    lanes: [],
    activity_log: { events: [], event_count: 0 },
    current_queue: unmatchedQueue,
  });
  results.push(
    assertCase(
      "tower HTML renders unmatched live jobs in main planned table",
      unmatchedTowerHtml.includes("batch-live-only") &&
        !unmatchedTowerHtml.includes("Live command-channel jobs"),
      "dynamic rows should be in main table, not a separate live section"
    )
  );
  results.push(
    assertCase(
      "tower HTML renders planned batch items immediately after status strip",
      (() => {
        const stripIdx = unmatchedTowerHtml.indexOf("tower-execution-strip");
        const plannedIdx = unmatchedTowerHtml.indexOf("Planned Batch Items");
        return stripIdx >= 0 && plannedIdx > stripIdx;
      })(),
      "planned items not after execution strip"
    )
  );
  results.push(
    assertCase(
      "idle tower HTML omits empty live jobs block",
      !renderTowerHtml({
        data_mode: "sample",
        swept_at: "2026-06-21T11:05:00.000Z",
        motion: {
          system_state: "needs_attention",
          running_count: 0,
          stranded_count: 0,
          awaiting_approval_count: 0,
          pending_or_stranded_count: 0,
          completed_needs_review_count: 0,
          review_history_count: 0,
          failed_count: 0,
          actionable_attention_count: 0,
        },
        running: [],
        next_up: { owner: "none", action: "No queued work" },
        waiting_on: "none",
        current_focus: "",
        lane_readiness_summary: "",
        parallel_capacity: {},
        lane_registry: [],
        lanes: [],
        activity_log: { events: [], event_count: 0 },
        current_queue: idleQueue,
      }).includes("(no live command-channel jobs right now)"),
      "empty live jobs placeholder still rendered"
    )
  );
  results.push(
    assertCase(
      "tower HTML renders planned batch items subsection",
      unmatchedTowerHtml.includes("Planned Batch Items") &&
        unmatchedTowerHtml.includes("Tower Current Batch"),
      "missing planned batch or container heading"
    )
  );
  results.push(
    assertCase(
      "tower HTML does not use old parent-like batch manifest rows heading",
      !unmatchedTowerHtml.includes("Batch manifest rows") &&
        !unmatchedTowerHtml.includes("Tower current batch manifest (full list)"),
      "old parent-like labels still present"
    )
  );
  results.push(
    assertCase(
      "tower HTML includes smoke test job id in dynamic row",
      unmatchedTowerHtml.includes(smokeTestJob.id),
      smokeTestJob.id
    )
  );

  const emptyLiveIndex = buildJobIndex(null, []);
  const noLiveRows = buildUnmatchedLiveJobRows(
    unmatchedManifest,
    emptyLiveIndex,
    {
      jobIndex: emptyLiveIndex,
      runningTooLongIds: new Set(),
      urgentReviewIds: new Set(),
      firstStrandedJobId: null,
      formatBatchTaskEntry,
      BATCH_STATES,
    },
    { nowMs: unmatchedNowMs }
  );
  results.push(
    assertCase(
      "no live jobs yields zero dynamic live-only rows",
      noLiveRows.length === 0,
      `${noLiveRows.length} row(s)`
    )
  );

  if (manifest?.items?.length) {
    const emptyJobIndexForSplit = buildJobIndex(null, []);
    const allManifestDisplayRows = manifest.items.map((item) =>
      resolveManifestItemRow(item, {
        jobIndex: emptyJobIndexForSplit,
        runningTooLongIds: new Set(),
        urgentReviewIds: new Set(),
        firstStrandedJobId: null,
        formatBatchTaskEntry,
        BATCH_STATES,
      })
    );
    const split = splitPlannedManifestRows(allManifestDisplayRows);
    results.push(
      assertCase(
        "all manifest rows remain visible after active/infrastructure split",
        split.activePlannedRows.length + split.completedInfraRows.length ===
          manifest.items.length,
        `active=${split.activePlannedRows.length} infra=${split.completedInfraRows.length} total=${manifest.items.length}`
      )
    );
    results.push(
      assertCase(
        "manifest row 7 renamed to infrastructure label",
        manifest.items.some((item) =>
          String(item.task_title || "").includes("Batch manifest data source")
        ),
        manifest.items.find((item) => item.order === 7)?.task_title || "—"
      )
    );
    results.push(
      assertCase(
        "old parent-like manifest row title removed from config",
        !manifest.items.some((item) =>
          String(item.task_title || "").includes(
            "Tower current batch manifest (full list)"
          )
        ),
        manifest.items.find((item) => item.order === 7)?.task_title || "—"
      )
    );
    const sampleTowerIaHtml = renderTowerHtml(buildSampleTowerSummary());
    results.push(
      assertCase(
        "sample tower HTML includes planned batch section label",
        sampleTowerIaHtml.includes("Planned Batch Items"),
        "missing planned batch section label in sample view"
      )
    );
    results.push(
      assertCase(
        "sample tower HTML shows completed infrastructure collapsed section",
        sampleTowerIaHtml.includes("Completed infrastructure"),
        "missing completed infrastructure subsection"
      )
    );
  }

  const unmatchedManifestForStates = {
    batch_name: "state visibility test",
    items: [
      {
        order: 1,
        key: "unrelated_only",
        task_title: "Unrelated planned task",
        purpose: "No match",
        intended_status: "pending",
        linked_job_ids: [],
      },
    ],
  };
  const stateTestContext = {
    runningTooLongIds: new Set(),
    urgentReviewIds: new Set(),
    firstStrandedJobId: null,
    formatBatchTaskEntry,
    jobTitleFn: (job) => job.plan_summary || job.id,
    BATCH_STATES,
  };
  const stateTestNowMs = Date.parse("2026-06-21T12:30:00.000Z");

  const awaitingApprovalJob = {
    id: "aa111111-1111-4111-8111-111111111111",
    status: "pending",
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    requested_by: "xiaoju",
    task_type: "supervised_implement",
    plan_summary: "Smoke test awaiting approval visibility",
    approval_required: true,
    approval_status: "pending",
    created_at: "2026-06-21T12:25:00.000Z",
    updated_at: "2026-06-21T12:25:00.000Z",
    errors: [],
  };
  const awaitingSummary = summarizeJobs([awaitingApprovalJob]);
  const awaitingTimeSummary = summarizeTimeSweep([awaitingApprovalJob], {
    nowMs: stateTestNowMs,
  });
  const awaitingQueue = buildCurrentQueueFromManifest(
    unmatchedManifestForStates,
    awaitingSummary,
    awaitingTimeSummary,
    "needs_attention",
    {
      jobs: [awaitingApprovalJob],
      generated_at: "2026-06-21T12:30:00.000Z",
      nowMs: stateTestNowMs,
    }
  );
  const awaitingRow = (awaitingQueue.live_only_rows || []).find(
    (row) => row.id === awaitingApprovalJob.id
  );
  results.push(
    assertCase(
      "unmatched awaiting_approval job appears in live-only rows",
      awaitingRow?.row_source === "dynamic_live" &&
        awaitingRow?.batch_state === BATCH_STATES.PENDING &&
        awaitingRow?.tim_action_needed === true,
      `${awaitingRow?.row_source || "—"} · ${awaitingRow?.batch_state || "—"}`
    )
  );

  const approvedPendingJob = {
    id: "bb222222-2222-4222-8222-222222222222",
    status: "pending",
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    requested_by: "xiaoju",
    task_type: "supervised_implement",
    plan_summary: "Smoke test approved pending claim visibility",
    approval_required: true,
    approval_status: "approved",
    approved_at: "2026-06-21T12:26:00.000Z",
    created_at: "2026-06-21T12:25:30.000Z",
    updated_at: "2026-06-21T12:26:00.000Z",
    errors: [],
  };
  const approvedSummary = summarizeJobs([approvedPendingJob]);
  const approvedTimeSummary = summarizeTimeSweep([approvedPendingJob], {
    nowMs: stateTestNowMs,
  });
  const approvedQueue = buildCurrentQueueFromManifest(
    unmatchedManifestForStates,
    approvedSummary,
    approvedTimeSummary,
    "needs_attention",
    {
      jobs: [approvedPendingJob],
      generated_at: "2026-06-21T12:30:00.000Z",
      nowMs: stateTestNowMs,
    }
  );
  const approvedRow = (approvedQueue.live_only_rows || []).find(
    (row) => row.id === approvedPendingJob.id
  );
  results.push(
    assertCase(
      "unmatched pending/approved job appears in live-only rows",
      approvedRow?.row_source === "dynamic_live" &&
        approvedRow?.batch_state === BATCH_STATES.PENDING,
      `${approvedRow?.row_source || "—"} · ${approvedRow?.status_label || "—"}`
    )
  );
  results.push(
    assertCase(
      "unmatched pending/approved job shows Pending live label",
      String(approvedRow?.status_label || "") === "Pending live",
      approvedRow?.status_label || "—"
    )
  );

  const unavailableLiveSourceHtml = renderLiveSourceStatusHtml(
    buildLiveSourceMeta({
      status: "fetch_error",
      mode: "remote-http",
      job_count: 0,
      refreshed_at: "2026-06-21T12:30:00.000Z",
      message: "remote-jobs list failed (503)",
      setup: "Restart npm run server:command-channel from a token-loaded shell.",
    }),
    true
  );
  const unavailableTowerHtml = renderTowerHtml({
    data_mode: "live",
    live_access: "local_loopback",
    swept_at: "2026-06-21T12:30:00.000Z",
    live_source: buildLiveSourceMeta({
      status: "fetch_error",
      mode: "remote-http",
      job_count: 0,
      refreshed_at: "2026-06-21T12:30:00.000Z",
      message: "remote-jobs list failed (503)",
      setup: "Restart npm run server:command-channel from a token-loaded shell.",
    }),
    motion: {
      system_state: "idle",
      running_count: 0,
      stranded_count: 0,
      awaiting_approval_count: 0,
      pending_or_stranded_count: 0,
      completed_needs_review_count: 0,
      review_history_count: 0,
      failed_count: 0,
      actionable_attention_count: 0,
    },
    running: [],
    next_up: { owner: "none", action: "No queued work" },
    waiting_on: "none",
    current_focus: "",
    lane_readiness_summary: "",
    parallel_capacity: {},
    lane_registry: [],
    lanes: [],
    activity_log: { events: [], event_count: 0 },
    current_queue: buildCurrentQueueFromManifest(
      unmatchedManifestForStates,
      summarizeJobs([]),
      summarizeTimeSweep([], { nowMs: stateTestNowMs }),
      "idle",
      {
        jobs: [],
        generated_at: "2026-06-21T12:30:00.000Z",
        nowMs: stateTestNowMs,
      }
    ),
  });
  results.push(
    assertCase(
      "live source unavailable renders explicit warning",
      unavailableLiveSourceHtml.includes("Live source: fetch error") &&
        unavailableLiveSourceHtml.includes("live-source-unavailable"),
      unavailableLiveSourceHtml.slice(0, 120)
    )
  );
  results.push(
    assertCase(
      "tower HTML shows live source warning in strip when fetch fails",
      unavailableTowerHtml.includes("Live source: fetch error") &&
        unavailableTowerHtml.includes("tower-execution-strip"),
      "missing live source warning in tower HTML strip"
    )
  );

  const unauthorizedFailure = classifyHttpListFailure(
    401,
    "env:XIAOJU_ACTION_TOKEN"
  );
  results.push(
    assertCase(
      "401 Unauthorized maps to auth_unauthorized live status",
      unauthorizedFailure.liveStatus === "auth_unauthorized" &&
        !unauthorizedFailure.message.includes('{"error"'),
      unauthorizedFailure.message
    )
  );
  results.push(
    assertCase(
      "401 diagnostic names auth variable only",
      unauthorizedFailure.message.includes("XIAOJU_ACTION_TOKEN") &&
        !unauthorizedFailure.message.includes("Bearer"),
      unauthorizedFailure.message
    )
  );

  const missingAuthFailure = mapListFetchError(
    { code: "auth_missing_list" },
    null
  );
  results.push(
    assertCase(
      "missing list auth maps to auth_missing with variable names only",
      missingAuthFailure.liveStatus === "auth_missing" &&
        missingAuthFailure.message === MISSING_LIST_AUTH_MESSAGE &&
        missingAuthFailure.message.includes("XIAOJU_ACTION_TOKEN") &&
        missingAuthFailure.message.includes("xiaoju-command-channel"),
      missingAuthFailure.message
    )
  );

  const unauthorizedLiveSourceHtml = renderLiveSourceStatusHtml(
    buildLiveSourceMeta({
      status: "auth_unauthorized",
      mode: "remote-http",
      job_count: 0,
      refreshed_at: "2026-06-21T12:30:00.000Z",
      message: unauthorizedFailure.message,
      setup: unauthorizedFailure.setup,
    }),
    true
  );
  results.push(
    assertCase(
      "401 live source renders auth invalid compact label",
      unauthorizedLiveSourceHtml.includes("Live source: auth invalid") &&
        unauthorizedLiveSourceHtml.includes("401 Unauthorized") &&
        !unauthorizedLiveSourceHtml.includes('{"error"'),
      unauthorizedLiveSourceHtml.slice(0, 140)
    )
  );

  const savedEnv = {
    XIAOJU_ACTION_TOKEN: process.env.XIAOJU_ACTION_TOKEN,
    COMMAND_CHANNEL_URL: process.env.COMMAND_CHANNEL_URL,
    COMMAND_CHANNEL_HTTP_URL: process.env.COMMAND_CHANNEL_HTTP_URL,
  };
  delete process.env.XIAOJU_ACTION_TOKEN;
  delete process.env.COMMAND_CHANNEL_URL;
  delete process.env.COMMAND_CHANNEL_HTTP_URL;

  process.env.XIAOJU_ACTION_TOKEN = "remote-test-token";
  process.env.COMMAND_CHANNEL_URL = "https://example.test/api/command-channel";

  let remoteFetchRejected401 = false;
  try {
    await httpListJobs(
      {},
      {
        loadEnv: false,
        tokenResult: { token: "test-token-not-real", source: "env:XIAOJU_ACTION_TOKEN" },
        baseUrl: "https://example.test/api/command-channel",
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: "Unauthorized" }),
        }),
      }
    );
  } catch (err) {
    remoteFetchRejected401 =
      err.code === "auth_unauthorized" &&
      err.liveStatus === "auth_unauthorized" &&
      !String(err.message).includes('{"error"');
  }

  results.push(
    assertCase(
      "httpListJobs 401 throws auth_unauthorized not raw JSON message",
      remoteFetchRejected401,
      "expected auth_unauthorized throw"
    )
  );

  const remote401Display = await fetchLiveJobsForDisplay(
    {},
    {
      loadEnv: false,
      forceRemote: true,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "Unauthorized" }),
      }),
    }
  );
  results.push(
    assertCase(
      "remote 401 live source keeps zero jobs with auth_unauthorized status",
      remote401Display.jobs.length === 0 &&
        remote401Display.live_source.status === "auth_unauthorized" &&
        !String(remote401Display.live_source.message).includes('{"error"'),
      `${remote401Display.live_source.status} · ${remote401Display.live_source.message}`
    )
  );

  process.env.XIAOJU_ACTION_TOKEN = "remote-test-token";
  process.env.COMMAND_CHANNEL_URL = "https://example.test/api/command-channel";
  const connectedDisplay = await fetchLiveJobsForDisplay(
    {},
    {
      loadEnv: false,
      forceRemote: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            jobs: [sampleClaimedJob()],
          }),
      }),
    }
  );
  const connectedLiveSourceHtml = renderLiveSourceStatusHtml(
    connectedDisplay.live_source,
    true,
    { compact: true }
  );
  results.push(
    assertCase(
      "successful live source renders connected with job count",
      connectedDisplay.live_source.status === "connected" &&
        connectedDisplay.live_source.job_count === 1 &&
        connectedLiveSourceHtml.includes("Live source: connected") &&
        connectedLiveSourceHtml.includes("1 job(s)"),
      connectedLiveSourceHtml
    )
  );

  if (savedEnv.XIAOJU_ACTION_TOKEN === undefined) {
    delete process.env.XIAOJU_ACTION_TOKEN;
  } else {
    process.env.XIAOJU_ACTION_TOKEN = savedEnv.XIAOJU_ACTION_TOKEN;
  }
  if (savedEnv.COMMAND_CHANNEL_URL === undefined) {
    delete process.env.COMMAND_CHANNEL_URL;
  } else {
    process.env.COMMAND_CHANNEL_URL = savedEnv.COMMAND_CHANNEL_URL;
  }
  if (savedEnv.COMMAND_CHANNEL_HTTP_URL === undefined) {
    delete process.env.COMMAND_CHANNEL_HTTP_URL;
  } else {
    process.env.COMMAND_CHANNEL_HTTP_URL = savedEnv.COMMAND_CHANNEL_HTTP_URL;
  }

  return results;
}

function printResults(results) {
  let failed = 0;
  for (const result of results) {
    const mark = result.passed ? "PASS" : "FAIL";
    console.log(`${mark}  ${result.name}${result.details ? ` — ${result.details}` : ""}`);
    if (!result.passed) {
      failed += 1;
    }
  }
  console.log("");
  console.log(`${results.length - failed}/${results.length} passed`);
  return failed;
}

(async () => {
  const results = await runTests();
  const failed = printResults(results);
  process.exit(failed > 0 ? 1 : 0);
})();
