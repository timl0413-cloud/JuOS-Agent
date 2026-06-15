const {
  TABLE_NAME,
  assertCreateJobInput,
  buildNewJobRecord,
  jobToSupabaseRow,
  supabaseRowToJob,
  nowIso,
  DEFAULT_WORKER_PROFILE,
} = require("./command-channel-core");

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    const err = new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for supabase backend"
    );
    err.code = "supabase_not_configured";
    throw err;
  }

  return {
    url: url.replace(/\/$/, ""),
    serviceRoleKey,
    restBase: `${url.replace(/\/$/, "")}/rest/v1/${TABLE_NAME}`,
  };
}

function isSupabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function buildHeaders(config, prefer = "return=representation") {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function supabaseRequest(config, method, query = "", {
  body,
  prefer,
  fetchImpl = fetch,
} = {}) {
  const url = `${config.restBase}${query}`;
  const response = await fetchImpl(url, {
    method,
    headers: buildHeaders(config, prefer),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return { status: response.status, data };
}

function buildListQuery(filter = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");

  if (filter.status) {
    params.set("status", `eq.${filter.status}`);
  }
  if (filter.requested_by) {
    params.set("requested_by", `eq.${filter.requested_by}`);
  }
  if (filter.target_worker_profile) {
    params.set(
      "target_worker_profile",
      `eq.${filter.target_worker_profile}`
    );
  }

  return `?${params.toString()}`;
}

async function createJob(input, options = {}) {
  assertCreateJobInput(input);

  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;
  const job = buildNewJobRecord(input);
  const row = jobToSupabaseRow(job);

  const response = await supabaseRequest(
    config,
    "POST",
    "",
    {
      body: row,
      prefer: "return=representation",
      fetchImpl,
    }
  );

  const saved = Array.isArray(response.data) ? response.data[0] : response.data;
  return supabaseRowToJob(saved);
}

async function getJob(jobId, options = {}) {
  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;

  const response = await supabaseRequest(
    config,
    "GET",
    `?id=eq.${encodeURIComponent(jobId)}&select=*`,
    { fetchImpl }
  );

  const rows = Array.isArray(response.data) ? response.data : [];
  return supabaseRowToJob(rows[0] || null);
}

async function listJobs(filter = {}, options = {}) {
  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;

  const response = await supabaseRequest(
    config,
    "GET",
    buildListQuery(filter),
    { fetchImpl }
  );

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.map(supabaseRowToJob);
}

async function claimPendingRow(config, row, workerProfile, fetchImpl) {
  const claimedAt = nowIso();
  const patchQuery =
    `?id=eq.${encodeURIComponent(row.id)}` +
    `&status=eq.pending` +
    `&target_worker_profile=eq.${encodeURIComponent(workerProfile)}`;

  const response = await supabaseRequest(config, "PATCH", patchQuery, {
    body: {
      status: "claimed",
      claimed_at: claimedAt,
      claimed_by: workerProfile,
      updated_at: claimedAt,
    },
    prefer: "return=representation",
    fetchImpl,
  });

  const saved = Array.isArray(response.data) ? response.data[0] : response.data;
  return supabaseRowToJob(saved);
}

async function claimJob(workerProfile, options = {}) {
  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;
  const profileKey = String(workerProfile).toLowerCase();

  if (options.jobId) {
    const existing = await getJob(options.jobId, { config, fetchImpl });
    if (!existing) {
      throw new Error(`Job not found: ${options.jobId}`);
    }

    if (existing.status !== "pending") {
      throw new Error(
        `Job ${options.jobId} is not pending (currently ${existing.status})`
      );
    }

    if (
      String(existing.target_worker_profile).toLowerCase() !== profileKey
    ) {
      throw new Error(
        `Worker profile mismatch for job ${options.jobId}: expected "${workerProfile}", got "${existing.target_worker_profile}"`
      );
    }

    return claimPendingRow(config, existing, workerProfile, fetchImpl);
  }

  const pendingResponse = await supabaseRequest(
    config,
    "GET",
    `?status=eq.pending&target_worker_profile=eq.${encodeURIComponent(workerProfile)}&select=*&order=created_at.asc&limit=1`,
    { fetchImpl }
  );

  const pendingRows = Array.isArray(pendingResponse.data)
    ? pendingResponse.data
    : [];

  if (pendingRows.length === 0) {
    return null;
  }

  return claimPendingRow(
    config,
    supabaseRowToJob(pendingRows[0]),
    workerProfile,
    fetchImpl
  );
}

async function submitResult(jobId, result, options = {}) {
  const config = options.config || getSupabaseConfig();
  const fetchImpl = options.fetchImpl || fetch;

  const existing = await getJob(jobId, { config, fetchImpl });
  if (!existing) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (existing.status !== "claimed") {
    throw new Error(
      `Job ${jobId} is not claimed (currently ${existing.status})`
    );
  }

  const terminalStatus =
    result?.status === "completed" ? "completed" : "failed";
  const completedAt = nowIso();

  const response = await supabaseRequest(
    config,
    "PATCH",
    `?id=eq.${encodeURIComponent(jobId)}&status=eq.claimed`,
    {
      body: {
        status: terminalStatus,
        completed_at: completedAt,
        updated_at: completedAt,
        result: result || null,
        errors: Array.isArray(result?.errors) ? result.errors : [],
      },
      prefer: "return=representation",
      fetchImpl,
    }
  );

  const saved = Array.isArray(response.data) ? response.data[0] : response.data;
  return supabaseRowToJob(saved);
}

module.exports = {
  TABLE_NAME,
  DEFAULT_WORKER_PROFILE,
  getSupabaseConfig,
  isSupabaseConfigured,
  buildHeaders,
  jobToSupabaseRow,
  supabaseRowToJob,
  createJob,
  getJob,
  listJobs,
  claimJob,
  submitResult,
};
