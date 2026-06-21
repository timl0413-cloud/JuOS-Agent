const {
  STATUS_CATEGORIES,
  summarizeJobs,
  buildRecoveryCommand,
} = require("./command-channel-status");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text, maxLen = 120) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen - 3)}...`;
}

function jobTitle(job) {
  if (job.plan_summary) {
    return truncate(job.plan_summary, 100);
  }
  if (job.approval_summary) {
    return truncate(job.approval_summary, 100);
  }
  if (job.prompt) {
    return truncate(job.prompt.split("\n")[0], 100);
  }
  return job.task_type || "(no summary)";
}

function formatAge(isoDate) {
  if (!isoDate) {
    return null;
  }
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) {
    return `~${Math.max(minutes, 1)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `~${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `~${days}d`;
}

function buildSampleSummary() {
  const now = new Date().toISOString();
  const sampleJobs = [
    {
      id: "91b8ebf4-5f9f-4dcf-97df-03ae42f47f6d",
      status: "pending",
      target_worker_profile: "joa",
      repo_ref: "TimOS-Agent",
      workspace_ref: "C:\\projects\\TimOS-Agent",
      task_type: "approved_finalize",
      approval_required: true,
      approval_status: "approved",
      approved_at: "2026-06-20T07:12:00.000Z",
      plan_summary: "Finalize reviewed status-layer changes",
      claimed_at: null,
      errors: [],
    },
    {
      id: "1ce75a20-9142-4115-bf2a-10bf77b046fa",
      status: "claimed",
      target_worker_profile: "joa",
      repo_ref: "TimOS-Agent",
      task_type: "supervised_implement",
      plan_summary: "Bridge Status UI mock — supervised_implement in progress",
      claimed_at: "2026-06-20T09:29:28.000Z",
      errors: [],
    },
    {
      id: "e72cbac1-8a97-4519-8e9d-c479ba56a33d",
      status: "completed",
      target_worker_profile: "joa",
      repo_ref: "TimOS-Agent",
      task_type: "supervised_implement",
      completed_at: "2026-06-20T08:00:00.000Z",
      result: {
        summary:
          "No-Stranded-Job Status Layer v0 — CLI, lib classifier, recovery commands, room packet template",
      },
      errors: [],
    },
    {
      id: "a3c21f88-0b4e-4a9d-9c12-8f7e2d1a905b",
      status: "failed",
      target_worker_profile: "joa",
      repo_ref: "TimOS-Agent",
      task_type: "approved_finalize",
      errors: [
        "approved_finalize validation failed: workspace_ref must match joa contract",
        "worker hub not running at claim attempt",
      ],
    },
  ];

  return {
    ...summarizeJobs(sampleJobs),
    data_mode: "sample",
    backend: { backend: "sample" },
    generated_at: now,
  };
}

function buildViewModel(summary, options = {}) {
  const buckets = summary.buckets;
  const recoveryStyle = options.recoveryStyle || "powershell";

  const stranded = buckets[STATUS_CATEGORIES.PENDING_UNCLAIMED].map((item) => {
    const job = item.job;
    const age = formatAge(job.approved_at || job.created_at);
    return {
      id: job.id,
      title: jobTitle(job),
      task_type: job.task_type,
      profile: job.target_worker_profile,
      workspace_ref: job.workspace_ref,
      approved_at: job.approved_at,
      age,
      recovery: buildRecoveryCommand(job, { style: recoveryStyle }),
    };
  });

  const running = buckets[STATUS_CATEGORIES.CLAIMED_RUNNING].map((item) => {
    const job = item.job;
    return {
      id: job.id,
      profile: job.target_worker_profile,
      claimed_at: job.claimed_at,
      status: job.status,
      summary: jobTitle(job),
    };
  });

  const completed = buckets[STATUS_CATEGORIES.COMPLETED].map((item) => {
    const job = item.job;
    return {
      id: job.id,
      result_summary: job.result?.summary
        ? truncate(String(job.result.summary), 160)
        : jobTitle(job),
      target_room: options.defaultTargetRoom || "room",
      packet_command: `node scripts/command-channel-status.js --job-id ${job.id} --packet --target-room ${options.defaultTargetRoom || "room"}`,
    };
  });

  const failed = buckets[STATUS_CATEGORIES.FAILED_OR_BLOCKED].map((item) => {
    const job = item.job;
    return {
      id: job.id,
      error_summary:
        job.errors.length > 0
          ? job.errors.join("; ")
          : item.reason || "blocked",
      next_owner: "Tim + JOA — do not auto-retry",
    };
  });

  const awaiting = buckets[STATUS_CATEGORIES.PENDING_AWAITING_APPROVAL].length;

  return {
    data_mode: summary.data_mode || "live",
    scanned_at: summary.scanned_at,
    generated_at: summary.generated_at || summary.scanned_at,
    backend: summary.backend,
    total: summary.total,
    stranded_count: summary.stranded_count,
    running_count: running.length,
    completed_count: completed.length,
    failed_count: failed.length,
    awaiting_approval_count: awaiting,
    stranded,
    running,
    completed,
    failed,
    awaiting_approval_count_visible: awaiting,
  };
}

function buildBridgeStatusSummary(jobs, options = {}) {
  const summary = summarizeJobs(jobs);
  return {
    ...summary,
    data_mode: "live",
    backend: options.backend || { backend: "unknown" },
    generated_at: new Date().toISOString(),
  };
}

function renderBridgeStatusHtml(viewModel) {
  const isLive = viewModel.data_mode === "live";
  const badgeLabel = isLive
    ? "Live data · authenticated read-only"
    : "Prototype v0 · sample data only";
  const badgeClass = isLive ? "live" : "proto";
  const metaParts = [
    `Scan: ${escapeHtml(viewModel.scanned_at || viewModel.generated_at)}`,
    `Mode: ${escapeHtml(viewModel.data_mode)}`,
    `Backend: ${escapeHtml(JSON.stringify(viewModel.backend))}`,
  ];

  const strandedRows =
    viewModel.stranded.length === 0
      ? `<tr><td colspan="6" class="empty">(none)</td></tr>`
      : viewModel.stranded
          .map(
            (row) => `<tr>
              <td class="mono">${escapeHtml(row.id)}</td>
              <td><strong>${escapeHtml(row.title)}</strong><br><span class="mono muted">${escapeHtml(row.task_type || "")}</span></td>
              <td>${escapeHtml(row.profile || "")}</td>
              <td class="mono hide-mobile">${escapeHtml(row.workspace_ref || "")}</td>
              <td>${row.approved_at ? `Approved ${escapeHtml(row.approved_at)}<br>` : ""}${row.age ? `<span class="warn">${escapeHtml(row.age)} unclaimed</span>` : ""}</td>
              <td><code class="cmd">${escapeHtml(row.recovery)}</code></td>
            </tr>`
          )
          .join("");

  const runningRows =
    viewModel.running.length === 0
      ? `<tr><td colspan="4" class="empty">(none)</td></tr>`
      : viewModel.running
          .map(
            (row) => `<tr>
              <td class="mono">${escapeHtml(row.id)}</td>
              <td>${escapeHtml(row.profile || "")}</td>
              <td class="mono">${escapeHtml(row.claimed_at || "")}</td>
              <td><span class="status-pill running">claimed</span> ${escapeHtml(row.summary)}</td>
            </tr>`
          )
          .join("");

  const completedRows =
    viewModel.completed.length === 0
      ? `<tr><td colspan="4" class="empty">(none)</td></tr>`
      : viewModel.completed
          .map(
            (row) => `<tr>
              <td class="mono">${escapeHtml(row.id)}</td>
              <td>${escapeHtml(row.result_summary)}</td>
              <td>${escapeHtml(row.target_room)}</td>
              <td>Post completion summary to ${escapeHtml(row.target_room)} with job id and files changed.<br><code class="cmd">${escapeHtml(row.packet_command)}</code></td>
            </tr>`
          )
          .join("");

  const failedRows =
    viewModel.failed.length === 0
      ? `<tr><td colspan="3" class="empty">(none)</td></tr>`
      : viewModel.failed
          .map(
            (row) => `<tr>
              <td class="mono">${escapeHtml(row.id)}</td>
              <td>${escapeHtml(row.error_summary)}</td>
              <td>${escapeHtml(row.next_owner)}</td>
            </tr>`
          )
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JOA Bridge Status${isLive ? "" : " — Preview"}</title>
  <style>
    :root {
      --bg: #0f1419;
      --surface: #1a2332;
      --surface-2: #243044;
      --text: #e7ecf3;
      --muted: #9aa8bc;
      --border: #334155;
      --stranded: #f59e0b;
      --running: #38bdf8;
      --completed: #34d399;
      --failed: #f87171;
      --proto: #a78bfa;
      --live: #34d399;
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
    .summary-card.stranded { --accent: var(--stranded); }
    .summary-card.running { --accent: var(--running); }
    .summary-card.completed { --accent: var(--completed); }
    .summary-card.failed { --accent: var(--failed); }
    .summary-card .label { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
    .summary-card .count { font-size: 2rem; font-weight: 700; line-height: 1.1; margin-top: 0.15rem; }
    section { margin-bottom: 1.75rem; }
    section h2 { font-size: 1.05rem; margin: 0 0 0.65rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .status-pill { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.15rem 0.45rem; border-radius: 4px; }
    .status-pill.stranded { background: rgba(245, 158, 11, 0.2); color: var(--stranded); }
    .status-pill.running { background: rgba(56, 189, 248, 0.2); color: var(--running); }
    .status-pill.completed { background: rgba(52, 211, 153, 0.2); color: var(--completed); }
    .status-pill.failed { background: rgba(248, 113, 113, 0.2); color: var(--failed); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { text-align: left; padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { background: var(--surface-2); color: var(--muted); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
    tr:last-child td { border-bottom: none; }
    .empty { color: var(--muted); font-style: italic; }
    .mono { font-family: var(--mono); font-size: 0.8rem; word-break: break-all; }
    .muted { color: var(--muted); }
    .warn { color: var(--stranded); }
    .cmd { display: block; background: #0b1220; border: 1px solid var(--border); border-radius: 6px; padding: 0.45rem 0.55rem; margin-top: 0.25rem; color: #cbd5e1; white-space: pre-wrap; }
    .note-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; }
    .note-box ul { margin: 0.5rem 0 0; padding-left: 1.2rem; }
    .note-box li { margin-bottom: 0.35rem; }
    .rules { display: grid; gap: 0.5rem; }
    .rule { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.55rem 0.75rem; background: var(--surface-2); border-radius: 8px; font-size: 0.9rem; }
    .rule code { font-family: var(--mono); font-size: 0.82rem; background: #0b1220; padding: 0.1rem 0.35rem; border-radius: 4px; }
    .travel { border-left: 3px solid var(--running); }
    @media (max-width: 720px) {
      th:nth-child(n+4), td:nth-child(n+4) { display: none; }
      .hide-mobile { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>JOA Bridge Status</h1>
      <p class="subtitle">Command-channel visibility — no CLI required</p>
      <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      <p class="meta">${metaParts.join(" · ")}</p>
    </header>

    <div class="summary-grid" aria-label="Bridge summary">
      <div class="summary-card stranded"><div class="label">Stranded</div><div class="count">${viewModel.stranded_count}</div></div>
      <div class="summary-card running"><div class="label">Running</div><div class="count">${viewModel.running_count}</div></div>
      <div class="summary-card completed"><div class="label">Completed · needs notification</div><div class="count">${viewModel.completed_count}</div></div>
      <div class="summary-card failed"><div class="label">Failed or blocked</div><div class="count">${viewModel.failed_count}</div></div>
    </div>

    <section>
      <h2>Stranded jobs <span class="status-pill stranded">approved · not claimed</span></h2>
      <div class="card"><table><thead><tr><th>Job ID</th><th>Title / task</th><th>Profile</th><th class="hide-mobile">Workspace</th><th>Age / approved</th><th>Recovery command</th></tr></thead><tbody>${strandedRows}</tbody></table></div>
    </section>

    <section>
      <h2>Running jobs <span class="status-pill running">claimed</span></h2>
      <div class="card"><table><thead><tr><th>Job ID</th><th>Profile</th><th>Claimed</th><th>Current status</th></tr></thead><tbody>${runningRows}</tbody></table></div>
    </section>

    <section>
      <h2>Completed · needs notification <span class="status-pill completed">verify room post</span></h2>
      <div class="card"><table><thead><tr><th>Job ID</th><th>Result summary</th><th>Target room</th><th>Packet action needed</th></tr></thead><tbody>${completedRows}</tbody></table></div>
    </section>

    <section>
      <h2>Failed or blocked <span class="status-pill failed">review required</span></h2>
      <div class="card"><table><thead><tr><th>Job ID</th><th>Error summary</th><th>Next owner</th></tr></thead><tbody>${failedRows}</tbody></table></div>
    </section>

    <section>
      <h2>Operating rules</h2>
      <div class="rules">
        <div class="rule"><code>approved</code> <span>≠</span> <code>running</code> — approval does not mean a worker claimed the job</div>
        <div class="rule"><code>pending</code> <span>≠</span> <code>handled</code> — pending status is not proof of execution</div>
        <div class="rule"><code>completed</code> <span>≠</span> <code>notified</code> — post result to the requesting room explicitly</div>
      </div>
      <p class="meta" style="margin-top: 0.75rem;">Rooms must not assume execution until <code class="mono">claimed_at</code> or terminal <code class="mono">result</code> is present.</p>
    </section>

    <section>
      <h2>Travel Mode readiness</h2>
      <div class="note-box travel">
        <p>This page is mobile-readable HTML served from the command-channel API. For MacBook/phone access away from Station 1, deploy to JuOS with session auth — see <code class="mono">docs/command-channel/bridge-status-external-v0.md</code>.</p>
        <ul>
          <li>Live route: <code class="mono">GET /joa/bridge-status</code> (Bearer <code class="mono">remote-jobs:list</code>)</li>
          <li>Preview route: <code class="mono">GET /joa/bridge-status/preview</code> (sample data, no auth)</li>
          <li>Station 4 / Station 5 worker panels can be added later</li>
        </ul>
      </div>
    </section>
  </div>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  buildSampleSummary,
  buildBridgeStatusSummary,
  buildViewModel,
  renderBridgeStatusHtml,
};
