const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACES_FILE = path.join(ROOT, "config", "workspaces.json");
const WORKERS_FILE = path.join(ROOT, "config", "workers.json");
const RUNTIME_FILE = path.join(ROOT, "config", "runtime.json");
const PACKAGE_FILE = path.join(ROOT, "package.json");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadWorkspaces() {
  const data = loadJson(WORKSPACES_FILE);
  return data.workspaces || [];
}

function loadWorkers() {
  const data = loadJson(WORKERS_FILE);
  return data.workers || [];
}

function loadRuntime() {
  return loadJson(RUNTIME_FILE);
}

function loadPackageVersion() {
  return loadJson(PACKAGE_FILE).version;
}

function findWorkspace(idOrName) {
  const key = idOrName.toLowerCase();
  return loadWorkspaces().find(
    (ws) =>
      ws.id.toLowerCase() === key || ws.name.toLowerCase() === key
  );
}

function findWorker(idOrName) {
  const key = idOrName.toLowerCase();
  return loadWorkers().find(
    (worker) =>
      worker.id.toLowerCase() === key || worker.name.toLowerCase() === key
  );
}

function isPathUnderRoot(targetPath, rootPath) {
  const resolved = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolved);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

module.exports = {
  ROOT,
  loadWorkspaces,
  loadWorkers,
  loadRuntime,
  loadPackageVersion,
  findWorkspace,
  findWorker,
  isPathUnderRoot,
};
