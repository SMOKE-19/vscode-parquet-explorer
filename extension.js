"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vscode = require("vscode");
const { pythonCommand, startBridge } = require("./bridge");
const activeBridges = new Set();

function renderHtml(extensionPath, webview) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const script = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, "media", "explorer.js")));
  const style = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, "media", "explorer.css")));
  return fs.readFileSync(path.join(extensionPath, "media", "explorer.html"), "utf8")
    .replaceAll("__CSP_SOURCE__", webview.cspSource)
    .replaceAll("__NONCE__", nonce)
    .replaceAll("__SCRIPT_URI__", script.toString())
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

async function openExplorer(context, sourceUri) {
  const source = await selectSource(sourceUri);
  if (!source) return;
  const stat = await vscode.workspace.fs.stat(source);
  if (!(stat.type & vscode.FileType.Directory) && !source.fsPath.toLowerCase().endsWith(".parquet")) {
    vscode.window.showErrorMessage("Parquet 파일 또는 dataset 폴더를 선택하세요.");
    return;
  }
  const workspace = vscode.workspace.getWorkspaceFolder(source);
  const root = workspace?.uri.fsPath || path.dirname(source.fsPath);
  const configured = vscode.workspace.getConfiguration("pqExplorer", source).get("pythonPath", "");
  const python = pythonCommand(root, configured);
  const panel = vscode.window.createWebviewPanel(
    "pqExplorer.parquetExplorer",
    `PQ Explorer · ${path.basename(source.fsPath)}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))] },
  );
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
    if (!bridge) {
      panel.webview.postMessage({ id: message.id, error: "DuckDB 작업자가 아직 준비되지 않았습니다." });
      return;
    }
    try {
      const result = await bridge.request(message.operation, message.payload);
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

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand(
    "pqExplorer.openParquetExplorer",
    (uri) => openExplorer(context, uri),
  ));
}

function deactivate() {
  for (const bridge of activeBridges) bridge.stop();
  activeBridges.clear();
}

module.exports = { activate, deactivate };
