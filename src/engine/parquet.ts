import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
import type { EngineSettings, DataFormat, Column, SourceMetadata, SourceStatistics, QueryPayload, QueryResult, LintResult, CancelResult } from "../shared/protocol";
interface Discovered { source: string; kind: "file" | "dataset"; format: DataFormat; files: string[] }
import { errorMessage, errorCode } from "../shared/errors";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { DuckDBInstance, StatementType, listValue } from "@duckdb/node-api";
import { safeValue } from "./values";
import { withoutComments, errorPosition } from "./sql";
import { formatOf, importSbdf, importXlsx } from "./formats";

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const integer = (value: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}
function expand(value: string) { return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value; }
function size(value: string, label: string) {
  if (!/^[1-9][0-9]*(?:\.[0-9]+)?(?:KB|MB|GB|TB)$/i.test(value)) throw new Error(`${label} 설정은 2GB와 같은 양의 크기여야 합니다.`);
  return value.toUpperCase();
}

async function discover(source: string, root: string): Promise<Discovered> {
  const requested = path.resolve(root, expand(String(source)));
  const resolved = await fs.realpath(requested).catch(() => { throw new Error(`데이터 파일을 찾을 수 없습니다: ${requested}`); });
  if (!within(root, resolved)) throw new Error(`허용된 source root 밖의 경로입니다: ${resolved}`);
  const stat = await fs.stat(resolved);
  if (stat.isFile()) {
    const format = formatOf(resolved);
    if (!format) throw new Error("Parquet·CSV·TSV·SBDF·XLSX 파일 또는 Parquet dataset 폴더를 선택하세요.");
    return { source: resolved, kind: "file", format, files: [resolved] };
  }
  const files: string[] = [];
  const visited = new Set();
  async function walk(candidate: string) {
    const real = await fs.realpath(candidate);
    if (!within(root, real)) throw new Error("dataset에 허용된 source root 밖의 Parquet link가 있습니다.");
    const info = await fs.stat(real);
    if (info.isDirectory()) {
      // Do not recurse through directory symlinks, matching Path.rglob behavior.
      if (visited.has(real)) return;
      visited.add(real);
      for (const child of await fs.readdir(real, { withFileTypes: true })) {
        const childPath = path.join(real, child.name);
        if (child.isDirectory() || formatOf(child.name) === "parquet") await walk(childPath);
      }
    } else if (info.isFile() && formatOf(real) === "parquet") files.push(real);
  }
  await walk(resolved);
  if (!files.length) throw new Error(`Parquet 파일을 찾을 수 없습니다: ${resolved}`);
  files.sort();
  return { source: resolved, kind: "dataset", format: "parquet", files: [...new Set(files)] };
}

class ParquetEngine {
  declare root: string;
  declare source: string;
  declare kind: 'file' | 'dataset';
  declare format: DataFormat;
  declare files: string[];
  declare settings: EngineSettings;
  declare maxCellBytes: number;
  declare counts: Map<string, number>;
  declare config: Record<string, string>;
  declare fileBytes: number;
  declare columns: Column[];
  declare rowCount?: number;
  declare sheets?: string[];
  declare selectedSheet?: string;
  declare db?: DuckDBInstance;
  declare connection?: DuckDBConnection;
  declare statisticsConnection?: DuckDBConnection;
  declare statisticsStopping?: boolean;
  declare active?: { id: string; cancelled: boolean; timedOut: boolean };

  static async open(source: string, root: string, settings: EngineSettings = {}) {
    const engine = new ParquetEngine();
    try { await engine.initialize(source, root, settings); return engine; }
    catch (error) { engine.close(); throw error; }
  }

  async initialize(source: string, root: string, settings: EngineSettings) {
    this.root = await fs.realpath(root);
    Object.assign(this, await discover(source, this.root));
    this.settings = settings;
    this.maxCellBytes = integer(settings.maxCellBytes, 65536, 1024, 1048576);
    this.counts = new Map();
    this.config = {
      threads: String(integer(settings.threads, 2, 1, 64)),
      memory_limit: size(settings.memoryLimit || "2GB", "memory_limit"),
      max_temp_directory_size: size(settings.maxTempSize || "10GB", "max_temp_directory_size"),
    };
    if (String(settings.tempDirectory || "").trim()) {
      const temp = path.resolve(this.root, expand(settings.tempDirectory!));
      if (!within(this.root, temp)) throw new Error("임시 폴더는 workspace root 안에 있어야 합니다.");
      // Resolve the nearest existing ancestor before mkdir, including symlink parents.
      let ancestor = temp;
      while (true) {
        try {
          if (!within(this.root, await fs.realpath(ancestor))) throw new Error("임시 폴더는 workspace root 안에 있어야 합니다.");
          break;
        } catch (error) { if (errorCode(error) !== "ENOENT") throw error; ancestor = path.dirname(ancestor); }
      }
      await fs.mkdir(temp, { recursive: true });
      this.config.temp_directory = await fs.realpath(temp);
    }
    this.fileBytes = (await Promise.all(this.files.map(file => fs.stat(file)))).reduce((sum, info) => sum + info.size, 0);
    this.db = await DuckDBInstance.create(":memory:", this.config);
    this.connection = await this.db.connect();
    await this.register(this.connection!);
    this.columns = (await this.connection!.runAndReadAll("DESCRIBE data")).getRows().map(row => ({ name: String(row[0]), type: String(row[1]) }));
    await this.restrict(this.connection!);
  }

