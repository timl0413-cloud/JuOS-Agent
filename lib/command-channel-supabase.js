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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function postgrestEqValue(value) {
  return `eq.${encodeURIComponent(String(value))}`;
}

function postgrestUuidEq(uuid) {
  const str = String(uuid).trim();
  if (!UUID_RE.test(str)) {
    throw new Error(`Invalid job id UUID: ${uuid}`);
  }
  return `eq.${str}`;
}

function postgrestFilter(column, eqExpression) {
  return `${column}=${eqExpression}`;
}

function formatSupabaseFetchError(method, query, err) {
  const parts = [`Supabase fetch failed for ${method} ${TABLE_NAME}`];
  if (err?.name) {
    parts.push(`name=${err.name}`);
  }
  if (err?.message) {
    parts.push(`message=${err.message}`);
  }
  if (err?.cause?.code) {
    parts.push(`cause_code=${err.cause.code}`);
  } else if (err?.code) {
    parts.push(`code=${err.code}`);
  }
  if (err?.cause?.message) {
    parts.push(`cause_message=${err.cause.message}`);
  }
  if (query) {
    parts.push(`query=${query}`);
  }
  return parts.join("; ");
}

async function supabaseRequest(config, method, query = "", {
  body,
  prefer,
  fetchImpl = fetch,
} = {}) {
  const url = `${config.restBase}${query}`;
  let response;

  try {
    response = await fetchImpl(url, {
      method,
      headers: buildHeaders(config, prefer),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const wrapped = new Error(formatSupabaseFetchError(method, query, err));
    wrapped.code = "supabase_fetch_failed";
    wrapped.cause = err;
    wrapped.request = { method, query };
    throw wrapped;
  }

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
    err.request = { method, query };
    throw err;
  }

  return { status: response.status, data };
}

function buildListQuery(filter = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");

  if (filter.status) {
    params.set("status", postgrestEqValue(filter.status));
  }
  if (filter.requested_by) {
    params.set("requested_by", postgrestEqValue(filter.requested_by));
  }
  if (filter.target_worker_profile) {
    params.set(
      "target_worker_profile",
      postgrestEqValue(filter.target_worker_profile)
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
    `?${postgrestFilter("id", postgrestUuidEq(jobId))}&select=*`,
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
    `?${postgrestFilter("id", postgrestUuidEq(row.id))}` +
    `&${postgrestFilter("status", postgrestEqValue("pending"))}` +
    `&${postgrestFilter("target_worker_profile", postgrestEqValue(workerProfile))}`;

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
  if (!saved) {
    throw new Error(`Failed to claim job ${row.id}: no row updated`);
  }
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
    `?${postgrestFilter("status", postgrestEqValue("pending"))}` +
      `&${postgrestFilter("target_worker_profile", postgrestEqValue(workerProfile))}` +
      "&select=*&order=created_at.asc&limit=1",
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
    `?${postgrestFilter("id", postgrestUuidEq(jobId))}` +
      `&${postgrestFilter("status", postgrestEqValue("claimed"))}`,
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
  if (!saved) {
    throw new Error(`Failed to submit result for job ${jobId}: no row updated`);
  }
  return supabaseRowToJob(saved);
}

module.exports = {
  TABLE_NAME,
  DEFAULT_WORKER_PROFILE,
  getSupabaseConfig,
  isSupabaseConfigured,
  buildHeaders,
  postgrestEqValue,
  postgrestUuidEq,
  postgrestFilter,
  jobToSupabaseRow,
  supabaseRowToJob,
  createJob,
  getJob,
  listJobs,
  claimJob,
  submitResult,
};
