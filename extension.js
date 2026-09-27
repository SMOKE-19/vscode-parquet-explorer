"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vscode = require("vscode");
const { pythonCommand, startBridge } = require("./bridge");
const { FavoritesStore } = require("./favorites");
const activeBridges = new Set();
const VIEW_TYPE = "pqExplorer.parquetExplorer";

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

async function attachExplorer(context, panel, source, favorites) {
  const workspace = vscode.workspace.getWorkspaceFolder(source);
  const root = workspace?.uri.fsPath || path.dirname(source.fsPath);
  const configured = vscode.workspace.getConfiguration("pqExplorer", source).get("pythonPath", "");
  const python = pythonCommand(root, configured);
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
  };
  let bridge;
  let disposed = false;
  let webviewLoaded = false;
  panel.onDidDispose(() => {
    disposed = true;
    if (bridge) { activeBridges.delete(bridge); bridge.stop(); }
  });
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === "loaded") {
      webviewLoaded = true;
      if (bridge && !disposed) panel.webview.postMessage({ type: "ready" });
      return;
    }
    if (disposed || typeof message?.id !== "number") return;
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
      const payload = message.operation === "query" ? { ...message.payload } : message.payload;
      if (message.operation === "query") delete payload.favorite_id;
      const result = await bridge.request(message.operation, payload);
      if (message.operation === "query" && message.payload?.page === 0 && message.payload?.column_offset === 0) {
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
    bridge = await startBridge({ python, source: source.fsPath, root, extensionPath: context.extensionPath });
    if (disposed) { bridge.stop(); return; }
    activeBridges.add(bridge);
    if (webviewLoaded) panel.webview.postMessage({ type: "ready" });
  } catch (error) {
    if (!disposed) panel.webview.postMessage({ type: "startupError", error: `${error.message}\nPython: ${python}` });
  }
}

async function openExplorer(context, sourceUri, favorites) {
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
  return attachExplorer(context, panel, source, favorites);
}

function activate(context) {
  const favorites = new FavoritesStore(context.globalStorageUri.fsPath);
  context.subscriptions.push(vscode.commands.registerCommand(
    "pqExplorer.openParquetExplorer",
    (uri) => openExplorer(context, uri, favorites),
  ));
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, {
    openCustomDocument(uri) {
      return { uri, dispose() {} };
    },
    resolveCustomEditor(document, panel) {
      return attachExplorer(context, panel, document.uri, favorites);
    },
  }, { supportsMultipleEditorsPerDocument: true }));
}

function deactivate() {
  for (const bridge of activeBridges) bridge.stop();
  activeBridges.clear();
}

module.exports = { activate, deactivate };
