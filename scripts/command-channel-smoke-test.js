#!/usr/bin/env node

const path = require("path");
const {
  createJob,
  getJob,
  validateCreateJobInput,
  DEFAULT_WORKER_PROFILE,
} = require("../lib/command-channel-coordinator");
const { processOneJob, resolveWorkerRunMode, runPersistentWorker } = require("./command-channel-worker");
const { findEligibleWorkers, loadWorkerProfiles } = require("../lib/worker-routing");

const FIXTURE_REPO_REF = "timos-agent-snapshot";

function assertCase(name, condition, details = "") {
  return { name, passed: Boolean(condition), details };
}

function xiaojuCreateJob(overrides = {}) {
  return createJob({
    repo_ref: FIXTURE_REPO_REF,
    task_type: "inspect_only",
    risk_level: "low",
    requested_by: "xiaoju",
    prompt: "Inspect snapshot structure. Do not modify files.",
    ...overrides,
  });
}

function expectCreateRejected(overrides, expectedFragment) {
  try {
    createJob({
      repo_ref: FIXTURE_REPO_REF,
      task_type: "inspect_only",
      risk_level: "low",
      requested_by: "xiaoju",
      prompt: "Inspect snapshot.",
      ...overrides,
    });
    return {
      ok: false,
      message: "expected rejection but job was created",
    };
  } catch (err) {
    const text = err.validation_errors
      ? err.validation_errors.join("; ")
      : err.message;
    return {
      ok: text.toLowerCase().includes(String(expectedFragment).toLowerCase()),
      message: text,
    };
  }
}

