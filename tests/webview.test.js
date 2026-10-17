"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("webview applies editable display counts on run, navigates results, and preserves favorite UI", (context) => {
  if (spawnSync("chromium", ["--version"], { encoding: "utf8" }).status !== 0) {
    context.skip("Chromium is unavailable"); return;
  }
  const media = path.resolve(__dirname, "../media");
  assert.ok(fs.existsSync(path.join(media, "sql-editor.js")), "run npm run build first");
  const nonce = "pq-test-nonce";
  const mock = `<script nonce="${nonce}">
    const queryRequests = [];
    const favoriteItems = [
      {id:"a",alias:"A",description:"첫 번째",preview:"SELECT 1",useCount:2,updatedAt:"2026-01-01",pinned:false},
      {id:"b",alias:"B",description:"두 번째",preview:"SELECT 2",useCount:1,updatedAt:"2026-01-01",pinned:false},
    ];
    const allColumns = [{name:"id",type:"INTEGER"},{name:"bucket",type:"VARCHAR"},{name:"near_unique",type:"INTEGER"},{name:"items",type:"INTEGER[]"},
      ...Array.from({length:41}, (_, index) => ({name:"c" + (index + 5),type:"INTEGER"}))];
    function queryResult(payload) {
      const start = payload.row_offset || 0;
      const columnStart = payload.column_offset || 0;
      const count = Math.max(0, Math.min(payload.page_size, 75 - start));
      const pinned = payload.pinned_column_indices || [];
      const available = allColumns.map((_, index) => index).filter((index) => !pinned.includes(index));
      const windowIndices = available.slice(columnStart, columnStart + payload.column_limit - pinned.length);
      const selectedIndices = [...pinned, ...windowIndices];
      const columns = selectedIndices.map((index) => ({...allColumns[index], index}));
      const rows = Array.from({length:count}, (_, index) => {
        const row = [start + index + 1,index % 2 ? (start ? "A" : "B") : (start ? "B" : "A"),index === count - 1 ? 1 : index + 1,[1,2,3],
          ...Array.from({length:41}, (_, column) => start + index + 1 + column * 1000)];
        return selectedIndices.map((column) => row[column]);
      });
      return {sql:payload.sql,rows,columns,row_offset:start,total_rows:75,total_columns:45,column_offset:columnStart,
        has_more:start + count < 75,has_more_columns:columnStart + windowIndices.length < available.length,
        has_previous_columns:columnStart > 0,previous_column_offset:Math.max(0,columnStart - (payload.column_limit - pinned.length)),
        next_column_offset:columnStart + windowIndices.length,elapsed_ms:2};
    }
    window.acquireVsCodeApi = () => ({postMessage(message) {
      const send = (value) => window.postMessage(value, "*");
      if (message.type === "loaded") { setTimeout(() => send({type:"ready"}), 0); return; }
      if (message.operation === "query") queryRequests.push(message.payload);
      const result = message.operation === "meta"
        ? {source_path:"/tmp/parts", source_kind:"dataset", file_count:2, column_count:45, row_count:75, file_bytes:1048576}
        : message.operation === "favorites.list"
          ? {folder:"/server/pq-explorer-sql-favorites",items:favoriteItems}
        : message.operation === "favorites.pin"
          ? Object.assign(favoriteItems.find((item) => item.id === message.payload.id), {pinned:true})
        : message.operation === "favorites.get"
          ? {...favoriteItems.find((item) => item.id === message.payload.id),sql:"SELECT 2"}
        : message.operation === "lint"
          ? {ok:false, message:"SQL 검사 테스트 오류", position:{line:0,column:7}, elapsed_ms:1}
          : queryResult(message.payload);
      setTimeout(() => send({id:message.id, result}), 0);
    }});
    setTimeout(() => {
      const token = [...document.querySelectorAll(".cm-line span")].find((span) => span.textContent === "SELECT");
      document.body.dataset.keywordColor = token ? getComputedStyle(token).color : "missing";
      document.body.dataset.baseColor = getComputedStyle(document.querySelector(".cm-content")).color;
      document.body.dataset.styleCount = document.querySelectorAll("style[nonce]").length;
      const editor = document.querySelector(".cm-editor");
      editor.querySelector(".cm-content").focus();
      document.body.style.setProperty("--vscode-editorCursor-foreground", "#ffcc00");
      document.body.dataset.cursorFocused = editor.classList.contains("cm-focused");
      const cursor = editor.querySelector(".cm-cursor");
      document.body.dataset.cursorColor = cursor ? getComputedStyle(cursor).borderLeftColor : "missing";
      document.body.dataset.cursorWidth = cursor ? getComputedStyle(cursor).borderLeftWidth : "missing";
      document.body.dataset.cursorDisplay = cursor ? getComputedStyle(cursor).display : "missing";
      const tableWrap = document.getElementById("table-wrap");
      document.body.dataset.tableHeight = tableWrap.clientHeight;
      document.body.dataset.tableScrollHeight = tableWrap.scrollHeight;
      document.body.dataset.renderedRows = tableWrap.querySelectorAll("tbody tr").length;
      document.body.dataset.nextPageInitiallyEnabled = !document.getElementById("next-page").disabled;
      document.body.dataset.initialRowLimit = document.getElementById("page-size").value;
      document.body.dataset.initialColumnLimit = document.getElementById("column-limit").value;
      document.body.dataset.initialRowSpan = document.getElementById("row-position").value;
      document.body.dataset.initialColumnSpan = document.getElementById("column-position").value;
      document.body.dataset.controlsBeforeTable = Boolean(document.getElementById("page-size").compareDocumentPosition(document.getElementById("table-wrap")) & Node.DOCUMENT_POSITION_FOLLOWING);
      const bucketCells = tableWrap.querySelectorAll("tbody tr td:nth-child(3)");
      document.body.dataset.coloredCells = tableWrap.querySelectorAll("tbody td.category-cell").length;
      document.body.dataset.uniqueIdColored = tableWrap.querySelector("tbody tr td:nth-child(2)").classList.contains("category-cell");
      document.body.dataset.listColored = tableWrap.querySelector("tbody tr td:nth-child(5)").classList.contains("category-cell");
      document.body.dataset.initialListCount = tableWrap.querySelector(".list-count")?.textContent;
      document.body.dataset.hueA = bucketCells[0]?.style.getPropertyValue("--pq-category-hue");
      document.body.dataset.hueB = bucketCells[1]?.style.getPropertyValue("--pq-category-hue");
      document.body.dataset.hueARepeat = bucketCells[2]?.style.getPropertyValue("--pq-category-hue");
      document.body.dataset.bucketBackground = bucketCells[0] ? getComputedStyle(bucketCells[0]).backgroundColor : "missing";
      document.body.dataset.headerAboveRun = document.querySelector(".sql-actions").getBoundingClientRect().bottom < document.getElementById("run").getBoundingClientRect().top;
    }, 500);
    setTimeout(() => {
      document.body.dataset.cursorFocusedLater = document.querySelector(".cm-editor").classList.contains("cm-focused");
      document.body.dataset.cursorDisplayLater = getComputedStyle(document.querySelector(".cm-cursor")).display;
    }, 550);
    setTimeout(() => document.getElementById("next-page").click(), 560);
    setTimeout(() => {
      const cells = document.querySelectorAll("tbody tr td:nth-child(3)");
      document.body.dataset.pageTwoHueFirst = cells[0]?.style.getPropertyValue("--pq-category-hue");
      document.body.dataset.pageTwoHueSecond = cells[1]?.style.getPropertyValue("--pq-category-hue");
    }, 590);
    setTimeout(() => document.getElementById("pick-favorite").click(), 600);
    setTimeout(() => document.querySelectorAll(".favorite-pin")[1]?.click(), 800);
    setTimeout(() => {
      document.body.dataset.pinnedFirst = document.querySelector(".favorite-item .favorite-content strong")?.textContent;
      document.body.dataset.pinnedPressed = document.querySelector(".favorite-item .favorite-pin")?.getAttribute("aria-pressed");
      document.querySelector(".favorite-item .favorite-content")?.click();
    }, 1000);
    setTimeout(() => {
      document.body.dataset.selectedSql = document.querySelector(".cm-content")?.textContent;
      document.body.dataset.favoritesClosed = document.getElementById("favorites-dialog").hidden;
    }, 1200);
    setTimeout(() => {
      document.body.dataset.requestsBeforeEdit = queryRequests.length;
      document.getElementById("column-limit").value = "10";
      document.getElementById("column-limit").dispatchEvent(new Event("change"));
      document.getElementById("page-size").value = "25";
      document.getElementById("page-size").dispatchEvent(new Event("change"));
    }, 1300);
    setTimeout(() => {
      document.body.dataset.requestsAfterEdit = queryRequests.length;
      document.getElementById("run").click();
    }, 1400);
    setTimeout(() => {
      document.body.dataset.columnLimitRequest = queryRequests.at(-1)?.column_limit;
      document.body.dataset.rowLimitRequest = queryRequests.at(-1)?.page_size;
      document.body.dataset.columnOffsetRequest = queryRequests.at(-1)?.column_offset;
      document.body.dataset.rowOffsetRequest = queryRequests.at(-1)?.row_offset;
      document.body.dataset.renderedAfterRun = document.querySelectorAll("tbody tr").length;
      document.body.dataset.rowSpanAfterRun = document.getElementById("row-position").value;
      document.body.dataset.columnSpanAfterRun = document.getElementById("column-position").value;
      document.getElementById("next-columns").click();
    }, 1500);
    setTimeout(() => {
      document.body.dataset.nextColumnOffset = queryRequests.at(-1)?.column_offset;
      document.body.dataset.nextColumnSpan = document.getElementById("column-position").value;
      document.getElementById("next-page").click();
    }, 1650);
    setTimeout(() => {
      document.body.dataset.nextRowOffset = queryRequests.at(-1)?.row_offset;
      document.body.dataset.nextRowSpan = document.getElementById("row-position").value;
      document.getElementById("previous-page").click();
    }, 1800);
    setTimeout(() => {
      document.body.dataset.previousRowOffset = queryRequests.at(-1)?.row_offset;
      document.body.dataset.previousRowLimit = queryRequests.at(-1)?.page_size;
      document.body.dataset.previousRowSpan = document.getElementById("row-position").value;
    }, 1950);
    setTimeout(() => {
      document.querySelector(".column-pin").click();
    }, 2050);
    setTimeout(() => {
      document.body.dataset.pinnedIndices = JSON.stringify(queryRequests.at(-1)?.pinned_column_indices);
      document.body.dataset.pinnedColumnCount = document.querySelectorAll("thead th.pinned-column").length;
      document.body.dataset.visibleColumnCount = document.querySelectorAll("thead th").length - 1;
      document.body.dataset.selectedColumnLimit = document.getElementById("column-limit").value;
      document.body.dataset.movingColumnLimit = queryRequests.at(-1)?.column_limit - queryRequests.at(-1)?.pinned_column_indices.length;
      document.getElementById("next-columns").click();
    }, 2200);
    setTimeout(() => {
      document.body.dataset.pinnedNextOffset = queryRequests.at(-1)?.column_offset;
      document.body.dataset.pinnedNextIndices = JSON.stringify(queryRequests.at(-1)?.pinned_column_indices);
      document.body.dataset.pinnedNextHeader = document.querySelector("thead th:nth-child(2)")?.textContent;
      document.body.dataset.pinnedNextPressed = document.querySelector("thead th:nth-child(2) .column-pin")?.getAttribute("aria-pressed");
      document.querySelector("thead th:nth-child(2) .column-pin")?.click();
    }, 2350);
    setTimeout(() => {
      document.body.dataset.unpinnedIndices = JSON.stringify(queryRequests.at(-1)?.pinned_column_indices);
      document.body.dataset.unpinnedColumnLimit = document.getElementById("column-limit").value;
    }, 2500);
  </script>`;
  const html = fs.readFileSync(path.join(media, "explorer.html"), "utf8")
    .replaceAll("__CSP_SOURCE__", "file:")
    .replaceAll("__NONCE__", nonce)
    .replaceAll("__SCRIPT_URI__", pathToFileURL(path.join(media, "explorer.js")).href)
    .replaceAll("__SQL_EDITOR_URI__", pathToFileURL(path.join(media, "sql-editor.js")).href)
    .replaceAll("__STYLE_URI__", pathToFileURL(path.join(media, "explorer.css")).href)
    .replace("<script nonce=", `${mock}\n  <script nonce=`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pq-webview-"));
  try {
    const page = path.join(temp, "index.html");
    fs.writeFileSync(page, html);
    const run = spawnSync("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1200,900",
      "--disable-background-networking", "--virtual-time-budget=2700", "--dump-dom", pathToFileURL(page).href],
    { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr.slice(-1000));
    assert.doesNotMatch(run.stdout, /id="source-total"|id="query-total"|DuckDB · 읽기 전용/);
    assert.match(run.stdout, /2 file\(s\) · 1\.00 MiB · 칼럼 45 · 행 75/);
    assert.doesNotMatch(run.stdout, /id="row-total"|id="column-total"/);
    assert.match(run.stdout, /data-initial-list-count="3개"/);
    assert.match(run.stdout, /class="cm-editor/);
    assert.match(run.stdout, /data-next-page-initially-enabled="true"/);
    assert.match(run.stdout, /data-initial-row-limit="50"/);
    assert.match(run.stdout, /data-initial-column-limit="20"/);
    assert.match(run.stdout, /data-initial-row-span="1-50"/);
    assert.match(run.stdout, /data-initial-column-span="1-20"/);
    assert.match(run.stdout, /data-controls-before-table="true"/);
    const keyword = run.stdout.match(/data-keyword-color="([^"]+)"/);
    const base = run.stdout.match(/data-base-color="([^"]+)"/);
    assert.ok(keyword && base, "SQL syntax color markers are missing");
    assert.notEqual(keyword[1], "missing");
    assert.notEqual(keyword[1], base[1], "SQL keyword did not receive its highlight color");
    assert.match(run.stdout, /data-style-count="[1-9]/);
    assert.match(run.stdout, /data-cursor-color="rgb\(255, 204, 0\)"/);
    assert.match(run.stdout, /data-cursor-width="2px"/);
    assert.equal(run.stdout.match(/data-cursor-display-later="([^"]+)"/)?.[1], "block");
    assert.match(run.stdout, /cm-lintRange-error/);
    assert.match(run.stdout, /<select id="page-size"/);
    assert.match(run.stdout, /<select id="column-limit"/);
    assert.match(run.stdout, /data-rendered-rows="50"/);
    assert.match(run.stdout, /data-colored-cells="150"/);
    assert.match(run.stdout, /data-unique-id-colored="false"/);
    assert.match(run.stdout, /data-list-colored="true"/);
    const hueA = Number(run.stdout.match(/data-hue-a="(\d+)"/)?.[1]);
    const hueB = Number(run.stdout.match(/data-hue-b="(\d+)"/)?.[1]);
    const hueARepeat = Number(run.stdout.match(/data-hue-a-repeat="(\d+)"/)?.[1]);
    assert.equal((hueB - hueA + 360) % 360, 180);
    assert.equal(hueARepeat, hueA);
    assert.equal(Number(run.stdout.match(/data-page-two-hue-first="(\d+)"/)?.[1]), hueB);
    assert.equal(Number(run.stdout.match(/data-page-two-hue-second="(\d+)"/)?.[1]), hueA);
    const background = run.stdout.match(/data-bucket-background="([^"]+)"/)?.[1];
    assert.ok(background && background !== "rgba(0, 0, 0, 0)", `category background is missing: ${background}`);
    const height = Number(run.stdout.match(/data-table-height="(\d+)"/)?.[1]);
    const scrollHeight = Number(run.stdout.match(/data-table-scroll-height="(\d+)"/)?.[1]);
    assert.ok(height > 380 && height <= 510 && scrollHeight > height, `expected a scrollable 14-row view, got ${height}/${scrollHeight}`);
    assert.match(run.stdout, /data-header-above-run="true"/);
    assert.match(run.stdout, /data-pinned-first="B"/);
    assert.match(run.stdout, /data-pinned-pressed="true"/);
    assert.match(run.stdout, /data-selected-sql="SELECT 2"/);
    assert.match(run.stdout, /data-favorites-closed="true"/);
    assert.ok(Number(run.stdout.match(/data-requests-after-edit="(\d+)"/)?.[1]) > Number(run.stdout.match(/data-requests-before-edit="(\d+)"/)?.[1]));
    assert.match(run.stdout, /data-column-limit-request="10"/);
    assert.match(run.stdout, /data-row-limit-request="25"/);
    assert.match(run.stdout, /data-column-offset-request="0"/);
    assert.match(run.stdout, /data-row-offset-request="0"/);
    assert.match(run.stdout, /data-rendered-after-run="25"/);
    assert.match(run.stdout, /data-row-span-after-run="1-25"/);
    assert.match(run.stdout, /data-column-span-after-run="1-10"/);
    assert.match(run.stdout, /data-next-column-offset="10"/);
    assert.match(run.stdout, /data-next-column-span="11-20"/);
    assert.match(run.stdout, /data-next-row-offset="25"/);
    assert.match(run.stdout, /data-next-row-span="26-50"/);
    assert.match(run.stdout, /data-previous-row-offset="0"/);
    assert.match(run.stdout, /data-previous-row-limit="25"/);
    assert.match(run.stdout, /data-previous-row-span="1-25"/);
    assert.match(run.stdout, /data-pinned-indices="\[10\]"/);
    assert.match(run.stdout, /data-pinned-column-count="1"/);
    assert.match(run.stdout, /data-visible-column-count="10"/);
    assert.match(run.stdout, /data-selected-column-limit="10"/);
    assert.match(run.stdout, /data-moving-column-limit="9"/);
    assert.match(run.stdout, /data-pinned-next-offset="9"/);
    assert.match(run.stdout, /data-pinned-next-indices="\[10\]"/);
    assert.match(run.stdout, /data-pinned-next-header="★c11INTEGER"/);
    assert.match(run.stdout, /data-pinned-next-pressed="true"/);
    assert.match(run.stdout, /data-unpinned-indices="\[\]"/);
    assert.match(run.stdout, /data-unpinned-column-limit="10"/);
    assert.match(run.stdout, /id="previous-columns"[^>]*>←<\/button>/);
    assert.match(run.stdout, /id="next-page"[^>]*>↓<\/button>/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
