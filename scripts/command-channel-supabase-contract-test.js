#!/usr/bin/env node

const {
  jobToSupabaseRow,
  supabaseRowToJob,
  buildHeaders,
  createJob,
  getJob,
  listJobs,
  claimJob,
  submitResult,
  isSupabaseConfigured,
  getSupabaseConfig,
  postgrestEqValue,
  postgrestUuidEq,
  postgrestFilter,
  TABLE_NAME,
} = require("../lib/command-channel-supabase");
const {
  validateCreateJobInput,
  buildNewJobRecord,
  ALLOWED_WORKER_PROFILES,
} = require("../lib/command-channel-core");

const shouldRunLive = process.argv.includes("--live");
const FIXTURE_REPO_REF = "timos-agent-snapshot";
const SAMPLE_JOB_ID = "c28c939e-837e-43f8-8f67-287b37f6d388";

const MOCK_CONFIG = {
  url: "https://example.supabase.co",
  serviceRoleKey: "test-service-role-key",
  restBase: "https://example.supabase.co/rest/v1/command_channel_jobs",
};

function assertCase(name, condition, details = "") {
  return { name, passed: Boolean(condition), details };
}

function formatAdapterError(err) {
  const parts = [];

  if (err?.message) {
    parts.push(err.message);
  }
  if (err?.name && err.name !== "Error") {
    parts.push(`name=${err.name}`);
  }
  if (err?.code) {
    parts.push(`code=${err.code}`);
  }
  if (err?.status) {
    parts.push(`status=${err.status}`);
  }
  if (err?.cause?.code) {
    parts.push(`cause_code=${err.cause.code}`);
  }
  if (err?.cause?.message) {
    parts.push(`cause_message=${err.cause.message}`);
  }
  if (err?.data) {
    parts.push(`body=${JSON.stringify(err.data)}`);
  }
  if (err?.request?.method) {
    parts.push(`request=${err.request.method} ${TABLE_NAME}${err.request.query || ""}`);
  }

  return parts.join("; ");
}

function createMockFetch(handlers) {
  const calls = [];

  return {
    calls,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });

      for (const handler of handlers) {
        const result = await handler(url, options);
        if (result) {
          return result;
        }
      }

      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: "unhandled mock request" }),
      };
    },
  };
}

function mockJsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  };
}

function headersContainServiceRole(headers, key) {
  return headers.apikey === key && headers.Authorization === `Bearer ${key}`;
}

async function runMissingEnvChecks() {
  const results = [];
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  results.push(
    assertCase(
      "supabase env missing is detected",
      isSupabaseConfigured() === false,
      `configured=${isSupabaseConfigured()}`
    )
  );

  let configError = null;
  try {
    getSupabaseConfig();
  } catch (err) {
    configError = err;
  }
  results.push(
    assertCase(
      "getSupabaseConfig fails closed without env",
      configError?.code === "supabase_not_configured",
      configError?.message || "no error"
    )
  );

  if (savedUrl === undefined) {
    delete process.env.SUPABASE_URL;
  } else {
    process.env.SUPABASE_URL = savedUrl;
  }
  if (savedKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }

  return results;
}

