"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vscode = require("vscode");
const { startBridge } = require("./bridge");
const { FavoritesStore } = require("./favorites");
const { RuntimeManager, UV_HELP_URL } = require("./runtime");
const activeBridges = new Set();
const VIEW_TYPE = "pqExplorer.parquetExplorer";
let runtimeManager;

async function saveFavorite(store, payload) {
  let id = payload?.id;
  let original;
  if (id) {
    original = await store.get(id);
    const choice = await vscode.window.showQuickPick(["현재 즐겨찾기 수정", "새 즐겨찾기로 저장"], { title: "SQL 즐겨찾기 저장" });
    if (!choice) return { cancelled: true };
    if (choice === "새 즐겨찾기로 저장") { id = undefined; original = undefined; }
  }
  const alias = await vscode.window.showInputBox({ title: "SQL 즐겨찾기 별칭", value: original?.alias || "", prompt: "선택 창에 먼저 표시할 이름" });
  if (alias === undefined) return { cancelled: true };
  const description = await vscode.window.showInputBox({ title: "SQL 즐겨찾기 설명", value: original?.description || "", prompt: "선택 창에 표시할 설명 (선택 사항)" });
  if (description === undefined) return { cancelled: true };
  return store.save({ id, alias, description, sql: payload?.sql });
}

function renderHtml(extensionPath, webview) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const script = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, "media", "explorer.js")));
  const sqlEditorScript = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, "media", "sql-editor.js")));
  const style = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, "media", "explorer.css")));
  return fs.readFileSync(path.join(extensionPath, "media", "explorer.html"), "utf8")
    .replaceAll("__CSP_SOURCE__", webview.cspSource)
    .replaceAll("__NONCE__", nonce)
    .replaceAll("__SCRIPT_URI__", script.toString())
    .replaceAll("__SQL_EDITOR_URI__", sqlEditorScript.toString())
    .replaceAll("__STYLE_URI__", style.toString());
}

async function selectSource(uri) {
  if (uri?.scheme === "file") return uri;
  if (vscode.window.activeTextEditor?.document.uri.scheme === "file") {
    const active = vscode.window.activeTextEditor.document.uri;
    if (active.fsPath.toLowerCase().endsWith(".parquet")) return active;
  }
  const files = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    filters: { Parquet: ["parquet"] },
    openLabel: "Parquet 열기",
  });
  return files?.[0];
}

