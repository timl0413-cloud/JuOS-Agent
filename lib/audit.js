const fs = require("fs");
const path = require("path");
const { ROOT } = require("./config");
const { nowIso } = require("./jobs");

const AUDIT_DIR = path.join(ROOT, "data", "audit");

function ensureAuditDir() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

function auditFilePath(jobId, timestamp) {
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  return path.join(AUDIT_DIR, `${safeTimestamp}-${jobId}.json`);
}

function writeAutoRunAudit(entry) {
  ensureAuditDir();

  const timestamp = entry.timestamp || nowIso();
  const filePath =
    entry._audit_file ||
    auditFilePath(entry.job_id, timestamp);

  const record = {
    job_id: entry.job_id,
    timestamp,
    auto_run_requested: entry.auto_run_requested === true,
    eligible: entry.eligible === true,
    policy_id: entry.policy_id || null,
    reason: entry.reason || "",
    workspace: entry.workspace || null,
    worker: entry.worker || null,
    mode: entry.mode || null,
    task_type: entry.task_type || null,
    risk_level: entry.risk_level || null,
    started_run: entry.started_run === true,
    completed_status: entry.completed_status || null,
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n");
  return { ...record, _audit_file: filePath };
}

function updateAutoRunAudit(auditFile, updates) {
  if (!auditFile || !fs.existsSync(auditFile)) {
    return writeAutoRunAudit(updates);
  }

  const existing = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  const merged = {
    ...existing,
    ...updates,
    timestamp: existing.timestamp,
    _audit_file: auditFile,
  };

  return writeAutoRunAudit(merged);
}

module.exports = {
  AUDIT_DIR,
  writeAutoRunAudit,
  updateAutoRunAudit,
};
