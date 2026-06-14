const fs = require("fs");
const path = require("path");
const { ROOT, findWorkspace } = require("./config");

const POLICY_FILE = path.join(ROOT, "config", "auto-run-policy.json");

function loadAutoRunPolicy() {
  if (!fs.existsSync(POLICY_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isAutoRunEnabled() {
  const policy = loadAutoRunPolicy();
  return Boolean(policy && policy.enabled === true);
}

function promptIncludesPhrase(prompt, phrase) {
  return prompt.toLowerCase().includes(phrase.toLowerCase());
}

function promptContainsForbiddenPhrase(prompt, phrase) {
  const lower = prompt.toLowerCase();
  const phraseLower = phrase.toLowerCase();
  let searchFrom = 0;

  while (searchFrom < lower.length) {
    const idx = lower.indexOf(phraseLower, searchFrom);
    if (idx === -1) {
      return false;
    }

    const before = lower.slice(Math.max(0, idx - 12), idx).trim();
    const negated =
      before.endsWith("do not") ||
      before.endsWith("don't") ||
      before.endsWith("never") ||
      before.endsWith("without");

    if (!negated) {
      return true;
    }

    searchFrom = idx + phraseLower.length;
  }

  return false;
}

function workspaceMatchesAllowed(jobWorkspace, allowedWorkspaces) {
  const ws = findWorkspace(jobWorkspace);
  const candidates = new Set([String(jobWorkspace).toLowerCase()]);

  if (ws) {
    candidates.add(ws.id.toLowerCase());
    candidates.add(ws.name.toLowerCase());
  }

  return allowedWorkspaces.some((allowed) =>
    candidates.has(String(allowed).toLowerCase())
  );
}

function ruleMatchesJob(rule, job) {
  if (rule.allowed !== true) {
    return { matched: false, reason: `Rule ${rule.id} is not allowed` };
  }

  const checks = [
    ["station", job.station, rule.station],
    ["worker", job.worker, rule.worker],
    ["mode", job.mode, rule.mode],
    ["task_type", job.task_type, rule.task_type],
    ["risk_level", job.risk_level, rule.risk_level],
  ];

  for (const [field, actual, expected] of checks) {
    if (expected == null) {
      continue;
    }

    if (String(actual || "").toLowerCase() !== String(expected).toLowerCase()) {
      return {
        matched: false,
        reason: `${field} mismatch: expected "${expected}", got "${actual || ""}"`,
      };
    }
  }

  if (
    Array.isArray(rule.allowed_workspaces) &&
    rule.allowed_workspaces.length > 0 &&
    !workspaceMatchesAllowed(job.workspace, rule.allowed_workspaces)
  ) {
    return {
      matched: false,
      reason: `workspace "${job.workspace}" is not in allowed_workspaces`,
    };
  }

  const prompt = job.prompt || "";

  if (Array.isArray(rule.required_prompt_phrases)) {
    for (const phrase of rule.required_prompt_phrases) {
      if (!promptIncludesPhrase(prompt, phrase)) {
        return {
          matched: false,
          reason: `prompt missing required phrase: "${phrase}"`,
        };
      }
    }
  }

  if (Array.isArray(rule.forbidden_prompt_phrases)) {
    for (const phrase of rule.forbidden_prompt_phrases) {
      if (promptContainsForbiddenPhrase(prompt, phrase)) {
        return {
          matched: false,
          reason: `prompt contains forbidden phrase: "${phrase}"`,
        };
      }
    }
  }

  return {
    matched: true,
    reason: rule.description || `Matched policy rule ${rule.id}`,
  };
}

function evaluateJobForAutoRun(job) {
  if (!job.auto_run_requested) {
    return {
      eligible: false,
      policy_id: null,
      reason: "auto_run_requested is not true",
      required_approval: true,
    };
  }

  const policy = loadAutoRunPolicy();
  if (!policy) {
    return {
      eligible: false,
      policy_id: null,
      reason: "auto-run policy config is missing",
      required_approval: true,
    };
  }

  if (policy.enabled !== true) {
    return {
      eligible: false,
      policy_id: null,
      reason: "auto-run policy is disabled",
      required_approval: true,
    };
  }

  const rules = Array.isArray(policy.rules) ? policy.rules : [];

  for (const rule of rules) {
    const result = ruleMatchesJob(rule, job);
    if (result.matched) {
      return {
        eligible: true,
        policy_id: rule.id,
        reason: result.reason,
        required_approval: false,
      };
    }
  }

  const lastRule = rules[rules.length - 1];
  const fallbackReason =
    rules.length === 0
      ? "no auto-run policy rules configured"
      : "job does not match any auto-run policy rule";

  return {
    eligible: false,
    policy_id: null,
    reason: fallbackReason,
    required_approval: true,
  };
}

module.exports = {
  POLICY_FILE,
  loadAutoRunPolicy,
  isAutoRunEnabled,
  evaluateJobForAutoRun,
};
