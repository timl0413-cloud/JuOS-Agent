#!/usr/bin/env node

const fs = require("fs");
const {
  ALLOWED_WORKER_PROFILES,
  PROFILE_TASK_TYPES,
  GSYNC_REPO_REF,
  GSYNC_WORKSPACE_REF,
  validateCreateJobInput,
  validateApprovedFinalizeContract,
} = require("../lib/command-channel-core");
const {
  getProfileConfig,
  getScopedWritePrefix,
  validateWriteScopePaths,
  isPathUnderWriteScope,
} = require("../lib/workspace-target-registry");

function check(label, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

function main() {
  let passed = 0;
  let failed = 0;

  function record(ok) {
    if (ok) passed += 1;
    else failed += 1;
  }

  record(
    check(
      "gsync in ALLOWED_WORKER_PROFILES",
      ALLOWED_WORKER_PROFILES.includes("gsync")
    )
  );

  record(
    check(
      "gsync supports inspect_only",
      PROFILE_TASK_TYPES.gsync?.includes("inspect_only")
    )
  );

  record(
    check(
      "gsync repo contract",
      GSYNC_REPO_REF === "juos-knowledge-vault"
    )
  );

  record(
    check(
      "gsync workspace contract",
      GSYNC_WORKSPACE_REF === "C:\\projects\\juos-knowledge-vault"
    )
  );

  const profileConfig = getProfileConfig("gsync");
  record(
    check(
      "workspace-targets gsync profile",
      Boolean(profileConfig?.allowed_write_scope === "gsync/**")
    )
  );

  record(
    check(
      "scoped write prefix",
      getScopedWritePrefix("gsync") === "gsync/"
    )
  );

  record(
    check(
      "gsync path allowed",
      isPathUnderWriteScope("gsync", "gsync/registry/routes.yaml")
    )
  );

  record(
    check(
      "root path rejected",
      !isPathUnderWriteScope("gsync", "README.md")
    )
  );

  record(
    check(
      "validateWriteScopePaths catches violation",
      validateWriteScopePaths("gsync", ["gsync/a.md", "README.md"])?.includes(
        "README.md"
      )
    )
  );

  const inspectValid = validateCreateJobInput({
    target_worker_profile: "gsync",
    repo_ref: GSYNC_REPO_REF,
    workspace_ref: GSYNC_WORKSPACE_REF,
    task_type: "inspect_only",
    risk_level: "low",
  });
  record(
    check(
      "inspect_only job validates",
      inspectValid.ok === true,
      inspectValid.errors.join("; ")
    )
  );

  const wrongWorkspace = validateCreateJobInput({
    target_worker_profile: "gsync",
    repo_ref: GSYNC_REPO_REF,
    workspace_ref: "C:\\projects\\TimOS-Agent",
    task_type: "inspect_only",
    risk_level: "low",
  });
  record(
    check(
      "wrong workspace rejected",
      wrongWorkspace.ok === false
    )
  );

  const finalizeValid = validateApprovedFinalizeContract({
    workerProfile: "gsync",
    repoRef: GSYNC_REPO_REF,
    workspaceRef: GSYNC_WORKSPACE_REF,
  });
  record(
    check(
      "approved_finalize contract validates",
      finalizeValid.ok === true,
      finalizeValid.errors.join("; ")
    )
  );

  const workspaceExists = fs.existsSync(GSYNC_WORKSPACE_REF);
  record(
    check(
      "workspace directory exists on host",
      workspaceExists,
      workspaceExists ? GSYNC_WORKSPACE_REF : `${GSYNC_WORKSPACE_REF} (start hub after workspace is present)`
    )
  );

  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
