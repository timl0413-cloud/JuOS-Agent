#!/usr/bin/env node

const { STATUS_CATEGORIES, classifyJob } = require("../lib/command-channel-status");
const {
  buildJobIndex,
  resolveManifestItemRow,
  resolveManifestLinkedJob,
  parseTowerItemTags,
  jobMatchesManifestItem,
  loadTowerCurrentBatchManifest,
} = require("../lib/tower-current-batch-manifest");
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
    claimed_at: "2026-06-21T10:52:21.889+00:00",
    claimed_by: "joa",
    updated_at: "2026-06-21T10:52:21.889+00:00",
    created_at: "2026-06-21T10:52:17.008+00:00",
    approval_required: true,
    approval_status: "approved",
    ...overrides,
  };
}

function runTests() {
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
      "matched running row status label uses Ongoing or Running",
      /^(Ongoing|Running)/.test(String(row?.status_label || "").split(" · live")[0]),
      row?.status_label || "—"
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
      "unmatched intended_status=running shows Next planned label not running",
      String(runningUnmatchedRow?.status_label || "").includes("Next") &&
        !String(runningUnmatchedRow?.status_label || "").toLowerCase().includes("running"),
      runningUnmatchedRow?.status_label || "—"
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

const results = runTests();
const failed = printResults(results);
process.exit(failed > 0 ? 1 : 0);
