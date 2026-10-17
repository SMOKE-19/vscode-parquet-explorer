"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const runtimeModule = require("../runtime");

async function fixture(t, { start, install, validate, choose } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-setup-host-"));
  const replies = [];
  const starts = [];
  const stored = new Map();
  let provider, receive, disposePanel, runtime;
  class TestRuntime extends runtimeModule.RuntimeManager {
    constructor(options) { super(options); runtime = this; }
    async inspect(python) { return { ...this.describe(python), uvAvailable: false, uvError: "uv가 필요합니다." }; }
    async install() { return install ? install(this) : this.python; }
    async validate(python) { return validate ? validate(python) : { python, duckdb: "1.5.0" }; }
  }
  const vscode = {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }), parse: (value) => value },
    env: { remoteName: "ssh-remote", openExternal: async () => true },
    workspace: {
      getWorkspaceFolder: () => ({ uri: { fsPath: root } }),
      getConfiguration: () => ({ get: (_name, fallback) => fallback }),
    },
    window: {
      registerCustomEditorProvider: (_type, value) => { provider = value; return { dispose() {} }; },
      showOpenDialog: async () => choose ? choose() : [{ fsPath: "/chosen/python" }],
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
  };
  const bridge = { startBridge: async (options) => {
    starts.push(options.python);
    if (start) await start(options);
    else if (options.python === "python") throw Object.assign(new Error("duckdb가 없습니다."), { code: "MISSING_DUCKDB" });
    return { request: async () => ({}), stop() {} };
  } };
  const filename = require.resolve("../extension");
  const original = Module._load;
  delete require.cache[filename];
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === filename) {
      if (request === "vscode") return vscode;
      if (request === "./bridge") return bridge;
      if (request === "./runtime") return { ...runtimeModule, RuntimeManager: TestRuntime };
    }
    return original.call(this, request, parent, isMain);
  };
  let extension;
  try { extension = require(filename); } finally { Module._load = original; }
  t.after(() => { disposePanel?.(); extension.deactivate(); fs.rmSync(root, { recursive: true, force: true }); });
  extension.activate({
    extensionPath: path.resolve(__dirname, ".."), globalStorageUri: { fsPath: path.join(root, "global") }, subscriptions: [],
    globalState: { get: (key, fallback) => stored.get(key) ?? fallback, update: async (key, value) => { stored.set(key, value); } },
  });
  const document = { uri: { scheme: "file", fsPath: path.join(root, "sample.parquet") } };
  await provider.resolveCustomEditor(document, {
    webview: { cspSource: "file:", asWebviewUri: (uri) => ({ toString: () => uri.fsPath }), onDidReceiveMessage: (callback) => { receive = callback; }, postMessage: (message) => { replies.push(message); } },
    onDidDispose: (callback) => { disposePanel = callback; },
  });
  return { root, replies, starts, stored, runtime, receive, disposePanel };
}

test("startup failure is replayed after webview loads and setup inspection never installs", async (t) => {
  let installs = 0;
  const h = await fixture(t, { install: async () => { installs++; } });
  assert.equal(h.replies.length, 0);
  await h.receive({ type: "loaded" });
  assert.equal(h.replies[0].type, "startupError");
  assert.equal(h.replies[0].setupRequired, true);
  assert.match(h.replies[0].setup.environment, /Remote SSH/);
  await h.receive({ id: 1, operation: "setup.info" });
  assert.equal(h.replies.at(-1).result.uvAvailable, false);
  assert.equal(installs, 0);
  assert.equal(fs.existsSync(h.runtime.directory), false);
});

test("installing or selecting Python restarts the original file and remembers the choice", async (t) => {
  const h = await fixture(t);
  await h.receive({ type: "loaded" });
  await h.receive({ id: 1, operation: "setup.install" });
  assert.deepEqual(h.starts, ["python", h.runtime.python]);
  assert.equal(h.replies.at(-2).type, "ready");
  assert.deepEqual(h.replies.at(-1).result, { ready: true });
  assert.equal(h.stored.get("pythonSelections")[h.root].python, h.runtime.python);
  await h.receive({ id: 2, operation: "setup.choose" });
  assert.equal(h.starts.at(-1), "/chosen/python");
  assert.equal(h.stored.get("pythonSelections")[h.root].python, "/chosen/python");
  await h.receive({ type: "loaded" });
  assert.deepEqual(h.replies.at(-1), { type: "ready" });
});

test("invalid or cancelled Python selection preserves the current interpreter", async (t) => {
  const h = await fixture(t, { validate: async () => { throw new Error("Python에 DuckDB가 없습니다."); } });
  await h.receive({ type: "loaded" });
  await h.receive({ id: 1, operation: "setup.choose" });
  assert.match(h.replies.at(-1).error, /DuckDB/);
  assert.deepEqual(h.starts, ["python"]);
  assert.equal(h.stored.has("pythonSelections"), false);
  const cancelled = await fixture(t, { choose: () => undefined });
  await cancelled.receive({ id: 2, operation: "setup.choose" });
  assert.equal(cancelled.replies.at(-1).result.cancelled, true);
  assert.deepEqual(cancelled.starts, ["python"]);
});

test("closing a tab during installation never starts another worker or saves a selection", async (t) => {
  let complete;
  const h = await fixture(t, { install: (runtime) => new Promise((resolve) => { complete = () => resolve(runtime.python); }) });
  await h.receive({ type: "loaded" });
  const pending = h.receive({ id: 1, operation: "setup.install" });
  h.disposePanel();
  complete();
  await pending;
  assert.deepEqual(h.starts, ["python"]);
  assert.equal(h.stored.has("pythonSelections"), false);
});

test("file failures do not prompt Python installation", async (t) => {
  const h = await fixture(t, { start: async () => { throw new Error("Parquet 파일이 없습니다."); } });
  await h.receive({ type: "loaded" });
  assert.equal(h.replies[0].setupRequired, false);
});
