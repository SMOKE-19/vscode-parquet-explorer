import type { DuckDBValue } from "@duckdb/node-api";
import type { Column } from "../shared/protocol";
export type ImportValue = DuckDBValue | Uint8Array;
export interface SbdfColumn extends Column { sbdfType: number }
export interface SbdfHeader { columns: SbdfColumn[] }
export interface SbdfBatch { batch: ImportValue[][]; rows: number }
// SBDF 1.0 wire format, checked against Spotfire's public C implementation
// and smoking-sbdf's plain/RLE/bit writer. No Python or native addon is used.
import * as fs from "node:fs";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { timestampMillisValue, dateValue, timeValue, intervalValue } from "@duckdb/node-api";
const TYPES: Record<number, string> = { 1: "BOOLEAN", 2: "INTEGER", 3: "BIGINT", 4: "FLOAT", 5: "DOUBLE", 6: "TIMESTAMP_MS", 7: "DATE", 8: "TIME", 9: "INTERVAL", 10: "VARCHAR", 12: "BLOB", 13: "VARCHAR" };
const WIDTHS: Record<number, number> = { 1: 1, 2: 4, 3: 8, 4: 4, 5: 8, 6: 8, 7: 8, 8: 8, 9: 8, 13: 16 };
const EPOCH = 62135596800000n;

class Reader {
  fd: number;
  size: number;
  position: number;
  buffer: Buffer;
  start: number;
  sliceLimit?: number;
  constructor(file: string) { this.fd = fs.openSync(file, "r"); this.size = fs.fstatSync(this.fd).size; this.position = 0; this.buffer = Buffer.alloc(0); this.start = 0; }
  fail(message: string): never { throw new Error(`SBDF: ${message} (offset ${this.position})`); }
  bytes(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || length > 64 * 1024 ** 2 || this.position + length > this.size || this.position + length > (this.sliceLimit ?? Infinity)) this.fail("잘못된 길이, 잘린 파일 또는 slice 크기 제한 초과입니다");
    if (this.position < this.start || this.position + length > this.start + this.buffer.length) {
      this.start = this.position;
      this.buffer = Buffer.allocUnsafe(Math.min(this.size - this.position, Math.max(65536, length)));
      let read = 0;
      while (read < this.buffer.length) { const n = fs.readSync(this.fd, this.buffer, read, this.buffer.length - read, this.position + read); if (!n) this.fail("잘린 파일입니다"); read += n; }
    }
    const value = this.buffer.subarray(this.position - this.start, this.position - this.start + length);
    this.position += length;
    return value;
  }
  byte() { return this.bytes(1)[0]; }
  int() { return this.bytes(4).readInt32LE(); }
  count(max = 1000000) { const n = this.int(); if (n < 0 || n > max) this.fail("항목 수 제한을 초과했습니다"); return n; }
  string() { return this.bytes(this.count(16 * 1024 ** 2)).toString("utf8"); }
  section(expected?: number) { if (this.byte() !== 0xdf || this.byte() !== 0x5b) this.fail("section magic이 다릅니다"); const id = this.byte(); if (expected != null && id !== expected) this.fail("section 순서가 다릅니다"); return id; }
  packed(): number { let n = 0; for (let i = 0; i < 5; i++) { const v = this.byte(); n += (v & 127) * 2 ** (i * 7); if (!(v & 128)) return n; } this.fail("잘못된 packed 길이입니다"); }
  scalar(type: number, packed = false): ImportValue {
    if (type === 10 || type === 12) { const b = this.bytes(packed ? this.packed() : this.count(64 * 1024 ** 2)); return type === 10 ? b.toString("utf8") : b; }
    const width = WIDTHS[type]; if (!width) this.fail(`지원하지 않는 타입 ${type}`);
    const b = this.bytes(width);
    if (type === 1) return b[0] !== 0;
    if (type === 2) return b.readInt32LE();
    if (type === 4) return b.readFloatLE();
    if (type === 5) return b.readDoubleLE();
    if (type === 13) return decimal(b);
    const n = b.readBigInt64LE();
    if (type === 6) return timestampMillisValue(n - EPOCH);
    if (type === 7) return dateValue(Number((n - EPOCH) / 86400000n));
    if (type === 8) return timeValue(((n % 86400000n) + 86400000n) % 86400000n * 1000n);
    if (type === 9) return intervalValue(0, 0, n * 1000n);
    return n;
  }
  array(type: number) {
    const count = this.count();
    const end = type === 10 || type === 12 ? this.position + 4 + this.count(64 * 1024 ** 2) : null;
    const values = Array.from({ length: count }, () => this.scalar(type, true));
    if (end != null && end !== this.position) this.fail("문자열 배열의 바이트 길이가 다릅니다");
    return values;
  }
  values() {
    const encoding = this.byte(), type = this.byte();
    if (!TYPES[type]) this.fail(`지원하지 않는 타입 ${type}`);
    if (encoding === 1) return { type, values: this.array(type) };
    const count = this.count();
    if (encoding === 3) {
      if (type !== 1) this.fail("bit 인코딩 타입이 Boolean이 아닙니다");
      const b = this.bytes(Math.ceil(count / 8));
      return { type, values: Array.from({ length: count }, (_, i) => Boolean(b[i >> 3] & (128 >> (i & 7)))) };
    }
    if (encoding !== 2) this.fail(`지원하지 않는 인코딩 ${encoding}`);
    const runs = this.bytes(this.count()), values = this.array(type), expanded: ImportValue[] = [];
    if (runs.length !== values.length) this.fail("RLE run 수가 다릅니다");
    for (let i = 0; i < runs.length; i++) {
      if (expanded.length + runs[i] + 1 > count) this.fail("RLE 행 수가 다릅니다");
      for (let j = 0; j <= runs[i]; j++) expanded.push(values[i]);
    }
    if (expanded.length !== count) this.fail("RLE 행 수가 다릅니다");
    return { type, values: expanded };
  }
}

