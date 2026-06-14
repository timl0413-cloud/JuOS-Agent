#!/usr/bin/env node

const path = require("path");
const {
  loadWorkerProfiles,
  validateWorkerProfile,
  evaluateWorkerEligibility,
  findEligibleWorkers,
  buildSampleInspectJob,
} = require("../lib/worker-routing");

function assertCase(name, condition, details = "") {
  return {
    name,
    passed: Boolean(condition),
    details,
  };
}

function getProfile(profiles, id) {
  return profiles.find((profile) => profile.id === id) || null;
}

function runSmokeTest() {
  const results = [];
  const { profiles, source } = loadWorkerProfiles();

  console.log("Worker routing smoke test (v0.8A — in-memory only)");
  console.log(`Profiles loaded from: ${path.relative(process.cwd(), source)}`);
  console.log("");

  const station1 = getProfile(profiles, "station1-local");
  const cloudReadonly = getProfile(profiles, "cloud-readonly");

  const station1Validation = validateWorkerProfile(station1 || {});
  results.push(
    assertCase(
      "station1-local profile validates",
      station1 && station1Validation.ok,
      station1Validation.errors?.join("; ") || ""
    )
  );

  const cloudValidation = validateWorkerProfile(cloudReadonly || {});
  results.push(
    assertCase(
      "cloud-readonly profile validates",
      cloudReadonly && cloudValidation.ok,
      cloudValidation.errors?.join("; ") || ""
    )
  );

  const sampleInspectJob = buildSampleInspectJob();
  const cloudEligible = evaluateWorkerEligibility(sampleInspectJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly eligible for low-risk inspect_only with repo_ref (Station1 off)",
      cloudEligible.eligible === true,
      cloudEligible.reason
    )
  );

  const station1Offline = evaluateWorkerEligibility(sampleInspectJob, station1, {
    station_online: false,
  });
  results.push(
    assertCase(
      "station1-local unavailable when main computer is off",
      station1Offline.eligible === false,
      station1Offline.reason
    )
  );

  const cloudWithoutStation1 = findEligibleWorkers(sampleInspectJob, profiles, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly routable without station1-local (Station1 off)",
      cloudWithoutStation1.some((item) => item.profile_id === "cloud-readonly") &&
        !cloudWithoutStation1.some((item) => item.profile_id === "station1-local"),
      cloudWithoutStation1.map((item) => item.profile_id).join(", ") || "none"
    )
  );

  const highRiskJob = buildSampleInspectJob({ risk_level: "high" });
  const cloudHighRisk = evaluateWorkerEligibility(highRiskJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly rejects high risk",
      cloudHighRisk.eligible === false,
      cloudHighRisk.reason
    )
  );

  const noRepoJob = buildSampleInspectJob({ repo_ref: null });
  const cloudNoRepo = evaluateWorkerEligibility(noRepoJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly rejects inspect_only without repo_ref",
      cloudNoRepo.eligible === false,
      cloudNoRepo.reason
    )
  );

  const localFilesJob = buildSampleInspectJob({
    requires_local_files: true,
  });
  const cloudLocalFiles = evaluateWorkerEligibility(localFilesJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly rejects jobs requiring local-only files",
      cloudLocalFiles.eligible === false,
      cloudLocalFiles.reason
    )
  );

  const credentialsJob = buildSampleInspectJob({
    requires_local_credentials: true,
  });
  const cloudCredentials = evaluateWorkerEligibility(
    credentialsJob,
    cloudReadonly,
    { station_online: false }
  );
  results.push(
    assertCase(
      "cloud-readonly rejects jobs requiring local credentials",
      cloudCredentials.eligible === false,
      cloudCredentials.reason
    )
  );

  const deployJob = buildSampleInspectJob({
    requested_actions: ["deploy"],
    prompt: "Inspect repo structure.",
  });
  const cloudDeploy = evaluateWorkerEligibility(deployJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly rejects deploy requests",
      cloudDeploy.eligible === false,
      cloudDeploy.reason
    )
  );

  const pushJob = buildSampleInspectJob({
    requested_actions: ["push"],
    prompt: "Summarize repository.",
  });
  const cloudPush = evaluateWorkerEligibility(pushJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly rejects push requests",
      cloudPush.eligible === false,
      cloudPush.reason
    )
  );

  const migrationJob = buildSampleInspectJob({
    requested_actions: ["migration"],
    prompt: "Summarize repository.",
  });
  const cloudMigration = evaluateWorkerEligibility(migrationJob, cloudReadonly, {
    station_online: false,
  });
  results.push(
    assertCase(
      "cloud-readonly rejects migration requests",
      cloudMigration.eligible === false,
      cloudMigration.reason
    )
  );

  const passed = results.filter((item) => item.passed);
  const failed = results.filter((item) => !item.passed);

  console.log("Results:");
  for (const item of results) {
    const mark = item.passed ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${item.name}`);
    if (item.details) {
      console.log(`         ${item.details}`);
    }
  }

  console.log("");
  console.log(`Summary: ${passed.length}/${results.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("Worker routing smoke test passed.");
}

runSmokeTest();