  async register(connection: DuckDBConnection) {
    if (this.format === "sbdf" || this.format === "xlsx") {
      const result = this.format === "sbdf" ? await importSbdf(connection, this.source) : await importXlsx(connection, this.source, this.settings.sheet);
      Object.assign(this, result);
      return;
    }
    const files = "[" + this.files.map(quote).join(",") + "]";
    const reader = this.format === "parquet" ? `read_parquet(${files}, union_by_name=true, hive_partitioning=false)`
      : `read_csv(${files}, auto_detect=true, ${this.format === "tsv" ? "delim='\\t', " : ""}hive_partitioning=false)`;
    await connection.run(`CREATE VIEW data AS SELECT * FROM ${reader}`);
  }
  async restrict(connection: DuckDBConnection) {
    await connection.run("SET allowed_paths = ?", [listValue(this.files)]);
    await connection.run("SET enable_external_access = false");
    await connection.run("SET lock_configuration = true");
  }
  close() { this.connection?.closeSync(); this.connection = undefined; this.db?.closeSync(); this.db = undefined; }
  metadata(): SourceMetadata {
    return { source_path: this.source, source_kind: this.kind, file_count: this.files.length,
      file_bytes: this.fileBytes, row_count: this.rowCount ?? null, column_count: this.columns.length,
      format: this.format, sheets: this.sheets ?? [], selected_sheet: this.selectedSheet ?? null,
      columns: this.columns, allowed_root: this.root, view_name: "data", default_query: "SELECT * FROM data" };
  }
  async sourceStatistics(): Promise<SourceStatistics> {
    const started = performance.now();
    if (this.rowCount != null) return { source_path: this.source, column_count: this.columns.length, row_count: this.rowCount, method: "import", elapsed_ms: 0 };
    const db = await DuckDBInstance.create(":memory:", { ...this.config, threads: "1" });
    let connection: DuckDBConnection | undefined, timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
    try {
      connection = await db.connect();
      this.statisticsConnection = connection;
      if (this.statisticsStopping) throw new Error("DuckDB 통계 작업자가 중지되었습니다.");
      await this.restrict(connection);
      if (this.statisticsStopping) throw new Error("DuckDB 통계 작업자가 중지되었습니다.");
      timer = setTimeout(() => { timedOut = true; connection!.interrupt(); }, 120000);
      let rows: DuckDBValue[][], method = "parquet_footer";
      try { if (this.format !== "parquet") throw new Error("푸터 통계가 없는 형식입니다."); rows = await this.footerRows(connection); }
      catch (error) {
        if (timedOut || this.statisticsStopping) throw error;
        method = "query";
        await this.register(connection);
        rows = (await connection.runAndReadAll("SELECT count(*) FROM data")).getRows();
      }
      if (timedOut) throw new Error("소스 행 수 확인 시간이 초과되었습니다.");
      return { source_path: this.source, column_count: this.columns.length, row_count: Number(rows[0][0]),
        method, elapsed_ms: Math.round((performance.now() - started) * 100) / 100 };
    } catch (error) { if (timedOut) throw new Error("소스 행 수 확인 시간이 초과되었습니다."); throw error; }
    finally { clearTimeout(timer); this.statisticsConnection = undefined; connection?.closeSync(); db.closeSync(); }
  }

  interruptStatistics() { this.statisticsStopping = true; this.statisticsConnection?.interrupt(); }

  async footerRows(connection: DuckDBConnection) {
    return (await connection.runAndReadAll("SELECT sum(num_rows) FROM parquet_file_metadata(?)", [listValue(this.files)])).getRows();
  }

  async validatedSql(sql: string | undefined) {
    const text = String(sql || "").trim();
    if (!text) throw new Error("SQL이 비어 있습니다.");
    if (text.length > 100000) throw new Error("SQL은 100,000자를 넘을 수 없습니다.");
    const normalized = withoutComments(text).trim().replace(/;\s*$/, "").trim();
    if (!/^(?:select|with|from|values|describe\s+select)\b/i.test(normalized)) throw new Error("SELECT 계열의 읽기 전용 SQL만 실행할 수 있습니다.");
    if (/\b(?:read_(?:csv|json|parquet|text|blob|xlsx)|(?:parquet|csv|json|sqlite|postgres|mysql)_scan|glob|attach)\b/i.test(normalized)) {
      throw new Error("Explorer SQL에서는 외부 file/database를 여는 함수를 사용할 수 없습니다.");
    }
    const statements = await this.connection!.extractStatements(text);
    if (statements.count !== 1) throw new Error("읽기 전용 SQL 한 문장만 실행할 수 있습니다.");
    const statement = await statements.prepare(0);
    try { if (statement.statementType !== StatementType.SELECT) throw new Error("SELECT 계열의 읽기 전용 SQL만 실행할 수 있습니다."); }
    finally { statement.destroySync(); }
    return normalized;
  }