async function attachExplorer(context, panel, source, favorites, runtime) {
  const workspace = vscode.workspace.getWorkspaceFolder(source);
  const root = workspace?.uri.fsPath || path.dirname(source.fsPath);
  let configured = vscode.workspace.getConfiguration("pqExplorer", source).get("pythonPath", "");
  let python = runtime.selectedPython(root, configured);
  const configuration = vscode.workspace.getConfiguration("pqExplorer", source);
  const settings = {
    queryTimeoutSeconds: configuration.get("queryTimeoutSeconds", 30),
    exactResultCount: configuration.get("exactResultCount", false),
    memoryLimit: configuration.get("duckdbMemoryLimit", "2GB"),
    threads: configuration.get("duckdbThreads", 2),
    tempDirectory: configuration.get("duckdbTempDirectory", ""),
    maxTempSize: configuration.get("duckdbMaxTempSize", "10GB"),
    maxCellBytes: configuration.get("maxCellBytes", 65536),
  };
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
  };
  let bridge;
  let disposed = false;
  let webviewLoaded = false;
  let startupState;
  let runtimeBusy = false;
  const unsubscribe = runtime.onProgress((progress) => {
    if (!disposed && webviewLoaded) panel.webview.postMessage({ type: "setupProgress", ...progress });
  });
  function publish(state) {
    startupState = state;
    if (!disposed && webviewLoaded) panel.webview.postMessage(state);
  }
  function startupFailure(error, setupRequired = false) {
    publish({
      type: "startupError", error: `${error.message}\nPython: ${python}`,
      setupRequired: setupRequired || ["MISSING_DUCKDB", "UNSUPPORTED_PYTHON", "ENOENT", "EACCES"].includes(error.code),
      setup: runtime.describe(error.python || python),
    });
  }
  async function launchBridge(allowManagedFallback = false) {
    if (bridge) { activeBridges.delete(bridge); bridge.stop(); bridge = undefined; }
    let next;
    try { next = await startBridge({ python, source: source.fsPath, root, extensionPath: context.extensionPath, settings }); }
    catch (error) {
      const environmentMissing = ["MISSING_DUCKDB", "UNSUPPORTED_PYTHON", "ENOENT"].includes(error.code);
      if (!allowManagedFallback || configured || !environmentMissing || python === runtime.python || !fs.existsSync(runtime.python)) throw error;
      python = runtime.python;
      next = await startBridge({ python, source: source.fsPath, root, extensionPath: context.extensionPath, settings });
    }
    if (disposed) { next.stop(); return; }
    bridge = next;
    activeBridges.add(bridge);
  }
  panel.onDidDispose(() => {
    disposed = true;
    unsubscribe();
    if (bridge) { activeBridges.delete(bridge); bridge.stop(); }
  });
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === "loaded") {
      webviewLoaded = true;
      if (startupState && !disposed) panel.webview.postMessage(startupState);
      return;
    }
    if (disposed || typeof message?.id !== "number") return;
    if (message.operation?.startsWith("setup.")) {
      try {
        let result;
        if (message.operation === "setup.info") result = await runtime.inspect(python);
        else if (message.operation === "setup.uvHelp") {
          await vscode.env.openExternal(vscode.Uri.parse(UV_HELP_URL));
          result = {};
        } else {
          if (runtimeBusy) throw new Error("환경 설정을 진행 중입니다. 잠시 기다려 주세요.");
          runtimeBusy = true;
          try {
            let selected;
            if (message.operation === "setup.install") selected = await runtime.install();
            else if (message.operation === "setup.choose") {
              const selectedFiles = await vscode.window.showOpenDialog({
                title: "DuckDB가 설치된 Python 실행 파일 선택", openLabel: "이 Python 사용",
                canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
              });
              if (!selectedFiles?.length || disposed) result = { cancelled: true };
              else {
                const checked = await runtime.validate(selectedFiles[0].fsPath);
                selected = checked.python;
              }
            } else if (message.operation === "setup.retry") {
              configured = vscode.workspace.getConfiguration("pqExplorer", source).get("pythonPath", "");
              selected = runtime.selectedPython(root, configured);
            } else throw new Error("지원하지 않는 환경 설정 작업입니다.");
            if (selected && !disposed) {
              python = selected;
              await launchBridge(message.operation === "setup.retry");
              if (!disposed) {
                await runtime.remember(root, configured, python);
                publish({ type: "ready" });
                result = { ready: true };
              }
            }
          } finally { runtimeBusy = false; }
        }
        if (!disposed) panel.webview.postMessage({ id: message.id, result });
      } catch (error) {
        if (!disposed) {
          if (!bridge) startupFailure(error, true);
          panel.webview.postMessage({ id: message.id, error: String(error.message || error) });
        }
      }
      return;
    }
    if (message.operation === "restart") {
      try {
        if (runtimeBusy) throw new Error("환경 설정을 진행 중입니다. 잠시 기다려 주세요.");
        await launchBridge();
        if (!disposed) panel.webview.postMessage({ id: message.id, result: { restarted: true } });
      } catch (error) {
        if (!disposed) panel.webview.postMessage({ id: message.id, error: String(error.message || error) });
      }
      return;
    }
    try {
      if (message.operation?.startsWith("favorites.")) {
        let result;
        switch (message.operation) {
          case "favorites.save": result = await saveFavorite(favorites, message.payload); break;
          case "favorites.list": result = { folder: favorites.folder, items: await favorites.list() }; break;
          case "favorites.get": result = await favorites.get(message.payload?.id); break;
          case "favorites.pin": result = await favorites.togglePin(message.payload?.id); break;
          case "favorites.copyPath":
            await vscode.env.clipboard.writeText(favorites.folder);
            result = { copied: true };
            break;
          case "favorites.remove": {
            const item = await favorites.get(message.payload?.id);
            const confirmation = await vscode.window.showWarningMessage(`"${item.alias}" 즐겨찾기를 삭제할까요?`, { modal: true }, "삭제");
            if (confirmation === "삭제") await favorites.remove(item.id);
            result = { removed: confirmation === "삭제" };
            break;
          }
          default: throw new Error("지원하지 않는 즐겨찾기 작업입니다.");
        }
        if (!disposed) panel.webview.postMessage({ id: message.id, result });
        return;
      }
    } catch (error) {
      if (!disposed) panel.webview.postMessage({ id: message.id, error: String(error.message || error) });
      return;
    }
    if (!bridge) {
      panel.webview.postMessage({ id: message.id, error: "DuckDB 작업자가 아직 준비되지 않았습니다." });
      return;
    }
    try {
      const payload = message.operation === "query" ? {
        ...message.payload,
        timeout_seconds: settings.queryTimeoutSeconds,
        include_total_rows: settings.exactResultCount,
      } : message.payload;
      if (message.operation === "query") delete payload.favorite_id;
      const result = await bridge.request(message.operation, payload);
      const firstRows = message.payload?.row_offset === 0
        || (message.payload?.row_offset === undefined && (message.payload?.page ?? 0) === 0);
      if (message.operation === "query" && firstRows && message.payload?.column_offset === 0) {
        try { await favorites.recordUse(message.payload.favorite_id, message.payload.sql); }
        catch (error) { console.warn("PQ Explorer: 즐겨찾기 사용 횟수를 저장하지 못했습니다.", error); }
      }
      if (!disposed) panel.webview.postMessage({ id: message.id, result });
    } catch (error) {
      if (!disposed) panel.webview.postMessage({ id: message.id, error: String(error.message || error) });
    }
  });
  panel.webview.html = renderHtml(context.extensionPath, panel.webview);
  try {
    await launchBridge(true);
    if (disposed) return;
    publish({ type: "ready" });
  } catch (error) {
    if (!disposed) startupFailure(error);
  }
}

