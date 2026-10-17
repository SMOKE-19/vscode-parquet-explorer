"use strict";

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const pending = new Map();
let nextId = 1;
let querySequence = 0;
let activeRequestId;
let runtimeReady = false;
let setupBusy = false;
let setupInfo;
let rowOffset = 0;
let columnOffset = 0;
let activeRowLimit = 50;
let activeColumnLimit = 20;
let pinnedColumns = [];
let result;
let favoriteId;
let favorites = [];
let colorQuerySql;
const columnColors = new Map();
const CATEGORY_HUES = [210, 30, 150, 330, 90, 270, 0, 180];
const sqlEditor = window.PQSqlEditor.create($("sql-editor"), {
  onRun: () => runQuery(),
  onLint: (sql) => runtimeReady ? request("lint", { sql }) : Promise.resolve({ ok: true }),
});

function request(operation, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    vscode.postMessage({ id, operation, payload });
  });
}

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function setupControls(busy) {
  setupBusy = busy;
  $("runtime-setup").setAttribute("aria-busy", String(busy));
  for (const id of ["setup-choose", "setup-check", "setup-back", "runtime-retry"]) $(id).disabled = busy;
  $("setup-install").disabled = busy || !!setupInfo?.installing || !setupInfo?.uvAvailable;
  $("setup-progress").hidden = !busy && !setupInfo?.installing;
}

function renderSetup(info) {
  setupInfo = { ...setupInfo, ...info };
  $("runtime-environment").textContent = $("setup-environment").textContent = setupInfo.environment;
  $("runtime-python").textContent = $("setup-python").textContent = setupInfo.currentPython;
  $("setup-directory").textContent = setupInfo.venv;
  $("runtime-directory").textContent = $("setup-manual-directory").textContent = setupInfo.directory;
  $("runtime-commands").textContent = $("setup-commands").textContent = setupInfo.commands;
  $("setup-uv").hidden = setupInfo.uvAvailable !== false;
  $("setup-uv-reason").textContent = setupInfo.uvError || "";
  if (setupInfo.log !== undefined) $("setup-log").textContent = setupInfo.log;
  setupControls(setupBusy);
}

async function setupAction(operation) {
  if (setupBusy) return;
  setupControls(true);
  $("setup-error").textContent = "";
  $("setup-status").textContent = operation === "setup.install" ? "환경 준비 중…" : "환경 확인 중…";
  try {
    const response = await request(operation);
    if (operation === "setup.info") {
      renderSetup(response);
      $("setup-status").textContent = response.installing ? "다른 탭에서 환경을 설치 중입니다…" : response.uvAvailable ? "설치를 시작하거나 기존 Python을 선택하세요." : "uv 설치 후 다시 확인하세요. 기존 Python도 선택할 수 있습니다.";
    } else if (response?.cancelled) $("setup-status").textContent = "Python 선택을 취소했습니다.";
  } catch (error) {
    $("setup-error").textContent = String(error.message || error);
    $("setup-status").textContent = "설정을 완료하지 못했습니다. 다시 시도하거나 로그를 확인하세요.";
    if (operation === "setup.retry" && $("runtime-setup").hidden) {
      $("runtime-required").hidden = true;
      $("runtime-setup").hidden = false;
    }
  } finally { setupControls(false); }
}

