"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { pythonCommand, startBridge } = require("../bridge");

test("Python selection honors the configured interpreter", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smoking-vscode-"));
  try {
    assert.equal(pythonCommand(root, "python3"), "python3");
    assert.equal(pythonCommand(root, "tools/python"), path.join(root, "tools", "python"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bundled worker reads Parquet and enforces SQL and source boundaries", async (context) => {
  const python = process.env.SMOKING_TEST_PYTHON || pythonCommand(path.resolve(__dirname, "../.."));
  const probe = spawnSync(python, ["-c", "import duckdb"], { encoding: "utf8" });
  if (probe.status !== 0) { context.skip("Python with duckdb is unavailable"); return; }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smoking-vscode-parquet-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "smoking-vscode-outside-"));
  let bridge;
  try {
    const source = path.join(root, "sample.parquet");
    const second = path.join(root, "second.parquet");
    const escaped = path.join(outside, "outside.parquet");
    const writeParquet = "import duckdb,sys; duckdb.sql('SELECT 1 AS id UNION ALL SELECT 2').write_parquet(sys.argv[1])";
    assert.equal(spawnSync(python, ["-c", writeParquet, source]).status, 0);
    assert.equal(spawnSync(python, ["-c", "import duckdb,sys; duckdb.sql('SELECT 3 AS id').write_parquet(sys.argv[1])", second]).status, 0);
    assert.equal(spawnSync(python, ["-c", writeParquet, escaped]).status, 0);

    bridge = await startBridge({ python, source, root, extensionPath: path.resolve(__dirname, "..") });
    const metadata = await bridge.request("meta");
    assert.equal(metadata.row_count, null);
    assert.equal(metadata.source_kind, "file");
    assert.equal(metadata.file_bytes, fs.statSync(source).size);
    const result = await bridge.request("query", {
      sql: "SELECT * FROM data", page: 0, page_size: 1, column_offset: 0, column_limit: 20,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.total_rows, null);
    assert.equal((await bridge.request("query", { sql: "SELECT * FROM data", include_total_rows: true })).total_rows, 2);
    const describe = await bridge.request("query", { sql: "DESCRIBE SELECT * FROM data", page_size: 1, include_total_rows: true });
    assert.equal(describe.total_rows, 1);
    assert.equal(describe.rows[0][0], "id");
    assert.equal(describe.rows[0][1], "INTEGER");
    assert.equal(describe.columns[0].name, "column_name");
    const describedPage = await bridge.request("query", {
      sql: "DESCRIBE SELECT id, id + 1 AS next_id FROM data", page: 1, page_size: 1,
      column_offset: 1, column_limit: 1, include_total_rows: true,
    });
    assert.equal(describedPage.total_rows, 2);
    assert.equal(describedPage.row_offset, 1);
    assert.deepEqual(describedPage.columns, [{ name: "column_type", type: "VARCHAR", index: 1 }]);
    assert.deepEqual(describedPage.rows, [["INTEGER"]]);
    const pinnedPage = await bridge.request("query", {
      sql: "DESCRIBE SELECT id, id + 1 AS next_id FROM data",
      column_limit: 2, column_offset: 1, pinned_column_indices: [0],
    });
    assert.deepEqual(pinnedPage.columns.map((column) => column.index), [0, 2]);
    assert.deepEqual(pinnedPage.rows[0], ["id", "YES"]);
    assert.equal(pinnedPage.next_column_offset, 2);
    assert.equal(pinnedPage.previous_column_offset, 0);
    const pinnedPrevious = await bridge.request("query", {
      sql: "DESCRIBE SELECT id, id + 1 AS next_id FROM data",
      column_limit: 2, column_offset: pinnedPage.previous_column_offset, pinned_column_indices: [0, 0, 999],
    });
    assert.deepEqual(pinnedPrevious.columns.map((column) => column.index), [0, 1]);
    assert.equal(pinnedPrevious.next_column_offset, 1);
    assert.equal(pinnedPrevious.has_previous_columns, false);
    assert.equal((await bridge.request("lint", { sql: "DESCRIBE SELECT * FROM data" })).ok, true);
    const blockedDescribe = await bridge.request("lint", { sql: "DESCRIBE SELECT * FROM read_parquet('outside.parquet')" });
    assert.equal(blockedDescribe.ok, false);
    assert.match(blockedDescribe.message, /외부 file/);
    await assert.rejects(bridge.request("query", { sql: "DELETE FROM data" }), /읽기 전용|SELECT/);
    const blockedLint = await bridge.request("lint", { sql: "SELECT * FROM read_parquet('outside.parquet')" });
    assert.equal(blockedLint.ok, false);
    assert.match(blockedLint.message, /외부 file/);
    await assert.rejects(
      bridge.request("query", { sql: `SELECT * FROM '${escaped.replaceAll("'", "''")}'` }),
      /disabled|external|access|Permission|not allowed/i,
    );
    await assert.rejects(bridge.request("source", { path: escaped }), /root 밖/);
    assert.equal((await bridge.request("meta")).row_count, null);
    await assert.rejects(
      bridge.request("query", { sql: `SELECT * FROM '${second.replaceAll("'", "''")}'` }),
      /disabled|external|access|Permission|not allowed/i,
    );
    assert.equal((await bridge.request("source", { path: second })).row_count, null);
    assert.deepEqual((await bridge.request("query", { sql: "SELECT * FROM data" })).rows, [[3]]);
    await assert.rejects(
      bridge.request("query", { sql: `SELECT * FROM '${source.replaceAll("'", "''")}'` }),
      /disabled|external|access|Permission|not allowed/i,
    );
    await assert.rejects(bridge.request("arbitrary", {}), /지원하지 않는 요청/);
  } finally {
    bridge?.stop();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("partition dataset counts every row, pages through all files, and preserves list values", async (context) => {
  const python = process.env.SMOKING_TEST_PYTHON || pythonCommand(path.resolve(__dirname, "../.."));
  if (spawnSync(python, ["-c", "import duckdb"], { encoding: "utf8" }).status !== 0) {
    context.skip("Python with duckdb is unavailable"); return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-explorer-pages-"));
  let bridge;
  try {
    const part = path.join(root, "part-00000000-00000.parquet");
    const second = path.join(root, "part-00000001-00000.parquet");
    const create = "import duckdb,sys; duckdb.sql('SELECT i AS id, [i, i+1] AS items FROM range(' + sys.argv[2] + ',' + sys.argv[3] + ') t(i)').write_parquet(sys.argv[1])";
    assert.equal(spawnSync(python, ["-c", create, part, "0", "21"]).status, 0);
    assert.equal(spawnSync(python, ["-c", create, second, "21", "75"]).status, 0);

    bridge = await startBridge({ python, source: part, root, extensionPath: path.resolve(__dirname, "..") });
    const singleFile = await bridge.request("meta");
    assert.equal(singleFile.row_count, null);
    assert.equal(singleFile.file_count, 1);
    assert.equal(singleFile.file_bytes, fs.statSync(part).size);
    assert.equal((await bridge.request("query", { sql: "SELECT * FROM data", page_size: 50 })).has_more, false);

    const metadata = await bridge.request("source", { path: root });
    assert.equal(metadata.source_kind, "dataset");
    assert.equal(metadata.file_count, 2);
    assert.equal(metadata.row_count, null);
    assert.equal(metadata.file_bytes, fs.statSync(part).size + fs.statSync(second).size);
    const first = await bridge.request("query", { sql: "SELECT * FROM data ORDER BY id", page: 0, page_size: 50 });
    assert.equal(first.total_rows, null);
    assert.equal((await bridge.request("query", { sql: "SELECT * FROM data", include_total_rows: true })).total_rows, 75);
    assert.equal(first.rows.length, 50);
    assert.equal(first.has_more, true);
    assert.deepEqual(first.rows[0], [0, [0, 1]]);
    const secondPage = await bridge.request("query", { sql: "SELECT * FROM data ORDER BY id", page: 1, page_size: 50 });
    assert.equal(secondPage.total_rows, null);
    assert.equal(secondPage.rows.length, 25);
    assert.equal(secondPage.has_more, false);
    assert.deepEqual(secondPage.rows[0], [50, [50, 51]]);
    const jumped = await bridge.request("query", { sql: "SELECT * FROM data ORDER BY id", row_offset: 30, page_size: 20 });
    assert.equal(jumped.row_offset, 30);
    assert.equal(jumped.rows.length, 20);
    assert.deepEqual(jumped.rows[0], [30, [30, 31]]);
    const filtered = await bridge.request("query", { sql: "SELECT * FROM data WHERE id >= 70", include_total_rows: true });
    assert.equal(filtered.total_rows, 5);
    assert.equal((await bridge.request("meta")).row_count, null);
    const lint = await bridge.request("lint", { sql: "SELECT missing_column FROM data" });
    assert.equal(lint.ok, false);
    assert.deepEqual(lint.position, { line: 0, column: 7 });
  } finally {
    bridge?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