async function openExplorer(context, sourceUri, favorites, runtime) {
  const source = await selectSource(sourceUri);
  if (!source) return;
  const stat = await vscode.workspace.fs.stat(source);
  if (!(stat.type & vscode.FileType.Directory) && !source.fsPath.toLowerCase().endsWith(".parquet")) {
    vscode.window.showErrorMessage("Parquet 파일 또는 dataset 폴더를 선택하세요.");
    return;
  }
  if (!(stat.type & vscode.FileType.Directory)) {
    return vscode.commands.executeCommand("vscode.openWith", source, VIEW_TYPE);
  }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    `PQ Explorer · ${path.basename(source.fsPath)}`,
    vscode.ViewColumn.Active,
    { enableScripts: true },
  );
  return attachExplorer(context, panel, source, favorites, runtime);
}

function activate(context) {
  const favorites = new FavoritesStore(context.globalStorageUri.fsPath);
  const runtime = new RuntimeManager({ storagePath: context.globalStorageUri.fsPath, state: context.globalState, remoteName: vscode.env?.remoteName });
  runtimeManager = runtime;
  context.subscriptions.push(vscode.commands.registerCommand(
    "pqExplorer.openParquetExplorer",
    (uri) => openExplorer(context, uri, favorites, runtime),
  ));
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, {
    openCustomDocument(uri) {
      return { uri, dispose() {} };
    },
    resolveCustomEditor(document, panel) {
      return attachExplorer(context, panel, document.uri, favorites, runtime);
    },
  }, { supportsMultipleEditorsPerDocument: true }));
}

function deactivate() {
  runtimeManager?.dispose();
  for (const bridge of activeBridges) bridge.stop();
  activeBridges.clear();
}

module.exports = { activate, deactivate };
