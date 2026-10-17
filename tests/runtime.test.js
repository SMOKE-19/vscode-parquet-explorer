"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { RuntimeManager, runProcess, venvPython } = require("../runtime");
const { pythonCommand } = require("../bridge");

function fixture(t, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pq-runtime space-"));
  const values = new Map();
  const state = { get: (key, fallback) => values.get(key) ?? fallback, update: async (key, value) => { values.set(key, value); } };
  const runtime = new RuntimeManager({ storagePath: directory, state, run });
  t.after(() => { runtime.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, runtime, state };
}

test("opening setup only inspects uv and does not create or install an environment", async (t) => {
  const calls = [];
  const { directory, runtime } = fixture(t, async (command, args) => { calls.push({ command, args }); return { stdout: "uv 0.12\n" }; });
  const info = await runtime.inspect("python");
  assert.equal(info.uvAvailable, true);
  assert.equal(fs.existsSync(runtime.directory), false);
  assert.deepEqual(calls.map((call) => call.args), [["--version"]]);
  assert.ok(info.directory.startsWith(directory));
  assert.equal(info.commands, "uv venv .venv --python 3.13\nuv pip install duckdb");
});

test("installation is shared across tabs and targets the dedicated environment", async (t) => {
  const calls = [];
  let runtime;
  ({ runtime } = fixture(t, async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === "venv") {
      fs.mkdirSync(path.dirname(runtime.python), { recursive: true });
      fs.writeFileSync(runtime.python, "test interpreter");
    }
    options.onOutput?.("installer output\n");
    return { stdout: args[0] === "-c" ? JSON.stringify({ python: runtime.python, duckdb: "1.5.0" }) : "uv\n" };
  }));
  const progress = [];
  runtime.onProgress((message) => progress.push(message));
  const first = runtime.install();
  assert.equal(first, runtime.install());
  assert.equal(await first, runtime.python);
  assert.equal(calls.filter((call) => call.args[0] === "venv").length, 1);
  assert.deepEqual(calls.find((call) => call.args[0] === "pip").args, ["pip", "install", "--python", runtime.python, "duckdb>=1.4,<2"]);
  assert.ok(calls.filter((call) => ["venv", "pip"].includes(call.args[0])).every((call) => call.cwd === runtime.directory));
  assert.ok(progress.some((message) => message.log.includes("installer output")));
  assert.equal(progress.at(-1).installing, false);
});

test("failed installation can be retried without replacing an existing environment", async (t) => {
  let fail = true;
  let runtime;
  const calls = [];
  ({ runtime } = fixture(t, async (command, args) => {
    calls.push(args);
    if (args[0] === "venv") {
      fs.mkdirSync(path.dirname(runtime.python), { recursive: true });
      fs.writeFileSync(runtime.python, "existing interpreter");
    }
    if (args[0] === "pip" && fail) { fail = false; throw new Error("network unavailable"); }
    return { stdout: args[0] === "-c" ? JSON.stringify({ python: runtime.python, duckdb: "1.5.0" }) : "uv\n" };
  }));
  await assert.rejects(runtime.install(), /network unavailable/);
  assert.equal(runtime.installPromise, undefined);
  assert.match(runtime.log, /network unavailable/);
  await runtime.install();
  assert.equal(calls.filter((args) => args[0] === "venv").length, 1);
  assert.equal(fs.readFileSync(runtime.python, "utf8"), "existing interpreter");
});

test("missing uv keeps existing-Python selection available and does not create files", async (t) => {
  const { runtime } = fixture(t, async () => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); });
  const info = await runtime.inspect("python");
  assert.equal(info.uvAvailable, false);
  await assert.rejects(runtime.install(), { code: "UV_NOT_FOUND" });
  assert.equal(fs.existsSync(runtime.directory), false);
});

test("Python choice is restored per workspace while changed explicit settings take precedence", async (t) => {
  const { directory, runtime, state } = fixture(t, async () => ({}));
  const workspace = path.join(directory, "workspace");
  await runtime.remember(workspace, "", "/chosen/python");
  const reopened = new RuntimeManager({ storagePath: directory, state });
  t.after(() => reopened.dispose());
  assert.equal(reopened.selectedPython(workspace, ""), "/chosen/python");
  assert.equal(reopened.selectedPython(workspace, "/new/python"), "/new/python");
  assert.equal(reopened.selectedPython(path.join(directory, "another"), ""), "python");
  assert.equal(venvPython(directory, "win32"), path.join(directory, "Scripts", "python.exe"));
});

test("real Python validation and subprocess handling work with spaces and missing executables", async (t) => {
  const { directory, runtime } = fixture(t);
  const python = process.env.SMOKING_TEST_PYTHON || pythonCommand(path.resolve(__dirname, ".."));
  const result = await runtime.validate(python);
  assert.ok(path.isAbsolute(result.python));
  assert.match(result.duckdb, /^1\./);
  const value = "spaces ; $() ' \" remain arguments";
  const run = await runProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1])", value], { cwd: directory });
  assert.equal(run.stdout, value);
  await assert.rejects(runProcess(path.join(directory, "missing-executable"), []), { code: "ENOENT" });
});
