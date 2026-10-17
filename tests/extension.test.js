"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadExtension(vscode, bridge) {
  const filename = require.resolve("../extension");
  const original = Module._load;
  delete require.cache[filename];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === filename && request === "vscode") return vscode;
    if (parent?.filename === filename && request === "./bridge") return bridge;
    return original.call(this, request, parent, isMain);
  };
  try { return require(filename); }
  finally { Module._load = original; }
}

test("Parquet opens with the default custom editor while command and dataset folder still work", async () => {
  const manifest = require("../package.json");
  const editor = manifest.contributes.customEditors[0];
  assert.equal(editor.priority, "default");
  assert.deepEqual(editor.selector, [{ filenamePattern: "*.parquet" }]);
  assert.ok(manifest.activationEvents.includes(`onCustomEditor:${editor.viewType}`));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-explorer-editor-"));
  const source = { scheme: "file", fsPath: path.join(root, "sample.parquet") };
  const shard = { scheme: "file", fsPath: path.join(root, "part-00000000-00000.parquet") };
  const folder = { scheme: "file", fsPath: root };
  const starts = [];
  const opens = [];
  const panels = [];
  let provider;
  let command;
  function panel() {
    const value = {
      webview: {
        cspSource: "vscode-resource:",
        asWebviewUri: (uri) => ({ toString: () => uri.fsPath }),
        onDidReceiveMessage() {},
        postMessage() {},
      },
      onDidDispose() {},
    };
    panels.push(value);
    return value;
  }
  const vscode = {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Active: 1 },
    workspace: {
      fs: { stat: async (uri) => ({ type: uri.fsPath === root ? 2 : 1 }) },
      getWorkspaceFolder: () => ({ uri: folder }),
      getConfiguration: () => ({ get: (name, fallback) => name === "pythonPath" ? "python" : fallback }),
    },
    window: {
      registerCustomEditorProvider: (viewType, implementation) => {
        assert.equal(viewType, editor.viewType);
        provider = implementation;
        return { dispose() {} };
      },
      createWebviewPanel: () => panel(),
      showErrorMessage: (message) => { throw new Error(message); },
    },
    commands: {
      registerCommand: (name, implementation) => {
        assert.equal(name, "pqExplorer.openParquetExplorer");
        command = implementation;
        return { dispose() {} };
      },
      executeCommand: async (name, uri, viewType) => {
        opens.push({ name, uri, viewType });
        const document = await provider.openCustomDocument(uri);
        await provider.resolveCustomEditor(document, panel());
      },
    },
  };
  const bridge = {
    pythonCommand: () => "python",
    startBridge: async ({ source: sourcePath }) => {
      starts.push(sourcePath);
      return { request: async () => ({}), stop() {} };
    },
  };
  const extension = loadExtension(vscode, bridge);
  try {
    extension.activate({ extensionPath: path.resolve(__dirname, ".."), globalStorageUri: { fsPath: path.join(root, "global") }, subscriptions: [] });
    const document = await provider.openCustomDocument(source);
    await provider.resolveCustomEditor(document, panel());
    assert.equal(starts[0], source.fsPath);
    assert.match(panels[0].webview.html, /PQ Explorer/);

    await command(source);
    assert.deepEqual(opens[0], { name: "vscode.openWith", uri: source, viewType: editor.viewType });
    assert.equal(starts[1], source.fsPath);

    await command(folder);
    assert.equal(starts[2], folder.fsPath);
    assert.equal(opens.length, 1);

    await command(shard);
    assert.deepEqual(opens[1], { name: "vscode.openWith", uri: shard, viewType: editor.viewType });
    assert.equal(starts[3], shard.fsPath);
  } finally {
    extension.deactivate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("웹뷰 즐겨찾기는 저장 경로, 고정 상태, SQL을 확장 호스트에서 처리한다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-explorer-favorites-ui-"));
  const source = { scheme: "file", fsPath: path.join(root, "sample.parquet") };
  const replies = [];
  let receive;
  let provider;
  let copied;
  const bridgeCalls = [];
  const vscode = {
    Uri: { file: (fsPath) => ({ scheme: "file", fsPath }) },
    workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: root } }), getConfiguration: () => ({ get: (name, fallback) => name === "pythonPath" ? "python" : fallback }) },
    env: { clipboard: { writeText: async (value) => { copied = value; } } },
    commands: { registerCommand: () => ({ dispose() {} }) },
    window: {
      registerCustomEditorProvider: (_type, value) => { provider = value; return { dispose() {} }; },
      showInputBox: async (options) => options.title.includes("별칭") ? "매출" : "월간",
    },
  };
  const bridge = { pythonCommand: () => "python", startBridge: async () => ({ request: async (operation, payload) => { bridgeCalls.push({ operation, payload }); return {}; }, stop() {} }) };
  const extension = loadExtension(vscode, bridge);
  try {
    extension.activate({ extensionPath: path.resolve(__dirname, ".."), globalStorageUri: { fsPath: path.join(root, "global") }, subscriptions: [] });
    const document = await provider.openCustomDocument(source);
    await provider.resolveCustomEditor(document, {
      webview: {
        cspSource: "vscode-resource:",
        asWebviewUri: (uri) => ({ toString: () => uri.fsPath }),
        onDidReceiveMessage: (callback) => { receive = callback; },
        postMessage: (message) => replies.push(message),
      },
      onDidDispose() {},
    });
    await receive({ id: 1, operation: "favorites.save", payload: { sql: "SELECT 1" } });
    assert.equal(replies.at(-1).result.alias, "매출");
    const id = replies.at(-1).result.id;
    await receive({ id: 2, operation: "favorites.list" });
    assert.equal(replies.at(-1).result.folder, path.join(root, "global", "pq-explorer-sql-favorites"));
    assert.equal(replies.at(-1).result.items[0].pinned, false);
    await receive({ id: 3, operation: "favorites.pin", payload: { id } });
    assert.equal(replies.at(-1).result.pinned, true);
    await receive({ id: 4, operation: "favorites.get", payload: { id } });
    assert.equal(replies.at(-1).result.sql, "SELECT 1");
    await receive({ id: 5, operation: "favorites.copyPath" });
    assert.equal(copied, path.join(root, "global", "pq-explorer-sql-favorites"));
    await receive({ id: 6, operation: "favorites.pin", payload: { id } });
    assert.equal(replies.at(-1).result.pinned, false);
    await receive({ id: 7, operation: "query", payload: { sql: "SELECT 1", favorite_id: id, row_offset: 0, column_offset: 0 } });
    assert.deepEqual(bridgeCalls.at(-1), { operation: "query", payload: { sql: "SELECT 1", row_offset: 0, column_offset: 0, timeout_seconds: 30, include_total_rows: false } });
    await receive({ id: 8, operation: "favorites.list" });
    assert.equal(replies.at(-1).result.items[0].useCount, 1);
  } finally {
    extension.deactivate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