  async lint(sql: string | undefined): Promise<LintResult> {
    const started = performance.now();
    try {
      const normalized = await this.validatedSql(sql);
      await this.connection!.runAndReadAll(`EXPLAIN ${normalized}`);
      return { ok: true, message: "DuckDB parser/binder: 오류 없음", elapsed_ms: performance.now() - started };
    } catch (error) { return { ok: false, message: errorMessage(error), position: errorPosition(errorMessage(error)), elapsed_ms: performance.now() - started }; }
  }

  cancel(requestId?: string): CancelResult {
    const active = this.active;
    if (!active || (requestId != null && requestId !== active.id)) return { cancelled: false, request_id: requestId, active_request_id: active?.id ?? null };
    active.cancelled = true;
    this.connection!.interrupt();
    return { cancelled: true, request_id: active.id, active_request_id: active.id };
  }

  async query(payload: QueryPayload = {}): Promise<QueryResult> {
    const started = performance.now();
    const pageSize = integer(payload.page_size, 50, 1, 200);
    const offset = payload.row_offset == null ? integer(payload.page, 0, 0, Number.MAX_SAFE_INTEGER) * pageSize : integer(payload.row_offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const columnLimit = integer(payload.column_limit, 40, 1, 100);
    const timeout = integer(payload.timeout_seconds, 30, 0, 86400);
    const active = { id: payload.request_id || randomUUID(), cancelled: false, timedOut: false };
    this.active = active;
    const timer = timeout ? setTimeout(() => { active.timedOut = true; this.cancel(active.id); }, timeout * 1000) : undefined;
    const check = () => {
      if (active.timedOut || (timeout && performance.now() - started >= timeout * 1000)) throw new Error("DuckDB query가 실행 시간 한도를 초과했습니다.");
      if (active.cancelled) throw new Error("DuckDB query가 취소되었습니다.");
    };
    try {
      const sql = await this.validatedSql(payload.sql);
      check();
      const described = (await this.connection!.runAndReadAll(`DESCRIBE SELECT * FROM (${sql}\n) AS __pq_query`)).getRows();
      check();
      const all = described.map(row => ({ name: String(row[0]), type: String(row[1]) }));
      const pinned = [...new Set((Array.isArray(payload.pinned_column_indices) ? payload.pinned_column_indices : []).filter(index => Number.isInteger(index) && index >= 0 && index < all.length))].slice(0, columnLimit - 1);
      const available = all.map((_, index) => index).filter(index => !pinned.includes(index));
      const columnOffset = integer(payload.column_offset, 0, 0, Math.max(0, available.length - 1));
      const windowLimit = columnLimit - pinned.length;
      const windowIndices = available.slice(columnOffset, columnOffset + windowLimit);
      const selected = [...pinned, ...windowIndices].map(index => ({ ...all[index], index }));
      let totalRows: number | null = null;
      if (payload.include_total_rows) {
        totalRows = this.counts.get(sql) ?? null;
        if (totalRows == null) {
          totalRows = Number((await this.connection!.runAndReadAll(`SELECT count(*) FROM (${sql}\n) AS __pq_count`)).getRows()[0][0]);
          check();
          if (this.counts.size >= 100) this.counts.delete(this.counts.keys().next().value!);
          this.counts.set(sql, totalRows);
        }
      }
      const projection = selected.map(column => identifier(column.name)).join(", ");
      const reader = await this.connection!.runAndReadAll(`SELECT ${projection} FROM (${sql}\n) AS __pq_query LIMIT ${pageSize + (totalRows == null ? 1 : 0)} OFFSET ${offset}`);
      check();
      const fetched = reader.getRows();
      const rows = fetched.slice(0, pageSize).map(row => row.map(value => safeValue(value, this.maxCellBytes)));
      check();
      return { ok: true, request_id: active.id, sql: payload.sql, page: Math.floor(offset / pageSize), page_size: pageSize,
        row_offset: offset, has_more: totalRows == null ? fetched.length > pageSize : offset + fetched.length < totalRows,
        total_rows: totalRows, rows, columns: selected, column_offset: columnOffset, column_limit: columnLimit,
        total_columns: all.length, has_previous_columns: columnOffset > 0,
        has_more_columns: columnOffset + windowIndices.length < available.length,
        previous_column_offset: Math.max(0, columnOffset - windowLimit), next_column_offset: columnOffset + windowIndices.length,
        elapsed_ms: Math.round((performance.now() - started) * 100) / 100, timeout_seconds: timeout };
    } catch (error) { check(); throw error; }
    finally { clearTimeout(timer); this.active = undefined; }
  }
}

export { ParquetEngine };