function decimal(b: Buffer) {
  const n = b.readBigUInt64LE(0) | b.readBigUInt64LE(8) << 64n;
  const sign = n >> 127n ? "-" : "", special = Number(n >> 122n & 31n);
  if (special === 31) return "NaN";
  if (special === 30) return sign + "Infinity";
  const steering = (n >> 125n & 3n) === 3n;
  const exponent = Number(n >> (steering ? 111n : 113n) & 16383n) - 6176;
  let coefficient = steering ? 0n : n & ((1n << 113n) - 1n);
  if (coefficient >= 10n ** 34n) coefficient = 0n;
  const digits = String(coefficient), point = digits.length + exponent;
  if (exponent >= 0 && point <= 80) return sign + digits + "0".repeat(exponent);
  if (exponent < 0 && exponent >= -80) return sign + (point > 0 ? digits.slice(0, point) + "." + digits.slice(point) : "0." + "0".repeat(-point) + digits);
  return `${sign}${digits}e${exponent}`;
}

async function* readSbdf(file: string): AsyncGenerator<SbdfHeader | SbdfBatch, void, unknown> {
  const r = new Reader(file);
  try {
    r.section(1); if (r.byte() !== 1 || r.byte() !== 0) r.fail("SBDF 1.0 파일만 지원합니다");
    r.section(2);
    for (let i = r.count(10000); i; i--) { r.string(); const type = r.byte(); if (r.byte()) r.scalar(type); if (r.byte()) r.scalar(type); }
    const count = r.count(10000), definitions = [];
    if (!count) r.fail("칼럼이 없습니다");
    for (let i = r.count(10000); i; i--) { const name = r.string(), type = r.byte(); definitions.push({ name, type, fallback: r.byte() ? r.scalar(type) : undefined }); }
    const columns: SbdfColumn[] = [];
    for (let i = 0; i < count; i++) {
      const metadata = new Map<string, ImportValue | undefined>();
      for (const d of definitions) metadata.set(d.name, r.byte() ? r.scalar(d.type) : d.fallback);
      const name = metadata.get("Name"), type = metadata.get("DataType");
      if (typeof name !== "string" || !Buffer.isBuffer(type) || type.length !== 1 || !TYPES[type[0]]) return r.fail("칼럼 Name/DataType이 유효하지 않습니다");
      columns.push({ name, type: TYPES[type[0]], sbdfType: type[0] });
    }
    yield { columns };
    while (true) {
      const id = r.section();
      if (id === 5) {
        // Official fixtures may include a trailing line break after the table.
        if (r.size - r.position > 16 || [...r.bytes(r.size - r.position)].some(b => ![0, 9, 10, 13, 32].includes(b))) r.fail("table end 뒤에 데이터가 있습니다");
        break;
      }
      if (id !== 3 || r.count(10000) !== count) r.fail("table slice 칼럼 수가 다릅니다");
      const batch = [], start = r.position;
      r.sliceLimit = start + 128 * 1024 ** 2;
      let rows: number | undefined;
      for (let c = 0; c < count; c++) {
        r.section(4); const data = r.values();
        rows ??= data.values.length;
        if (data.type !== columns[c].sbdfType || data.values.length !== rows || rows * count > 2000000) r.fail("slice 타입·행 수 불일치 또는 slice 크기 제한 초과입니다");
        for (let p = r.count(10000); p; p--) {
          const name = r.string(), prop = r.values();
          if (prop.values.length !== rows) r.fail("property 행 수가 다릅니다");
          if (name === "IsInvalid") {
            if (prop.type !== 1) r.fail("IsInvalid 타입이 Boolean이 아닙니다");
            for (let i = 0; i < rows; i++) if (prop.values[i]) data.values[i] = null;
          }
        }
        batch.push(data.values);
        if (r.position - start > 128 * 1024 ** 2) r.fail("slice 바이트 제한을 초과했습니다");
      }
      yield { batch, rows: rows! };
      r.sliceLimit = undefined;
      await yieldEventLoop();
    }
  } finally { fs.closeSync(r.fd); }
}

export { readSbdf };
