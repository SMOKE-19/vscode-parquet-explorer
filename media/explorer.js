"use strict";

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const pending = new Map();
let nextId = 1;
let page = 0;
let columnOffset = 0;
let result;

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

function render(resultValue) {
  result = resultValue;
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
    for (const column of result.columns) {
      const th = document.createElement("th");
      th.textContent = column.name;
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
      row.forEach((value) => {
        const td = document.createElement("td");
        if (value === null) td.className = "null";
        const text = formatCell(value);
        td.textContent = text.length > 240 ? `${text.slice(0, 237)}…` : text;
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
  $("row-range").textContent = `${result.total_rows ? result.row_offset + 1 : 0}–${endRow} / ${result.total_rows}`;
  $("column-range").textContent = `${result.total_columns ? result.column_offset + 1 : 0}–${endColumn} / ${result.total_columns}`;
  $("previous-page").disabled = page === 0;
  $("next-page").disabled = !result.has_more;
  $("previous-columns").disabled = !result.has_previous_columns;
  $("next-columns").disabled = !result.has_more_columns;
  status(`${result.elapsed_ms} ms`);
}

async function query(nextPage = 0, nextColumnOffset = 0) {
  status("DuckDB 조회 중…");
  $("run").disabled = true;
  try {
    const response = await request("query", {
      sql: $("sql").value,
      page: nextPage,
      page_size: Number($("page-size").value),
      column_offset: nextColumnOffset,
      column_limit: 20,
      timeout_seconds: 30,
    });
    page = nextPage;
    columnOffset = nextColumnOffset;
    render(response);
  } catch (error) {
    status(String(error.message || error), true);
  } finally {
    $("run").disabled = false;
  }
}

async function refreshMetadata() {
  const metadata = await request("meta");
  $("source").value = metadata.source_path;
  $("meta").textContent = `${metadata.row_count.toLocaleString()} rows · ${metadata.column_count} columns · ${metadata.file_count} file(s)`;
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
$("sql").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); query(); }
});
$("lint").addEventListener("click", async () => {
  try { const response = await request("lint", { sql: $("sql").value }); status(`SQL 정상 · ${response.elapsed_ms} ms`); }
  catch (error) { status(String(error.message || error), true); }
});
$("open-source").addEventListener("click", async () => {
  try { await request("source", { path: $("source").value }); await refreshMetadata(); await query(); }
  catch (error) { status(String(error.message || error), true); }
});
$("previous-page").addEventListener("click", () => query(Math.max(0, page - 1), columnOffset));
$("next-page").addEventListener("click", () => query(page + 1, columnOffset));
$("previous-columns").addEventListener("click", () => query(page, Math.max(0, columnOffset - 20)));
$("next-columns").addEventListener("click", () => query(page, columnOffset + 20));
vscode.postMessage({ type: "loaded" });
