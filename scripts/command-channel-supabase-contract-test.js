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
} = require("../lib/command-channel-supabase");
const {
  validateCreateJobInput,
  buildNewJobRecord,
} = require("../lib/command-channel-core");

const shouldRunLive = process.argv.includes("--live");
const FIXTURE_REPO_REF = "timos-agent-snapshot";

function assertCase(name, condition, details = "") {
  return { name, passed: Boolean(condition), details };
}

function createMockFetch(handlers) {
  const calls = [];

  return {
    calls,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });

      for (const handler of handlers) {
        const result = handler(url, options);
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

function headersContainServiceRole(headers) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";
  return (
    headers.apikey === key &&
    headers.Authorization === `Bearer ${key}`
  );
}

async function runContractTests() {
  const results = [];
  const savedBackend = process.env.COMMAND_CHANNEL_BACKEND;
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.COMMAND_CHANNEL_BACKEND = "supabase";
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

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  results.push(
    assertCase(
      "supabase env present is detected",
      isSupabaseConfigured() === true,
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

  const headers = buildHeaders(getSupabaseConfig());
  results.push(
    assertCase(
      "buildHeaders uses service role without printing key",
      headersContainServiceRole(headers),
      headers.Authorization ? "Authorization header set" : "missing auth"
    )
  );
  results.push(
    assertCase(
      "contract test output does not echo service role key",
      !JSON.stringify(results).includes("test-service-role-key"),
      "key not echoed in prior results"
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

  const config = getSupabaseConfig();
  const store = new Map();

  const { fetchImpl, calls } = createMockFetch([
    (url, options) => {
      if (url.endsWith("/command_channel_jobs") && options.method === "POST") {
        const body = JSON.parse(options.body);
        store.set(body.id, body);
        return mockJsonResponse(201, [body]);
      }
      return null;
    },
    (url, options) => {
      if (url.includes("id=eq.") && options.method === "GET") {
        const id = decodeURIComponent(url.split("id=eq.")[1].split("&")[0]);
        const row = store.get(id);
        return mockJsonResponse(200, row ? [row] : []);
      }
      return null;
    },
    (url, options) => {
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
    (url, options) => {
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
    (url, options) => {
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

  if (shouldRunLive) {
    console.log("Live mode: requires real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    if (!isSupabaseConfigured()) {
      results.push(assertCase("live supabase configured", false, "missing env"));
    } else {
      try {
        const liveJob = await createJob({
          repo_ref: FIXTURE_REPO_REF,
          task_type: "summarize_repo",
          risk_level: "low",
          requested_by: "contract-test",
          prompt: "Summarize snapshot.",
        });
        const liveRead = await getJob(liveJob.id);
        results.push(
          assertCase(
            "live create/read roundtrip",
            liveRead?.id === liveJob.id,
            liveRead?.id || "none"
          )
        );
      } catch (err) {
        results.push(assertCase("live create/read roundtrip", false, err.message));
      }
    }
  } else {
    console.log("Dry contract mode (pass --live for real Supabase roundtrip).");
  }

  process.env.COMMAND_CHANNEL_BACKEND = savedBackend;
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
  console.error(err.message);
  process.exit(1);
});
