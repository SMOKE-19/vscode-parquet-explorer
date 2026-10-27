import type { Bridge, SaveFavoriteResult, FavoriteSql, StartupMessage, RequestMessage, EngineOperation, Payload, QueryPayload, SourceMetadata } from "./shared/protocol";
export interface ExplorerOptions { initialSql?: string }
export interface ExplorerApi { apiVersion: 1; openDataset(uri?: vscode.Uri, options?: ExplorerOptions): Promise<unknown> }
import { errorMessage } from "./shared/errors";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { startBridge } from "./bridge";
import { FavoritesStore } from "./favorites";
const activeBridges = new Set<Bridge>();
const closingBridges = new Set<Promise<number>>();
const VIEW_TYPE = "pqExplorer.parquetExplorer";

function stopBridge(bridge: Bridge) {
  activeBridges.delete(bridge);
  const stopping = Promise.resolve(bridge.stop());
  closingBridges.add(stopping);
  void stopping.finally(() => closingBridges.delete(stopping));
  return stopping;
}

async function saveFavorite(store: FavoritesStore, payload?: { id?: string; sql?: string }): Promise<SaveFavoriteResult> {
  let id = payload?.id;
  let original: FavoriteSql | undefined;
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

function renderHtml(extensionPath: string, webview: vscode.Webview) {
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

async function selectSource(uri?: vscode.Uri) {
  if (uri?.scheme === "file") return uri;
  if (vscode.window.activeTextEditor?.document.uri.scheme === "file") {
    const active = vscode.window.activeTextEditor.document.uri;
    if (/\.(parquet|pq|csv|tsv|sbdf|xlsx)$/i.test(active.fsPath)) return active;
  }
  const files = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    filters: { "데이터 파일": ["parquet", "pq", "csv", "tsv", "sbdf", "xlsx"] },
    openLabel: "데이터 열기",
  });
  return files?.[0];
}

async function attachExplorer(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, source: vscode.Uri, favorites: FavoritesStore, initialSql?: string) {
  const workspace = vscode.workspace.getWorkspaceFolder(source);
  const root = workspace?.uri.fsPath || path.dirname(source.fsPath);
  let currentSource = source.fsPath;
  let currentSheet: string | undefined;
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
  let bridge: Bridge | undefined;
  let disposed = false;
  let webviewLoaded = false;
  let startupState: StartupMessage | undefined;
  let launching = false;
  function publish(state: StartupMessage) {
    if (state.type === "ready" && initialSql) state = { ...state, initialSql };
    startupState = state;
    if (!disposed && webviewLoaded) panel.webview.postMessage(state);
  }
  function startupFailure(error: unknown) {
    publish({ type: "startupError", error: errorMessage(error) });
  }
  async function launchBridge() {
    if (launching) throw new Error("DuckDB 작업자를 시작하는 중입니다. 잠시 기다려 주세요.");
    launching = true;
    try {
      if (bridge) { const previous = bridge; bridge = undefined; await stopBridge(previous); }
      if (disposed) return;
      const next = await startBridge({ source: currentSource, root, extensionPath: context.extensionPath, settings: { ...settings, sheet: currentSheet },
        onFailure(error) {
          if (bridge) void stopBridge(bridge);
          bridge = undefined;
          if (!disposed) startupFailure(error);
        },
      });
      if (disposed) { await stopBridge(next); return; }
      bridge = next;
      activeBridges.add(bridge);
    } finally { launching = false; }
  }
  panel.onDidDispose(() => {
    disposed = true;
    if (bridge) { void stopBridge(bridge); bridge = undefined; }
  });
  panel.webview.onDidReceiveMessage(async (message: RequestMessage | { type: "loaded"; id?: never; operation?: never }) => {
    if (message?.type === "loaded") {
      webviewLoaded = true;
      if (startupState && !disposed) panel.webview.postMessage(startupState);
      return;
    }
    if (disposed || typeof message?.id !== "number") return;
    if (message.operation === "restart") {
      try {
        await launchBridge();
        if (!disposed) {
          startupState = { type: "ready", ...(initialSql ? { initialSql } : {}) };
          panel.webview.postMessage({ id: message.id, result: { restarted: true, ...(initialSql ? { initialSql } : {}) } });
        }
      } catch (error) {
        if (!disposed) panel.webview.postMessage({ id: message.id, error: errorMessage(error) });
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
      if (!disposed) panel.webview.postMessage({ id: message.id, error: errorMessage(error) });
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
      if (message.operation === "query") delete (payload as QueryPayload).favorite_id;
      const result = await bridge.request(message.operation as EngineOperation, payload as Payload<EngineOperation>);
      if (message.operation === "source") { currentSource = (result as SourceMetadata).source_path; currentSheet = (result as SourceMetadata).selected_sheet ?? undefined; }
      const firstRows = (message.payload as QueryPayload | undefined)?.row_offset === 0
        || ((message.payload as QueryPayload | undefined)?.row_offset === undefined && ((message.payload as QueryPayload | undefined)?.page ?? 0) === 0);
      if (message.operation === "query" && firstRows && (message.payload as QueryPayload | undefined)?.column_offset === 0) {
        try { await favorites.recordUse((message.payload as QueryPayload).favorite_id, (message.payload as QueryPayload).sql); }
        catch (error) { console.warn("PQ Explorer: 즐겨찾기 사용 횟수를 저장하지 못했습니다.", error); }
      }
      if (!disposed) panel.webview.postMessage({ id: message.id, result });
    } catch (error) {
      if (!disposed) panel.webview.postMessage({ id: message.id, error: errorMessage(error) });
    }
  });
  panel.webview.html = renderHtml(context.extensionPath, panel.webview);
  try {
    await launchBridge();
    if (disposed) return;
    publish({ type: "ready" });
  } catch (error) {
    if (!disposed) startupFailure(error);
  }
}

async function openExplorer(context: vscode.ExtensionContext, sourceUri: vscode.Uri | undefined, favorites: FavoritesStore, options: ExplorerOptions = {}) {
  const initialSql = options.initialSql;
  if (initialSql !== undefined && (typeof initialSql !== "string" || !initialSql.trim() || initialSql.length > 200000)) {
    throw new Error("initialSql은 비어 있지 않은 SQL 문자열이어야 합니다 (최대 200000자).");
  }
  const source = await selectSource(sourceUri);
  if (!source) return;
  const stat = await vscode.workspace.fs.stat(source);
  if (!(stat.type & vscode.FileType.Directory) && !/\.(parquet|pq|csv|tsv|sbdf|xlsx)$/i.test(source.fsPath)) {
    vscode.window.showErrorMessage("Parquet·CSV·TSV·SBDF·XLSX 파일 또는 Parquet dataset 폴더를 선택하세요.");
    return;
  }
  if (!(stat.type & vscode.FileType.Directory) && !initialSql) {
    return vscode.commands.executeCommand("vscode.openWith", source, VIEW_TYPE);
  }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    `PQ Explorer · ${path.basename(source.fsPath)}`,
    vscode.ViewColumn.Active,
    { enableScripts: true },
  );
  return attachExplorer(context, panel, source, favorites, initialSql);
}

function activate(context: vscode.ExtensionContext): ExplorerApi {
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
  return {
    apiVersion: 1,
    openDataset: (uri: vscode.Uri | undefined, options: ExplorerOptions = {}) => openExplorer(context, uri, favorites, options),
  };
}

async function deactivate() {
  for (const bridge of [...activeBridges]) void stopBridge(bridge);
  await Promise.all([...closingBridges]);
}

export { activate, deactivate };
