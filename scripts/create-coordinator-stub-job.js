#!/usr/bin/env node

const {
  buildDefaultStubJob,
  createStubInboxJob,
  ensureStubDirs,
} = require("../lib/coordinator-stub");

const shouldCreate = !process.argv.includes("--preview");

function main() {
  ensureStubDirs();

  const job = buildDefaultStubJob();

  if (!shouldCreate) {
    console.log("Preview only (pass no flags to create stub job in inbox).");
    console.log("");
    console.log("Would create stub station job:");
    console.log(JSON.stringify(job, null, 2));
    console.log("");
    console.log(`Target inbox: data/coordinator-stub/inbox/${job.id}.json`);
    return;
  }

  const created = createStubInboxJob();
  console.log("Created coordinator stub job:");
  console.log(`  id: ${created.id}`);
  console.log(`  correlation_id: ${created.correlation_id}`);
  console.log(`  station: ${created.station}`);
  console.log(`  workspace: ${created.workspace}`);
  console.log(`  status: ${created.status}`);
  console.log(`  file: data/coordinator-stub/inbox/${created.id}.json`);
  console.log("");
  console.log("Next: node scripts/station-poll-worker.js --once");
  console.log("(Requires local API + auto-run policy; use smoke test --run to execute Cursor)");
}

main();
