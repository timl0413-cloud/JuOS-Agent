#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "config", "juos-room-registry.json");
const DEFAULT_CONTRACTS_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "JuCore",
  "modules",
  "command-channel-contracts",
  "src"
);
const CONTRACTS_PATH =
  process.env.JUCORE_COMMAND_CHANNEL_CONTRACTS_PATH || DEFAULT_CONTRACTS_PATH;

const failures = [];

function addCheck(name, passed, detail) {
  const status = passed ? "PASS" : "FAIL";
  console.log(detail ? `${status} ${name} - ${detail}` : `${status} ${name}`);
  if (!passed) {
    failures.push(name);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort();
}

function sameSet(actual, expected) {
  const actualSorted = sortedUnique(actual);
  const expectedSorted = sortedUnique(expected);
  return (
    actualSorted.length === expectedSorted.length &&
    actualSorted.every((value, index) => value === expectedSorted[index])
  );
}

function formatSet(values) {
  return sortedUnique(values).join(", ");
}

function leadingSpaces(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function parseInlineEnum(line) {
  const match = line.match(/^\s*enum:\s*\[(.*)\]\s*$/);
  if (!match) {
    return null;
  }

  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseTargetWorkerProfileEnums(schemaText) {
  const lines = schemaText.split(/\r?\n/);
  const enumBlocks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*target_worker_profile:\s*$/.test(line)) {
      continue;
    }

    const targetIndent = leadingSpaces(line);
    const values = [];

    for (let j = i + 1; j < lines.length; j += 1) {
      const current = lines[j];
      if (current.trim() && leadingSpaces(current) <= targetIndent) {
        break;
      }

      const inlineEnum = parseInlineEnum(current);
      if (inlineEnum) {
        values.push(...inlineEnum);
        continue;
      }

      if (!/^\s*enum:\s*$/.test(current)) {
        continue;
      }

      const enumIndent = leadingSpaces(current);
      for (let k = j + 1; k < lines.length; k += 1) {
        const enumLine = lines[k];
        if (enumLine.trim() && leadingSpaces(enumLine) <= enumIndent) {
          break;
        }

        const valueMatch = enumLine.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
        if (valueMatch) {
          values.push(valueMatch[1]);
        }
      }
    }

    if (values.length > 0) {
      enumBlocks.push({
        line: i + 1,
        values: sortedUnique(values),
      });
    }
  }

  return enumBlocks;
}

console.log("JuOS command-channel contract parity test");
console.log("Mode: report-only validation; no registry, schema, worker, or backend files are modified.");
console.log(`Contracts path: ${CONTRACTS_PATH}`);
console.log("");

addCheck("registry exists", fs.existsSync(REGISTRY_PATH), path.relative(ROOT, REGISTRY_PATH));
if (!fs.existsSync(REGISTRY_PATH)) {
  process.exit(1);
}

let contracts;
try {
  contracts = require(CONTRACTS_PATH);
  addCheck("JuCore contracts import", true, CONTRACTS_PATH);
} catch (error) {
  addCheck("JuCore contracts import", false, error.message);
  process.exit(1);
}

const {
  REGISTRY_ACTIVE_WORKER_PROFILE_VALUES,
  ACTION_EXPOSED_WORKER_PROFILE_VALUES,
} = contracts;

addCheck(
  "REGISTRY_ACTIVE_WORKER_PROFILE_VALUES exported",
  Array.isArray(REGISTRY_ACTIVE_WORKER_PROFILE_VALUES),
  Array.isArray(REGISTRY_ACTIVE_WORKER_PROFILE_VALUES)
    ? formatSet(REGISTRY_ACTIVE_WORKER_PROFILE_VALUES)
    : typeof REGISTRY_ACTIVE_WORKER_PROFILE_VALUES
);
addCheck(
  "ACTION_EXPOSED_WORKER_PROFILE_VALUES exported",
  Array.isArray(ACTION_EXPOSED_WORKER_PROFILE_VALUES),
  Array.isArray(ACTION_EXPOSED_WORKER_PROFILE_VALUES)
    ? formatSet(ACTION_EXPOSED_WORKER_PROFILE_VALUES)
    : typeof ACTION_EXPOSED_WORKER_PROFILE_VALUES
);
if (
  !Array.isArray(REGISTRY_ACTIVE_WORKER_PROFILE_VALUES) ||
  !Array.isArray(ACTION_EXPOSED_WORKER_PROFILE_VALUES)
) {
  process.exit(1);
}

const registry = readJson(REGISTRY_PATH);
const registryProfiles = sortedUnique(Object.keys(registry.profiles || {}));
const schemaPath = path.resolve(
  ROOT,
  registry.generated_schema || "docs/openapi/juos-actions.generated.openapi.yaml"
);

addCheck(
  "registry active profiles match JuCore contract",
  sameSet(registryProfiles, REGISTRY_ACTIVE_WORKER_PROFILE_VALUES),
  `actual=[${formatSet(registryProfiles)}] expected=[${formatSet(REGISTRY_ACTIVE_WORKER_PROFILE_VALUES)}]`
);
addCheck(
  "jub absent from registry profiles",
  !registryProfiles.includes("jub"),
  "config/juos-room-registry.json profiles"
);

addCheck("generated action schema exists", fs.existsSync(schemaPath), path.relative(ROOT, schemaPath));
if (!fs.existsSync(schemaPath)) {
  process.exit(1);
}

const schemaText = fs.readFileSync(schemaPath, "utf8");
const enumBlocks = parseTargetWorkerProfileEnums(schemaText);
const actionEnumValues = sortedUnique(enumBlocks.flatMap((block) => block.values));

addCheck(
  "action schema target_worker_profile enum blocks found",
  enumBlocks.length > 0,
  `${enumBlocks.length} block(s)`
);
addCheck(
  "action schema target_worker_profile enums match JuCore contract",
  sameSet(actionEnumValues, ACTION_EXPOSED_WORKER_PROFILE_VALUES),
  `actual=[${formatSet(actionEnumValues)}] expected=[${formatSet(ACTION_EXPOSED_WORKER_PROFILE_VALUES)}]`
);

for (const block of enumBlocks) {
  addCheck(
    `action schema enum block line ${block.line} matches JuCore contract`,
    sameSet(block.values, ACTION_EXPOSED_WORKER_PROFILE_VALUES),
    `actual=[${formatSet(block.values)}]`
  );
}

addCheck(
  "jub absent from action schema target_worker_profile enums",
  !actionEnumValues.includes("jub"),
  path.relative(ROOT, schemaPath)
);

console.log("");
if (failures.length > 0) {
  console.log(`Contract parity test failed: ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("Contract parity test passed.");
