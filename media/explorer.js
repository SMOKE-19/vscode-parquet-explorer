"use strict";

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const pending = new Map();
let nextId = 1;
let querySequence = 0;
let rowOffset = 0;
let columnOffset = 0;
let result;
let favoriteId;
let favorites = [];
let colorQuerySql;
const columnColors = new Map();
const CATEGORY_HUES = [210, 30, 150, 330, 90, 270, 0, 180];
const sqlEditor = window.PQSqlEditor.create($("sql-editor"), {
  onRun: () => query(),
  onLint: (sql) => request("lint", { sql }),
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

function formatCell(value) {
  if (value === null) return "NULL";
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
  const absoluteIndex = result.column_offset + columnIndex;
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
      th.textContent = column.name;
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
        const hue = palettes[index]?.get(categoryKey(value));
        if (hue !== undefined) {
          td.classList.add("category-cell");
          td.style.setProperty("--pq-category-hue", String(hue));
        }
        if (value === null) td.classList.add("null");
        const text = formatCell(value);
        if (Array.isArray(value)) {
          const count = document.createElement("span");
          count.className = "list-count";
          count.textContent = `${value.length.toLocaleString()}개`;
          count.title = `리스트 원소 ${value.length.toLocaleString()}개`;
          td.append(count);
        }
        td.append(document.createTextNode(text.length > 240 ? `${text.slice(0, 237)}…` : text));
        td.title = text;
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
  }
  const endRow = result.row_offset + result.rows.length;
  const endColumn = result.column_offset + result.columns.length;
  $("row-position").value = result.total_rows ? String(endRow) : "";
  $("row-position").max = String(result.total_rows);
  $("row-position").disabled = result.total_rows === 0;
  $("row-total").textContent = result.total_rows.toLocaleString();
  $("column-position").value = result.total_columns ? String(endColumn) : "";
  $("column-position").max = String(result.total_columns);
  $("column-position").disabled = result.total_columns === 0;
  $("column-total").textContent = result.total_columns.toLocaleString();
  $("previous-page").disabled = result.row_offset === 0;
  $("next-page").disabled = !result.has_more;
  $("next-page").title = result.has_more ? "다음 페이지" : "현재 SQL 결과의 마지막 페이지입니다.";
  $("previous-columns").disabled = !result.has_previous_columns;
  $("next-columns").disabled = !result.has_more_columns;
  status(`${result.elapsed_ms} ms`);
}

async function query(nextRowOffset = 0, nextColumnOffset = 0, limits = {}) {
  const sequence = ++querySequence;
  status("DuckDB 조회 중…");
  $("run").disabled = true;
  try {
    const response = await request("query", {
      sql: sqlEditor.getValue(),
      favorite_id: favoriteId,
      row_offset: nextRowOffset,
      page_size: limits.rows || Number($("page-size").value),
      column_offset: nextColumnOffset,
      column_limit: limits.columns || Number($("column-limit").value),
      timeout_seconds: 30,
    });
    if (sequence !== querySequence) return;
    rowOffset = response.row_offset;
    columnOffset = response.column_offset;
    render(response);
  } catch (error) {
    if (sequence === querySequence) status(String(error.message || error), true);
  } finally {
    if (sequence === querySequence) $("run").disabled = false;
  }
}

async function refreshMetadata() {
  const metadata = await request("meta");
  columnColors.clear();
  colorQuerySql = undefined;
  $("source").value = metadata.source_path;
  $("meta").textContent = `${metadata.file_count.toLocaleString()} file(s) · ${formatBytes(metadata.file_bytes)}`;
}

function jumpToPosition(kind) {
  if (!result) return;
  const rows = kind === "row";
  const input = $(rows ? "row-position" : "column-position");
  const total = rows ? result.total_rows : result.total_columns;
  const currentEnd = rows ? result.row_offset + result.rows.length : result.column_offset + result.columns.length;
  const target = Number(input.value);
  if (!Number.isSafeInteger(target) || target < 1 || target > total) {
    input.value = String(currentEnd);
    status(`${rows ? "행" : "칼럼"} 번호는 1~${total.toLocaleString()} 사이여야 합니다.`, true);
    return;
  }
  if (target === currentEnd) return;
  const selectedLimit = Number($(rows ? "page-size" : "column-limit").value);
  const limit = Math.min(selectedLimit, target);
  if (rows) query(target - limit, columnOffset, { rows: limit });
  else query(rowOffset, target - limit, { columns: limit });
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
    $("meta").textContent = "DuckDB 작업자 시작 실패";
    status(message.error, true);
  } else if (message.type === "ready") {
    try { await refreshMetadata(); await query(); }
    catch (error) { status(String(error.message || error), true); }
  }
});

$("run").addEventListener("click", () => query());
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
  const count = Math.min(rowOffset, Number($("page-size").value));
  query(rowOffset - count, columnOffset, { rows: count });
});
$("next-page").addEventListener("click", () => query(rowOffset + result.rows.length, columnOffset));
$("previous-columns").addEventListener("click", () => {
  const count = Math.min(columnOffset, Number($("column-limit").value));
  query(rowOffset, columnOffset - count, { columns: count });
});
$("next-columns").addEventListener("click", () => query(rowOffset, columnOffset + result.columns.length));
$("page-size").addEventListener("change", () => query(0, columnOffset));
$("column-limit").addEventListener("change", () => query(0, 0));
for (const [id, kind] of [["row-position", "row"], ["column-position", "column"]]) {
  const input = $(id);
  input.addEventListener("blur", () => jumpToPosition(kind));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
  });
}
vscode.postMessage({ type: "loaded" });
