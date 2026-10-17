"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { pythonCommand } = require("../bridge");

const extensionRoot = path.resolve(__dirname, "..");
const python = process.env.SMOKING_TEST_PYTHON || pythonCommand(extensionRoot);
const worker = path.join(extensionRoot, "python", "worker.py");

test("missing DuckDB returns setup commands as a structured startup error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-setup space-"));
  try {
    // -S excludes installed dependencies even when the selected Python has DuckDB.
    const run = spawnSync(python, ["-S", worker, path.join(root, "sample.parquet"), root, "{}"], {
      encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONPATH: "" },
    });
    assert.equal(run.status, 1, run.error?.message || run.stderr);
    assert.equal(run.stderr, "");
    const message = JSON.parse(run.stdout);
    assert.equal(message.type, "startupError");
    assert.equal(message.code, "MISSING_DUCKDB");
    assert.ok(path.isAbsolute(message.python));
    assert.match(message.error, /uv venv \.venv --python 3\.13\nuv pip install duckdb/);
    assert.ok(message.error.includes(root));
    const interpreter = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    assert.ok(message.error.includes(interpreter));
    assert.match(message.error, /실행된 Python:/);
    assert.match(message.error, /기존 \.venv/);
    assert.match(message.error, /pqExplorer\.pythonPath/);
    assert.match(message.error, /WSL·Remote SSH/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("another missing dependency is not reported as missing DuckDB", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-other-dependency-"));
  try {
    fs.writeFileSync(path.join(root, "duckdb.py"), "raise ModuleNotFoundError(\"No module named 'other_dependency'\", name='other_dependency')\n");
    const run = spawnSync(python, ["-S", worker, path.join(root, "sample.parquet"), root, "{}"], {
      encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONPATH: root },
    });
    assert.equal(run.status, 1, run.error?.message || run.stderr);
    assert.equal(run.stderr, "");
    const message = JSON.parse(run.stdout);
    assert.equal(message.type, "startupError");
    assert.match(message.error, /other_dependency/);
    assert.doesNotMatch(message.error, /uv pip install duckdb/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
