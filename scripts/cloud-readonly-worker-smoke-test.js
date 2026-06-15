#!/usr/bin/env node

const path = require("path");
const { loadRepoSources, resolveRepoRef } = require("../lib/repo-sources");
const {
  loadWorkerProfiles,
  evaluateWorkerEligibility,
  findEligibleWorkers,
  buildSampleInspectJob,
} = require("../lib/worker-routing");
const { executeCloudReadonlyJob } = require("../lib/cloud-readonly-worker");

const FIXTURE_REPO_REF = "timos-agent-snapshot";

function assertCase(name, condition, details = "") {
  return {
    name,
    passed: Boolean(condition),
    details,
  };
}

function baseJob(overrides = {}) {
  return {
    target_worker_profile: "cloud-readonly",
    workspace_ref: "TimOS-Agent",
    repo_ref: FIXTURE_REPO_REF,
    task_type: "inspect_only",
    risk_level: "low",
    requested_by: "xiaoju",
    prompt: "Inspect snapshot structure. Do not modify files.",
    ...overrides,
  };
}

function runSmokeTest() {
  const results = [];

  console.log("Cloud-readonly worker smoke test (v0.8B — local POC, no network)");
  console.log("");

  let sources;
  try {
    sources = loadRepoSources();
    results.push(
      assertCase(
        "repo-sources config loads",
        Array.isArray(sources.repos) && sources.repos.length > 0,
        path.relative(process.cwd(), sources.source)
      )
    );
  } catch (err) {
    results.push(assertCase("repo-sources config loads", false, err.message));
    printResults(results);
    process.exit(1);
  }

  try {
    const resolved = resolveRepoRef(FIXTURE_REPO_REF);
    results.push(
      assertCase(
        "fixture repo_ref resolves",
        resolved.absolute_path.includes("timos-agent-mini"),
        `${resolved.repo_ref} -> ${resolved.snapshot_path}`
      )
    );
  } catch (err) {
    results.push(assertCase("fixture repo_ref resolves", false, err.message));
  }

  const inspectResult = executeCloudReadonlyJob(
    baseJob({ task_type: "inspect_only" }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "inspect_only succeeds on fixture snapshot",
      inspectResult.status === "completed" &&
        inspectResult.files_seen.length > 0 &&
        inspectResult.summary,
      inspectResult.errors.join("; ") || `files_seen=${inspectResult.files_seen.length}`
    )
  );
  results.push(
    assertCase(
      "inspect_only safety flags",
      inspectResult.safety?.snapshot_only === true &&
        inspectResult.safety?.shell_commands_executed === false &&
        inspectResult.safety?.cursor_called === false,
      JSON.stringify(inspectResult.safety)
    )
  );

  const summarizeResult = executeCloudReadonlyJob(
    baseJob({ task_type: "summarize_repo" }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "summarize_repo succeeds on fixture snapshot",
      summarizeResult.status === "completed" &&
        summarizeResult.summary &&
        summarizeResult.summary.includes("timos-agent-mini-fixture"),
      summarizeResult.errors.join("; ")
    )
  );

  const missingRepo = executeCloudReadonlyJob(
    baseJob({ repo_ref: null }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "missing repo_ref rejected",
      missingRepo.status === "failed",
      missingRepo.errors.join("; ")
    )
  );

  const unknownRepo = executeCloudReadonlyJob(
    baseJob({ repo_ref: "does-not-exist" }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "unknown repo_ref rejected",
      unknownRepo.status === "failed" &&
        unknownRepo.errors.some((item) => item.includes("unknown repo_ref")),
      unknownRepo.errors.join("; ")
    )
  );

  const highRisk = executeCloudReadonlyJob(
    baseJob({ risk_level: "high" }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "high risk rejected",
      highRisk.status === "failed",
      highRisk.errors.join("; ")
    )
  );

  const deployJob = executeCloudReadonlyJob(
    baseJob({ requested_actions: ["deploy"], prompt: "Inspect snapshot." }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "deploy forbidden",
      deployJob.status === "failed",
      deployJob.errors.join("; ")
    )
  );

  const pushJob = executeCloudReadonlyJob(
    baseJob({ requested_actions: ["push"], prompt: "Inspect snapshot." }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "push forbidden",
      pushJob.status === "failed",
      pushJob.errors.join("; ")
    )
  );

  const migrationJob = executeCloudReadonlyJob(
    baseJob({ requested_actions: ["migration"], prompt: "Inspect snapshot." }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "migration forbidden",
      migrationJob.status === "failed",
      migrationJob.errors.join("; ")
    )
  );

  const localFilesJob = executeCloudReadonlyJob(
    baseJob({ requires_local_files: true }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "local-only files rejected",
      localFilesJob.status === "failed",
      localFilesJob.errors.join("; ")
    )
  );

  const credentialsJob = executeCloudReadonlyJob(
    baseJob({ requires_local_credentials: true }),
    { station_online: false }
  );
  results.push(
    assertCase(
      "local credentials rejected",
      credentialsJob.status === "failed",
      credentialsJob.errors.join("; ")
    )
  );

  const { profiles } = loadWorkerProfiles();
  const routingJob = buildSampleInspectJob({
    repo_ref: FIXTURE_REPO_REF,
    target_worker_profile: "cloud-readonly",
  });
  const eligible = findEligibleWorkers(routingJob, profiles, {
    station_online: false,
  });
  results.push(
    assertCase(
      "station1-local not required (main computer off)",
      eligible.some((item) => item.profile_id === "cloud-readonly") &&
        !eligible.some((item) => item.profile_id === "station1-local"),
      eligible.map((item) => item.profile_id).join(", ") || "none"
    )
  );

  const cloudProfile = profiles.find((item) => item.id === "cloud-readonly");
  const stationOffline = evaluateWorkerEligibility(routingJob, cloudProfile, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly routing eligible while Station1 off",
      stationOffline.eligible === true,
      stationOffline.reason
    )
  );

  printResults(results);
}

function printResults(results) {
  console.log("Results:");
  for (const item of results) {
    const mark = item.passed ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${item.name}`);
    if (item.details) {
      console.log(`         ${item.details}`);
    }
  }

  const passed = results.filter((item) => item.passed).length;
  const failed = results.filter((item) => !item.passed).length;

  console.log("");
  console.log(`Summary: ${passed}/${results.length} passed`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log("Cloud-readonly worker smoke test passed.");
}

runSmokeTest();
