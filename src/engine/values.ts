import type { CellValue } from "../shared/protocol";
interface Encoded { value: CellValue; bytes: number; json: string }
import * as duckdb from "@duckdb/node-api";

// Return each child's encoded length once; never re-encode a growing prefix.
function encode(value: unknown, budget: number, depth = 0): Encoded {
  if (depth > 64) return scalar("[중첩 깊이 제한]");
  if (typeof value === "bigint") {
    const number = Number(value);
    return scalar(Number.isSafeInteger(number) ? number : String(value));
  }
  if (value == null || typeof value !== "object") return scalar((value ?? null) as CellValue);
  if (value instanceof duckdb.DuckDBBlobValue || value instanceof Uint8Array) {
    const bytes = value instanceof duckdb.DuckDBBlobValue ? value.bytes : value;
    if (bytes.length * 2 <= budget) return scalar(Buffer.from(bytes).toString("hex"));
    return scalar({ __pq_truncated__: true, type: "bytes", original_bytes: bytes.length,
      preview: Buffer.from(bytes.subarray(0, Math.floor(budget / 2))).toString("hex") });
  }
  if (value instanceof duckdb.DuckDBListValue || value instanceof duckdb.DuckDBArrayValue) value = value.items;
  else if (value instanceof duckdb.DuckDBStructValue) value = value.entries;
  else if (value instanceof duckdb.DuckDBMapValue) value = value.entries;
  else if (value instanceof duckdb.DuckDBUnionValue) value = { [value.tag]: value.value };
  else if (value instanceof Date) return scalar(value.toISOString());
  else if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return scalar(String(value));

  const array = Array.isArray(value);
  const output: CellValue[] | Record<string, CellValue> = array ? [] : {};
  const parts: string[] = [];
  let bytes = 2;
  const collection = value as unknown[] | Record<string, unknown>;
  const entries = Array.isArray(collection) ? collection.entries() : Object.entries(collection);
  for (const [key, item] of entries) {
    const prefix = array ? "" : JSON.stringify(String(key)) + ":";
    const prefixBytes = Buffer.byteLength(prefix);
    const remaining = Math.max(0, budget - bytes - prefixBytes - (parts.length ? 1 : 0));
    const child = encode(item, remaining, depth + 1);
    const extra = prefixBytes + child.bytes + (parts.length ? 1 : 0);
    if (bytes + extra > budget) {
      return scalar({ __pq_truncated__: true, type: array ? "list" : "struct",
        item_count: Array.isArray(collection) ? collection.length : Object.keys(collection).length,
        preview_bytes: bytes, preview: (array ? "[" : "{") + parts.join(",") + (array ? "]" : "}") });
    }
    if (Array.isArray(output)) output.push(child.value);
    else Object.defineProperty(output, key, { value: child.value, enumerable: true, configurable: true });
    parts.push(prefix + child.json);
    bytes += extra;
  }
  return { value: output, bytes, json: (array ? "[" : "{") + parts.join(",") + (array ? "]" : "}") };
}

function scalar(value: CellValue): Encoded {
  if (typeof value === "number" && !Number.isFinite(value)) value = String(value);
  const json = JSON.stringify(value);
  return { value, json, bytes: Buffer.byteLength(json) };
}

function safeValue(value: unknown, budget = 65536): CellValue { return encode(value, budget).value; }

export { safeValue };