function formatCell(value) {
  if (value === null) return "NULL";
  if (value?.__pq_truncated__) return value.preview;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${unit === 0 ? size.toLocaleString() : size.toFixed(2)} ${units[unit]}`;
}

function categoryKey(value) {
  if (value === null) return "null";
  return `${typeof value}:${typeof value === "object" ? JSON.stringify(value) : value}`;
}

function categoryColors(rows, column, columnIndex) {
  if (rows.length < 2) return null;
  const absoluteIndex = column.index ?? result.column_offset + columnIndex;
  let colors = columnColors.get(absoluteIndex);
  const keys = new Set();
  for (const row of rows) keys.add(categoryKey(row[columnIndex]));
  if (keys.size === rows.length) return null;
  if (!colors) {
    colors = new Map();
    columnColors.set(absoluteIndex, colors);
  }
  let rotation = absoluteIndex;
  for (const letter of column.name) rotation = (rotation * 33 + letter.charCodeAt(0)) % 360;
  for (const key of keys) {
    if (!colors.has(key)) {
      const index = colors.size;
      const hue = index < CATEGORY_HUES.length
        ? CATEGORY_HUES[index]
        : (315 + (index - CATEGORY_HUES.length) * 137.508) % 360;
      colors.set(key, Math.round((hue + rotation) % 360));
    }
  }
  return colors;
}

function favoriteError(error) {
  $("favorites-error").textContent = String(error.message || error);
}

function renderFavorites() {
  const list = $("favorites-list");
  list.replaceChildren();
  const term = $("favorites-search").value.trim().toLocaleLowerCase();
  const sort = $("favorites-sort").value;
  const visible = favorites.filter((item) => [item.alias, item.description, item.preview]
    .some((value) => String(value || "").toLocaleLowerCase().includes(term)));
  visible.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (sort === "alias") return a.alias.localeCompare(b.alias);
    const key = { frequent: "useCount", used: "lastUsedAt", updated: "updatedAt" }[sort];
    const difference = sort === "frequent" ? (b[key] || 0) - (a[key] || 0) : String(b[key] || "").localeCompare(String(a[key] || ""));
    return difference || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = term ? "검색 결과가 없습니다." : "저장된 SQL 즐겨찾기가 없습니다.";
    list.append(empty);
    return;
  }
  for (const item of visible) {
    const row = document.createElement("div");
    row.className = "favorite-item";
    row.setAttribute("role", "listitem");
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "favorite-pin";
    pin.textContent = item.pinned ? "★" : "☆";
    pin.setAttribute("aria-pressed", String(Boolean(item.pinned)));
    pin.setAttribute("aria-label", item.pinned ? `${item.alias} 고정 해제` : `${item.alias} 상단 고정`);
    pin.title = item.pinned ? "고정 해제" : "상단 고정";
    pin.addEventListener("click", async () => {
      pin.disabled = true;
      try {
        const updated = await request("favorites.pin", { id: item.id });
        favorites = favorites.map((entry) => entry.id === item.id ? updated : entry);
        renderFavorites();
      } catch (error) { favoriteError(error); pin.disabled = false; }
    });
    const content = document.createElement("button");
    content.type = "button";
    content.className = "favorite-content";
    const alias = document.createElement("strong");
    alias.textContent = item.alias;
    content.append(alias);
    if (item.description) {
      const description = document.createElement("small");
      description.textContent = item.description;
      description.title = item.description;
      content.append(description);
    }
    const code = document.createElement("small");
    code.textContent = item.preview || "";
    code.title = item.preview || "";
    content.append(code);
    content.addEventListener("click", async () => {
      try {
        const picked = await request("favorites.get", { id: item.id });
        favoriteId = picked.id;
        sqlEditor.setValue(picked.sql);
        closeFavorites();
        sqlEditor.focus();
        status(`즐겨찾기 선택: ${picked.alias}`);
      } catch (error) { favoriteError(error); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "favorite-delete";
    remove.textContent = "✕";
    remove.title = "즐겨찾기 삭제";
    remove.setAttribute("aria-label", `${item.alias} 삭제`);
    remove.addEventListener("click", async () => {
      try {
        const response = await request("favorites.remove", { id: item.id });
        if (!response.removed) return;
        favorites = favorites.filter((entry) => entry.id !== item.id);
        if (favoriteId === item.id) favoriteId = undefined;
        renderFavorites();
      } catch (error) { favoriteError(error); }
    });
    row.append(pin, content, remove);
    list.append(row);
  }
}

function closeFavorites() {
  $("favorites-dialog").hidden = true;
  $("pick-favorite").focus();
}

async function openFavorites() {
  $("favorites-dialog").hidden = false;
  $("favorites-error").textContent = "";
  $("favorites-search").focus();
  try {
    const response = await request("favorites.list");
    $("favorites-path").textContent = response.folder;
    favorites = response.items;
    renderFavorites();
  } catch (error) { favoriteError(error); }
}

function render(resultValue) {
  result = resultValue;
  if (colorQuerySql !== result.sql) {
    colorQuerySql = result.sql;
    columnColors.clear();
  }
  const palettes = result.columns.map((column, index) => categoryColors(result.rows, column, index));
  const wrap = $("table-wrap");
  wrap.replaceChildren();
  if (!result.rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "조회된 행이 없습니다.";
    wrap.append(empty);
  } else {
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const header = document.createElement("tr");
    const number = document.createElement("th");
    number.className = "row-number";
    number.textContent = "#";
    header.append(number);
    for (const [index, column] of result.columns.entries()) {
      const th = document.createElement("th");
      const pin = document.createElement("button");
      const isPinned = pinnedColumns.includes(column.index);
      pin.className = "column-pin";
      pin.textContent = isPinned ? "★" : "☆";
      pin.setAttribute("aria-label", `${column.name} 칼럼 ${isPinned ? "고정 해제" : "고정"}`);
      pin.setAttribute("aria-pressed", String(isPinned));
      pin.title = isPinned ? "칼럼 고정 해제" : "칼럼 고정";
      pin.addEventListener("click", () => toggleColumnPin(column.index));
      th.append(pin, document.createTextNode(column.name));
      if (isPinned) th.classList.add("pinned-column");
      if (palettes[index]) th.title = "반복 값 색상은 현재 페이지 기준으로 적용됩니다.";
      const kind = document.createElement("small");
      kind.textContent = column.type;
      th.append(kind);
      header.append(th);
    }
    head.append(header);
    table.append(head);
    const body = document.createElement("tbody");
    result.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      const numberCell = document.createElement("td");
      numberCell.className = "row-number";
      numberCell.textContent = String(result.row_offset + rowIndex + 1);
      tr.append(numberCell);
      row.forEach((value, index) => {
        const td = document.createElement("td");
        if (pinnedColumns.includes(result.columns[index].index)) td.classList.add("pinned-column");
        const hue = palettes[index]?.get(categoryKey(value));
        if (hue !== undefined) {
          td.classList.add("category-cell");
          td.style.setProperty("--pq-category-hue", String(hue));
        }
        if (value === null) td.classList.add("null");
        const text = formatCell(value);
        if (value?.__pq_truncated__) {
          const count = document.createElement("span");
          count.className = "list-count truncated";
          count.textContent = "잘림";
          const size = value.original_bytes === undefined ? `미리보기 ${formatBytes(value.preview_bytes)}` : `원본 ${formatBytes(value.original_bytes)}`;
          count.title = `${value.type} · ${size}${value.item_count === undefined ? "" : ` · 전체 ${value.item_count.toLocaleString()}개 항목`}`;
          td.append(count);
        } else if (Array.isArray(value)) {
          const count = document.createElement("span");
          count.className = "list-count";
          count.textContent = `${value.length.toLocaleString()}개`;
          count.title = `리스트 원소 ${value.length.toLocaleString()}개`;
          td.append(count);
        }
        td.append(document.createTextNode(text.length > 240 ? `${text.slice(0, 237)}…` : text));
        td.title = value?.__pq_truncated__ ? `전송 상한으로 잘림${value.item_count === undefined ? "" : ` · 전체 ${value.item_count.toLocaleString()}개 항목`}` : text;
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    let pinnedLeft = number.getBoundingClientRect().width;
    for (const [index, column] of result.columns.entries()) {
      if (!pinnedColumns.includes(column.index)) continue;
      const left = `${pinnedLeft}px`;
      header.children[index + 1].style.left = left;
      for (const row of body.rows) row.cells[index + 1].style.left = left;
      pinnedLeft += header.children[index + 1].getBoundingClientRect().width;
    }
  }
  $("row-position").value = result.rows.length
    ? `${(result.row_offset + 1).toLocaleString()}-${(result.row_offset + result.rows.length).toLocaleString()}` : "—";
  const movingColumns = result.columns.filter((column) => !pinnedColumns.includes(column.index));
  $("column-position").value = movingColumns.length
    ? `${(movingColumns[0].index + 1).toLocaleString()}-${(movingColumns.at(-1).index + 1).toLocaleString()}` : "—";
  $("previous-page").disabled = result.row_offset === 0;
  $("next-page").disabled = !result.has_more;
  $("next-page").title = result.has_more ? "다음 페이지" : "현재 SQL 결과의 마지막 페이지입니다.";
  $("previous-columns").disabled = !result.has_previous_columns;
  $("next-columns").disabled = !result.has_more_columns;
  status(`${result.elapsed_ms} ms`);
}

async function query(nextRowOffset = 0, nextColumnOffset = 0, limits = {}) {
  if (!runtimeReady) return;
  const sequence = ++querySequence;
  const sql = sqlEditor.getValue();
  if (colorQuerySql !== undefined && colorQuerySql !== sql) {
    pinnedColumns = [];
    activeColumnLimit = Number($("column-limit").value);
  }
  status("DuckDB 조회 중…");
  $("run").disabled = true;
  $("cancel").disabled = false;
  activeRequestId = `query-${Date.now()}-${sequence}`;
  try {
    const response = await request("query", {
      sql,
      favorite_id: favoriteId,
      row_offset: nextRowOffset,
      page_size: limits.rows || activeRowLimit,
      column_offset: nextColumnOffset,
      column_limit: (limits.columns || activeColumnLimit) + pinnedColumns.length,
      pinned_column_indices: pinnedColumns,
      request_id: activeRequestId,
    });
    if (sequence !== querySequence) return;
    rowOffset = response.row_offset;
    columnOffset = response.column_offset;
    render(response);
  } catch (error) {
    if (sequence === querySequence) status(String(error.message || error), true);
  } finally {
    if (sequence === querySequence) {
      $("run").disabled = false;
      $("cancel").disabled = true;
      activeRequestId = undefined;
    }
  }
}

async function refreshMetadata() {
  const metadata = await request("meta");
  columnColors.clear();
  colorQuerySql = undefined;
  pinnedColumns = [];
  activeColumnLimit = Number($("column-limit").value);
  $("source").value = metadata.source_path;
  const rows = metadata.row_count == null ? "행 수는 빠른 미리보기에서 생략" : `행 ${metadata.row_count.toLocaleString()}`;
  $("meta").textContent = `${metadata.file_count.toLocaleString()} file(s) · ${formatBytes(metadata.file_bytes)} · 칼럼 ${metadata.column_count.toLocaleString()} · ${rows}`;
}

function runQuery() {
  query();
}

function toggleColumnPin(index) {
  if (!Number.isInteger(index)) return;
  if (pinnedColumns.includes(index)) {
    pinnedColumns = pinnedColumns.filter((item) => item !== index);
    activeColumnLimit += 1;
  }
  else {
    if (activeColumnLimit <= 1) {
      status("고정 칼럼 외에 이동할 칼럼이 최소 1개 필요합니다.", true);
      return;
    }
    pinnedColumns.push(index);
    activeColumnLimit -= 1;
  }
  query(rowOffset, 0);
}

window.addEventListener("message", async (event) => {
  const message = event.data;
  if (typeof message.id === "number") {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error));
    else call.resolve(message.result);
    return;
  }
  if (message.type === "startupError") {
    runtimeReady = false;
    $("meta").textContent = "DuckDB 작업자 시작 실패";
    if (message.setupRequired) {
      renderSetup(message.setup);
      $("runtime-reason").textContent = String(message.error).split("\n")[0];
      $("runtime-required").hidden = !$("runtime-setup").hidden;
      $("explorer-content").hidden = true;
    } else if (!$("runtime-setup").hidden) $("setup-error").textContent = message.error;
    else status(message.error, true);
  } else if (message.type === "setupProgress") {
    renderSetup({ installing: message.installing, log: message.log });
    $("setup-status").textContent = message.message;
  } else if (message.type === "ready") {
    runtimeReady = true;
    $("runtime-required").hidden = $("runtime-setup").hidden = true;
    $("explorer-content").hidden = false;
    try { await refreshMetadata(); await query(); }
    catch (error) { status(String(error.message || error), true); }
  }
});

$("setup-open").addEventListener("click", () => {
  $("runtime-required").hidden = true;
  $("runtime-setup").hidden = false;
  $("setup-title").focus();
  setupAction("setup.info");
});
$("setup-install").addEventListener("click", () => setupAction("setup.install"));
$("setup-choose").addEventListener("click", () => setupAction("setup.choose"));
$("setup-check").addEventListener("click", () => setupAction("setup.info"));
$("runtime-retry").addEventListener("click", () => setupAction("setup.retry"));
$("setup-uv-help").addEventListener("click", async () => {
  try { await request("setup.uvHelp"); }
  catch (error) { $("setup-error").textContent = String(error.message || error); }
});
$("setup-back").addEventListener("click", () => {
  $("runtime-setup").hidden = true;
  $("runtime-required").hidden = false;
  $("setup-open").focus();
});

$("run").addEventListener("click", runQuery);
$("cancel").addEventListener("click", async () => {
  if (!activeRequestId) return;
  $("cancel").disabled = true;
  status("DuckDB 조회를 취소하는 중…");
  try { await request("cancel", { request_id: activeRequestId }); }
  catch (error) { status(String(error.message || error), true); }
});
$("restart-worker").addEventListener("click", async () => {
  status("DuckDB 작업자를 재시작하는 중…");
  try { await request("restart"); await refreshMetadata(); await query(); }
  catch (error) { status(String(error.message || error), true); }
});
$("save-favorite").addEventListener("click", async () => {
  try {
    const saved = await request("favorites.save", { id: favoriteId, sql: sqlEditor.getValue() });
    if (!saved.cancelled) { favoriteId = saved.id; status(`즐겨찾기 저장: ${saved.alias}`); }
  } catch (error) { status(String(error.message || error), true); }
});
$("pick-favorite").addEventListener("click", async () => {
  await openFavorites();
});
$("favorites-close").addEventListener("click", closeFavorites);
$("favorites-dialog").addEventListener("click", (event) => {
  if (event.target === $("favorites-dialog")) closeFavorites();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("favorites-dialog").hidden) closeFavorites();
});
$("favorites-search").addEventListener("input", renderFavorites);
$("favorites-sort").addEventListener("change", renderFavorites);
$("favorites-copy").addEventListener("click", async () => {
  try { await request("favorites.copyPath"); $("favorites-error").textContent = "백업 폴더 경로를 복사했습니다."; }
  catch (error) { favoriteError(error); }
});
$("lint").addEventListener("click", async () => {
  try {
    const response = await request("lint", { sql: sqlEditor.getValue() });
    sqlEditor.applyLintResult(response);
    status(response.ok ? `SQL 정상 · ${response.elapsed_ms} ms` : response.message, !response.ok);
  }
  catch (error) { status(String(error.message || error), true); }
});
$("open-source").addEventListener("click", async () => {
  try { await request("source", { path: $("source").value }); await refreshMetadata(); await query(); }
  catch (error) { status(String(error.message || error), true); }
});
$("previous-page").addEventListener("click", () => {
  const count = Math.min(rowOffset, activeRowLimit);
  query(rowOffset - count, columnOffset, { rows: count });
});
$("next-page").addEventListener("click", () => query(rowOffset + result.rows.length, columnOffset));
$("previous-columns").addEventListener("click", () => {
  query(rowOffset, result.previous_column_offset);
});
$("next-columns").addEventListener("click", () => query(rowOffset, result.next_column_offset));
$("page-size").addEventListener("change", () => {
  activeRowLimit = Number($("page-size").value);
  query(0, columnOffset);
});
$("column-limit").addEventListener("change", () => {
  const selected = Number($("column-limit").value);
  if (selected <= pinnedColumns.length) {
    $("column-limit").value = String(activeColumnLimit + pinnedColumns.length);
    status("고정 칼럼 외에 이동할 칼럼이 최소 1개 필요합니다.", true);
    return;
  }
  activeColumnLimit = selected - pinnedColumns.length;
  query(rowOffset, 0);
});
vscode.postMessage({ type: "loaded" });
