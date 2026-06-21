const { STATUS_CATEGORIES, summarizeJobs } = require("./command-channel-status");
const {
  buildSampleSummary,
  escapeHtml,
  jobTitle,
  formatAge,
} = require("./command-channel-bridge-status-page");
const {
  summarizeTimeSweep,
  WATCHLIST_CATEGORIES,
} = require("./command-channel-time-sweep");

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
    room: "GSync / JuCore",
    source_room: "GSync",
    active_lane: "gsync-registry",
    profile: "jucore",
    lane_status: "ready_to_test",
    readiness_category: "Ready to test",
    launch_ready: false,
    parallel_slot: null,
    note: "Registry active; jucore jobs when JuCore hub is running",
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

function deriveSystemState(summary, timeSummary) {
  const running = summary.buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].length;
  const stranded = summary.stranded_count || 0;
  const awaiting =
    summary.buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;
  const failed =
    summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length;
  const needsReview =
    timeSummary?.watchlist?.buckets[
      WATCHLIST_CATEGORIES.COMPLETED_NEEDS_ASSISTANT_REVIEW
    ]?.length || summary.buckets[STATUS_CATEGORIES.COMPLETED].length;

  if (running > 0) {
    return "running";
  }
  if (stranded > 0 || awaiting > 0) {
    return "needs_attention";
  }
  if (failed > 0) {
    return "blocked";
  }
  if (needsReview > 0) {
    return "review_pending";
  }
  return "idle";
}

function deriveWaitingOn(summary, timeSummary, motionState) {
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
  if (timeSummary?.needs_attention_count > 0) {
    return "operator";
  }
  return "none";
}

function deriveCurrentFocus(summary, timeSummary, runningRows) {
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
  const needsReview =
    timeSummary?.watchlist?.buckets[
      WATCHLIST_CATEGORIES.COMPLETED_NEEDS_ASSISTANT_REVIEW
    ]?.length || 0;
  if (needsReview > 0) {
    return `${needsReview} completed job(s) need assistant review`;
  }
  const failed = summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length;
  if (failed > 0) {
    return `${failed} failed/blocked job(s) need review`;
  }
  return "No active command-channel work";
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

  const systemState = deriveSystemState(summary, timeSummary);
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
    failed_count: summary.buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].length,
    needs_attention_count: timeSummary.needs_attention_count,
  };
  const nextUp = deriveNextUp(summary);
  const waitingOn = deriveWaitingOn(summary, timeSummary, systemState);
  const currentFocus = deriveCurrentFocus(summary, timeSummary, running);
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

function renderTowerHtml(model) {
  const isLive = model.data_mode === "live";
  const badgeLabel = isLive
    ? `LIVE DATA · ${liveAccessLabel(model.live_access)}`
    : "SAMPLE DATA ONLY · not real system state";
  const badgeClass = isLive ? "live" : "proto";
  const stateLabel = model.motion.system_state.replace(/_/g, " ");

  const runningRows =
    model.running.length === 0
      ? `<tr><td colspan="5" class="empty">(none — workers idle)</td></tr>`
      : model.running
          .map(
            (row) => `<tr>
              <td class="mono">${escapeHtml(row.id)}</td>
              <td>${escapeHtml(row.profile || "")}</td>
              <td>${escapeHtml(row.title)}</td>
              <td class="mono">${escapeHtml(row.claimed_at || "")}</td>
              <td>${row.age ? escapeHtml(row.age) : ""}</td>
            </tr>`
          )
          .join("");

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

  const body = `
    <div class="motion-grid">
      <div class="motion-block state-${escapeHtml(model.motion.system_state)}">
        <div class="motion-label">System motion</div>
        <div class="motion-value">${escapeHtml(stateLabel)}</div>
        <div class="motion-action">${model.motion.running_count} running · ${model.motion.stranded_count} stranded</div>
        <div class="motion-action">Waiting on: ${escapeHtml(model.waiting_on || "none")}</div>
        <div class="motion-action muted">Focus: ${escapeHtml(model.current_focus || "")}</div>
      </div>
      ${nextBlock}
    </div>

    <section>
      <h2>Running now</h2>
      <div class="card"><table>
        <thead><tr><th>Job ID</th><th>Profile</th><th>Title</th><th>Claimed</th><th>Age</th></tr></thead>
        <tbody>${runningRows}</tbody>
      </table></div>
    </section>

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
    </section>`;

  return renderShortStatusShell({
    title: "Control Tower",
    subtitle: "Motion: what is running, who owns next, lane readiness",
    badgeLabel,
    badgeClass,
    meta: `Swept: ${escapeHtml(model.swept_at)} · Mode: ${escapeHtml(model.data_mode)} · Backend: ${escapeHtml(JSON.stringify(model.backend))}`,
    summaryCards: [
      { label: "Running", count: model.motion.running_count, accent: "running" },
      { label: "Stranded", count: model.motion.stranded_count, accent: "warn" },
      {
        label: "Needs attention",
        count: model.motion.needs_attention_count,
        accent: "failed",
      },
      {
        label: "Awaiting approval",
        count: model.motion.awaiting_approval_count,
        accent: "completed",
      },
    ],
    body,
    footerNote:
      "CLI: npm run status:tower · Doc: docs/command-channel/control-tower-motion-v0.md",
    navHtml: buildShortStatusNav(model.data_mode),
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
  const cards = options.summaryCards
    .map(
      (card) =>
        `<div class="summary-card ${escapeHtml(card.accent)}"><div class="label">${escapeHtml(card.label)}</div><div class="count">${card.count}</div></div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root {
      --bg: #0f1419; --surface: #1a2332; --surface-2: #243044; --text: #e7ecf3;
      --muted: #9aa8bc; --border: #334155; --stranded: #f59e0b; --running: #38bdf8;
      --completed: #34d399; --failed: #f87171; --proto: #a78bfa; --live: #34d399;
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
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(options.title)}</h1>
      <p class="subtitle">${escapeHtml(options.subtitle)}</p>
      <span class="badge ${options.badgeClass}">${escapeHtml(options.badgeLabel)}</span>
      <p class="meta">${options.meta}</p>
      <p class="nav">${options.navHtml || buildShortStatusNav("live")}</p>
    </header>
    <div class="summary-grid">${cards}</div>
    ${options.body}
    <p class="footer-note">${escapeHtml(options.footerNote)}</p>
  </div>
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
    `Completed needs review: ${compact.completed_needs_review_count} | Failed: ${compact.failed_count}`,
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
  return lines.join("\n");
}

module.exports = {
  LANE_REGISTRY_V0,
  buildWatchSummary,
  buildTowerSummary,
  buildCompactControlTowerBlock,
  buildSampleWatchSummary,
  buildSampleTowerSummary,
  renderWatchHtml,
  renderTowerHtml,
  renderLocalLiveLandingHtml,
  formatControlTowerReport,
};