async function runMockAdapterChecks() {
  const results = [];
  const config = MOCK_CONFIG;

  results.push(
    assertCase(
      "supabase env present is detected",
      isSupabaseConfigured() === Boolean(
        process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
      ""
    )
  );

  const job = buildNewJobRecord({
    repo_ref: FIXTURE_REPO_REF,
    task_type: "inspect_only",
    risk_level: "low",
    requested_by: "xiaoju",
    prompt: "Inspect snapshot.",
  });
  const row = jobToSupabaseRow(job);

  results.push(
    assertCase(
      "jobToSupabaseRow shape includes payload jsonb",
      row.payload?.prompt === "Inspect snapshot." &&
        row.status === "pending" &&
        row.task_type === "inspect_only",
      JSON.stringify(Object.keys(row))
    )
  );

  results.push(
    assertCase(
      "supabaseRowToJob restores API job shape",
      supabaseRowToJob(row)?.repo_ref === FIXTURE_REPO_REF &&
        supabaseRowToJob(row)?.prompt === "Inspect snapshot.",
      supabaseRowToJob(row)?.task_type || "none"
    )
  );

  const headers = buildHeaders(config);
  results.push(
    assertCase(
      "buildHeaders uses service role without printing key",
      headersContainServiceRole(headers, config.serviceRoleKey),
      headers.Authorization ? "Authorization header set" : "missing auth"
    )
  );
  results.push(
    assertCase(
      "contract test output does not echo service role key",
      !JSON.stringify(results).includes(config.serviceRoleKey),
      "key not echoed in prior results"
    )
  );

  const idFilter = postgrestFilter("id", postgrestUuidEq(SAMPLE_JOB_ID));
  results.push(
    assertCase(
      "getJob id filter uses unquoted uuid",
      idFilter === `id=eq.${SAMPLE_JOB_ID}` && !idFilter.includes('"'),
      idFilter
    )
  );

  const profileFilter = postgrestFilter(
    "target_worker_profile",
    postgrestEqValue("cloud-readonly")
  );
  results.push(
    assertCase(
      "target_worker_profile filter uses encoded text eq",
      profileFilter === "target_worker_profile=eq.cloud-readonly",
      profileFilter
    )
  );

  const unsafe = validateCreateJobInput({
    repo_ref: FIXTURE_REPO_REF,
    task_type: "inspect_only",
    risk_level: "high",
    requested_by: "xiaoju",
  });
  results.push(
    assertCase(
      "unsafe high risk rejected before persistence",
      unsafe.ok === false,
      unsafe.errors.join("; ")
    )
  );

  const joaValid = validateCreateJobInput({
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    workspace_ref: "C:\\projects\\TimOS-Agent",
    task_type: "inspect_only",
    risk_level: "low",
  });
  results.push(
    assertCase(
      "joa profile job validates",
      joaValid.ok === true,
      joaValid.errors.join("; ")
    )
  );

  const joaInvalidTask = validateCreateJobInput({
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    workspace_ref: "C:\\projects\\TimOS-Agent",
    task_type: "summarize_repo",
    risk_level: "low",
  });
  results.push(
    assertCase(
      "joa profile rejects summarize_repo",
      joaInvalidTask.ok === false,
      joaInvalidTask.errors.join("; ")
    )
  );

  const novaValid = validateCreateJobInput({
    target_worker_profile: "nova-reading",
    repo_ref: "TimOS-Agent",
    task_type: "inspect_only",
    risk_level: "low",
  });
  results.push(
    assertCase(
      "nova-reading profile job validates",
      novaValid.ok === true,
      novaValid.errors.join("; ")
    )
  );

  const joaJob = buildNewJobRecord({
    target_worker_profile: "joa",
    repo_ref: "TimOS-Agent",
    workspace_ref: "C:\\projects\\TimOS-Agent",
    task_type: "inspect_only",
    risk_level: "low",
  });
  results.push(
    assertCase(
      "buildNewJobRecord preserves requested target_worker_profile",
      joaJob.target_worker_profile === "joa",
      joaJob.target_worker_profile
    )
  );

  results.push(
    assertCase(
      "allowed worker profiles include joa",
      ALLOWED_WORKER_PROFILES.includes("joa"),
      ALLOWED_WORKER_PROFILES.join(", ")
    )
  );

  const store = new Map();

  const { fetchImpl, calls } = createMockFetch([
    async (url, options) => {
      if (url.endsWith("/command_channel_jobs") && options.method === "POST") {
        const body = JSON.parse(options.body);
        store.set(body.id, body);
        return mockJsonResponse(201, [body]);
      }
      return null;
    },
    async (url, options) => {
      if (url.includes("id=eq.") && options.method === "GET") {
        const id = decodeURIComponent(url.split("id=eq.")[1].split("&")[0]);
        const row = store.get(id);
        return mockJsonResponse(200, row ? [row] : []);
      }
      return null;
    },
    async (url, options) => {
      if (
        url.includes("status=eq.pending") &&
        url.includes("order=created_at.asc") &&
        options.method === "GET"
      ) {
        const rows = [...store.values()].filter((item) => item.status === "pending");
        rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return mockJsonResponse(200, rows.slice(0, 1));
      }
      return null;
    },
    async (url, options) => {
      if (url.includes("id=eq.") && options.method === "PATCH") {
        const id = decodeURIComponent(url.split("id=eq.")[1].split("&")[0]);
        const existing = store.get(id);
        if (!existing) {
          return mockJsonResponse(200, []);
        }
        const patch = JSON.parse(options.body);
        const merged = { ...existing, ...patch };
        store.set(id, merged);
        return mockJsonResponse(200, [merged]);
      }
      return null;
    },
    async (url, options) => {
      if (url.includes("order=created_at.desc") && options.method === "GET") {
        const rows = [...store.values()].sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
        return mockJsonResponse(200, rows);
      }
      return null;
    },
  ]);

  let fetchCountBeforeUnsafe = 0;
  try {
    await createJob(
      {
        repo_ref: FIXTURE_REPO_REF,
        task_type: "inspect_only",
        risk_level: "high",
      },
      { config, fetchImpl }
    );
  } catch {
    fetchCountBeforeUnsafe = calls.length;
  }
  results.push(
    assertCase(
      "createJob unsafe input makes zero fetch calls",
      fetchCountBeforeUnsafe === 0,
      `fetch calls=${fetchCountBeforeUnsafe}`
    )
  );

  const created = await createJob(
    {
      repo_ref: FIXTURE_REPO_REF,
      task_type: "inspect_only",
      risk_level: "low",
      requested_by: "xiaoju",
      prompt: "Inspect snapshot.",
    },
    { config, fetchImpl }
  );
  results.push(
    assertCase(
      "mocked createJob persists row",
      created.status === "pending" && created.id,
      created.id
    )
  );

  const read = await getJob(created.id, { config, fetchImpl });
  results.push(
    assertCase(
      "mocked getJob reads job",
      read?.id === created.id,
      read?.status || "none"
    )
  );

  const listed = await listJobs({ status: "pending" }, { config, fetchImpl });
  results.push(
    assertCase(
      "mocked listJobs returns jobs",
      listed.some((item) => item.id === created.id),
      `count=${listed.length}`
    )
  );

  const claimed = await claimJob("cloud-readonly", {
    jobId: created.id,
    config,
    fetchImpl,
  });
  results.push(
    assertCase(
      "mocked claimJob claims exact job id",
      claimed?.id === created.id && claimed?.status === "claimed",
      claimed?.status || "none"
    )
  );

  const finished = await submitResult(
    created.id,
    {
      status: "completed",
      worker_profile: "cloud-readonly",
      repo_ref: FIXTURE_REPO_REF,
      task_type: "inspect_only",
      summary: "done",
      errors: [],
    },
    { config, fetchImpl }
  );
  results.push(
    assertCase(
      "mocked submitResult stores completed status",
      finished?.status === "completed" && finished?.result?.summary === "done",
      finished?.status || "none"
    )
  );

  results.push(
    assertCase(
      "mocked fetch calls never include XIAOJU or WORKER tokens",
      calls.every(
        (call) =>
          !String(call.body || "").includes("XIAOJU_ACTION_TOKEN") &&
          !String(call.body || "").includes("WORKER_TOKEN")
      ),
      `calls=${calls.length}`
    )
  );

  return results;
}

async function runLiveChecks(liveEnv) {
  const results = [];

  process.env.SUPABASE_URL = liveEnv.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = liveEnv.serviceRoleKey;

  console.log("Live mode: using configured Supabase credentials from environment.");

  if (!isSupabaseConfigured()) {
    results.push(assertCase("live supabase configured", false, "missing env"));
    return results;
  }

  let liveJobId = null;

  try {
    const liveJob = await createJob({
      repo_ref: FIXTURE_REPO_REF,
      task_type: "inspect_only",
      risk_level: "low",
      requested_by: "contract-test",
      prompt: "Inspect snapshot for live contract test.",
    });
    liveJobId = liveJob.id;

    results.push(
      assertCase(
        "live create inspect_only job",
        liveJob.status === "pending" && liveJob.id,
        liveJob.id
      )
    );

    const liveRead = await getJob(liveJob.id);
    results.push(
      assertCase(
        "live getJob roundtrip",
        liveRead?.id === liveJob.id,
        liveRead?.status || "none"
      )
    );

    const liveList = await listJobs({ status: "pending" });
    results.push(
      assertCase(
        "live listJobs includes created job",
        liveList.some((item) => item.id === liveJob.id),
        `count=${liveList.length}`
      )
    );

    const liveClaimed = await claimJob("cloud-readonly", { jobId: liveJob.id });
    results.push(
      assertCase(
        "live claim exact job id",
        liveClaimed?.id === liveJob.id && liveClaimed?.status === "claimed",
        liveClaimed?.status || "none"
      )
    );

    const liveFinished = await submitResult(liveJob.id, {
      status: "completed",
      worker_profile: "cloud-readonly",
      repo_ref: FIXTURE_REPO_REF,
      task_type: "inspect_only",
      summary: "live contract test completed",
      errors: [],
    });
    results.push(
      assertCase(
        "live submit completed result",
        liveFinished?.status === "completed",
        liveFinished?.status || "none"
      )
    );

    const liveFinal = await getJob(liveJob.id);
    results.push(
      assertCase(
        "live final read shows completed",
        liveFinal?.status === "completed" &&
          liveFinal?.result?.summary === "live contract test completed",
        liveFinal?.status || "none"
      )
    );
  } catch (err) {
    results.push(
      assertCase("live supabase roundtrip", false, formatAdapterError(err))
    );
  }

  if (liveJobId) {
    console.log(`Live test job id (left as audit record): ${liveJobId}`);
  }

  return results;
}

async function runContractTests() {
  const liveEnv = {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const results = [];

  results.push(...(await runMissingEnvChecks()));
  results.push(...(await runMockAdapterChecks()));

  if (shouldRunLive) {
    if (!liveEnv.url || !liveEnv.serviceRoleKey) {
      results.push(
        assertCase(
          "live supabase configured",
          false,
          "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before running --live"
        )
      );
    } else {
      results.push(...(await runLiveChecks(liveEnv)));
    }
  } else {
    console.log("Dry contract mode (pass --live for real Supabase roundtrip).");
  }

  return results;
}

async function main() {
  console.log("Command channel Supabase contract test");
  console.log("");

  const results = await runContractTests();

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
  console.log("Filesystem smoke test remains separate: node scripts/command-channel-smoke-test.js");

  if (passed !== results.length) {
    process.exit(1);
  }

  console.log("Supabase contract test passed.");
}

main().catch((err) => {
  console.error(formatAdapterError(err));
  process.exit(1);
});