async function runSmokeTest() {
  const results = [];

  console.log("Command channel smoke test (no network, no Cursor, no local API)");
  console.log("");

  let inspectJob;
  try {
    inspectJob = xiaojuCreateJob({ task_type: "inspect_only" });
    results.push(
      assertCase(
        "XiaoJu-style create inspect_only job",
        inspectJob.status === "pending" && inspectJob.id,
        inspectJob.id
      )
    );
  } catch (err) {
    results.push(assertCase("XiaoJu-style create inspect_only job", false, err.message));
    printResults(results);
    process.exit(1);
  }

  const inspectOutcome = await processOneJob({
    jobId: inspectJob.id,
    mode: "local",
  });
  results.push(
    assertCase(
      "worker claims exact inspect job id",
      inspectOutcome?.claimedJob?.id === inspectJob.id,
      `expected ${inspectJob.id}, got ${inspectOutcome?.claimedJob?.id || "none"}`
    )
  );
  results.push(
    assertCase(
      "inspect job completed by cloud-readonly worker",
      inspectOutcome?.finished?.status === "completed",
      inspectOutcome?.finished?.status || "none"
    )
  );

  const inspectRead = getJob(inspectJob.id);
  results.push(
    assertCase(
      "XiaoJu-style read returns inspect result",
      inspectRead?.status === "completed" && inspectRead?.result?.summary,
      inspectRead?.result?.status || inspectRead?.status
    )
  );

  let summarizeJob;
  try {
    summarizeJob = xiaojuCreateJob({
      task_type: "summarize_repo",
      prompt: "Summarize repository snapshot.",
    });
    const summarizeOutcome = await processOneJob({
      jobId: summarizeJob.id,
      mode: "local",
    });
    const summarizeRead = getJob(summarizeJob.id);

    results.push(
      assertCase(
        "XiaoJu-style create summarize_repo job",
        summarizeJob.status === "pending",
        summarizeJob.id
      )
    );
    results.push(
      assertCase(
        "summarize_repo worker completes",
        summarizeOutcome?.finished?.status === "completed",
        summarizeOutcome?.finished?.status || "none"
      )
    );
    results.push(
      assertCase(
        "XiaoJu-style read returns summarize result",
        summarizeRead?.result?.summary?.includes("timos-agent-mini-fixture"),
        summarizeRead?.result?.task_type || "none"
      )
    );
  } catch (err) {
    results.push(assertCase("summarize_repo flow", false, err.message));
  }

  const rejectionCases = [
    ["high risk rejected", { risk_level: "high" }, "risk_level"],
    ["deploy rejected", { requested_actions: ["deploy"] }, "deploy"],
    ["push rejected", { requested_actions: ["push"] }, "push"],
    ["migration rejected", { requested_actions: ["migration"] }, "migration"],
    [
      "local credentials rejected",
      { requires_local_credentials: true },
      "local credentials",
    ],
    [
      "local-only files rejected",
      { requires_local_files: true },
      "local-only files",
    ],
    ["missing repo_ref rejected", { repo_ref: null }, "repo_ref"],
  ];

  for (const [name, overrides, fragment] of rejectionCases) {
    const outcome = expectCreateRejected(overrides, fragment);
    results.push(assertCase(name, outcome.ok, outcome.message));
  }

  const routingJob = {
    target_worker_profile: DEFAULT_WORKER_PROFILE,
    repo_ref: FIXTURE_REPO_REF,
    task_type: "inspect_only",
    risk_level: "low",
    requested_by: "xiaoju",
    prompt: "Inspect snapshot.",
  };
  const { profiles } = loadWorkerProfiles();
  const eligible = findEligibleWorkers(routingJob, profiles, {
    station_online: false,
  });
  results.push(
    assertCase(
      "station1/local computer not required",
      eligible.some((item) => item.profile_id === DEFAULT_WORKER_PROFILE) &&
        !eligible.some((item) => item.profile_id === "station1-local"),
      eligible.map((item) => item.profile_id).join(", ") || "none"
    )
  );

  const dryValidation = validateCreateJobInput({
    repo_ref: FIXTURE_REPO_REF,
    task_type: "inspect_only",
    risk_level: "low",
  });
  results.push(
    assertCase(
      "create validation accepts safe inspect job shape",
      dryValidation.ok === true,
      dryValidation.errors.join("; ")
    )
  );

  results.push(
    assertCase(
      "resolveWorkerRunMode once flag",
      resolveWorkerRunMode({ runOnce: true, jobId: null }) === "once",
      resolveWorkerRunMode({ runOnce: true, jobId: null })
    )
  );
  results.push(
    assertCase(
      "resolveWorkerRunMode job id",
      resolveWorkerRunMode({ runOnce: false, jobId: "job-123" }) === "once",
      resolveWorkerRunMode({ runOnce: false, jobId: "job-123" })
    )
  );
  results.push(
    assertCase(
      "resolveWorkerRunMode persistent hub",
      resolveWorkerRunMode({ runOnce: false, jobId: null }) === "persistent",
      resolveWorkerRunMode({ runOnce: false, jobId: null })
    )
  );

  try {
    await runPersistentWorker({
      maxIterations: 1,
      pollIntervalMs: 1,
      mode: "local",
      allowLaneClaim: true,
    });
    results.push(
      assertCase(
        "persistent worker hub exits after idle poll iteration",
        true,
        "maxIterations=1"
      )
    );
  } catch (err) {
    results.push(
      assertCase(
        "persistent worker hub exits after idle poll iteration",
        false,
        err.message
      )
    );
  }

  try {
    await processOneJob({ mode: "local" });
    results.push(
      assertCase(
        "processOneJob rejects lane claim without allow-lane",
        false,
        "expected refusal"
      )
    );
  } catch (err) {
    results.push(
      assertCase(
        "processOneJob rejects lane claim without allow-lane",
        err.message.includes("Refusing to claim by lane"),
        err.message
      )
    );
  }

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
  console.log("");
  console.log(`Summary: ${passed}/${results.length} passed`);

  if (passed !== results.length) {
    process.exit(1);
  }

  console.log("Command channel smoke test passed.");
}

runSmokeTest().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
