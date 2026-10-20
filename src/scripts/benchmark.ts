import { version as duckdbVersion } from "@duckdb/node-api";
import { errorMessage } from "../shared/errors";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { startBridge } from "../bridge";

async function main() {
  const input = process.argv[2];
  if (!input || input === "--help") {
    console.log("Usage: npm run benchmark -- FILE.parquet\nRuns SELECT * FROM data, 50 rows / 20 columns, three times. Does not measure Webview rendering.");
    if (!input) process.exitCode = 1;
    return;
  }
  if (process.argv.length !== 3) throw new Error("파일 경로 하나를 지정하세요. --help로 사용법을 확인하세요.");
  const source = fs.realpathSync(input);
  const started = performance.now();
  const bridge = await startBridge({ source, root: path.dirname(source), extensionPath: path.resolve(__dirname, ".."), settings: { threads: 2, memoryLimit: "2GB" } });
  try {
    const startup = performance.now() - started;
    const metadata = await bridge.request("meta");
    const runs: { run: number; engine_ms: number; bridge_ms: number; rows: number; columns: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const result = await bridge.request("query", { sql: "SELECT * FROM data", page_size: 50, column_limit: 20 });
      runs.push({ run: i + 1, engine_ms: result.elapsed_ms, bridge_ms: performance.now() - start,
        rows: result.rows.length, columns: result.columns.length });
    }
    const median = (key: "engine_ms" | "bridge_ms") => [...runs].map(run => run[key]).sort((a, b) => a - b)[1];
    console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`,
      duckdb: duckdbVersion(), file: path.basename(source), bytes: metadata.file_bytes,
      startup_ms: startup, median_engine_ms: median("engine_ms"), median_bridge_ms: median("bridge_ms"), runs }, null, 2));
  } finally { await bridge.stop(); }
}
main().catch(error => { console.error(errorMessage(error)); process.exitCode = 1; });
