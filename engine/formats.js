"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { setImmediate: yieldEventLoop } = require("node:timers/promises");
const { timestampMillisValue } = require("@duckdb/node-api");
const yauzl = require("yauzl");
const { readSbdf } = require("./sbdf");
const EXTENSIONS = ["parquet", "csv", "tsv", "sbdf", "xlsx"];
const formatOf = file => { const ext = path.extname(file).slice(1).toLowerCase(); return EXTENSIONS.includes(ext) ? ext : undefined; };
const identifier = value => '"' + value.replaceAll('"', '""') + '"';

function uniqueNames(names) {
  const used = new Set();
  return names.map((value, i) => {
    const base = String(value ?? "").trim() || `column_${i + 1}`;
    let name = base, suffix = 1;
    while (used.has(name.toLowerCase())) name = `${base}_${++suffix}`;
    used.add(name.toLowerCase());
    return name;
  });
}

async function appendRows(connection, columns, batches) {
  const names = uniqueNames(columns.map(c => c.name));
  await connection.run(`CREATE TABLE data (${columns.map((c, i) => `${identifier(names[i])} ${c.type}`).join(",")})`);
  const appender = await connection.createAppender("data");
  const types = columns.map((_, i) => appender.columnType(i));
  let count = 0;
  try {
    for await (const batch of batches) {
      for (const row of batch) {
        for (let i = 0; i < columns.length; i++) {
          if (row[i] == null) appender.appendNull();
          else if (columns[i].type === "BLOB") appender.appendBlob(row[i]);
          else appender.appendValue(row[i], types[i]);
        }
        appender.endRow(); count++;
        if (count % 8192 === 0) { appender.flushSync(); await yieldEventLoop(); }
      }
    }
  } finally { appender.closeSync(); }
  return count;
}

async function importSbdf(connection, file) {
  const iterator = readSbdf(file);
  try {
    const { value: header } = await iterator.next();
    async function* rows() {
      for await (const { batch, rows } of iterator) {
        // Transpose only a small batch; do not duplicate an entire table slice.
        for (let start = 0; start < rows; start += 2048) yield Array.from({ length: Math.min(2048, rows - start) }, (_, i) => batch.map(column => column[start + i]));
      }
    }
    return { rowCount: await appendRows(connection, header.columns, rows()) };
  } finally { await iterator.return(); }
}

// Check the archive before a general-purpose XLSX reader allocates row arrays.
async function validateWorkbook(buffer) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  let size = 0, entries = 0, sheets = [];
  try {
    await new Promise((resolve, reject) => {
      zip.on("error", reject); zip.on("end", resolve);
      zip.on("entry", entry => {
        size += entry.uncompressedSize;
        if (++entries > 2048 || size > 64 * 1024 ** 2 || entry.generalPurposeBitFlag & 1) { reject(new Error("XLSX 압축 해제 크기·항목 수 제한 초과 또는 암호화된 파일입니다.")); return; }
        if (!/\.xml$/i.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { reject(error); return; }
          const chunks = [];
          stream.on("data", chunk => chunks.push(chunk)); stream.on("error", reject);
          stream.on("end", () => {
            try {
              const xml = Buffer.concat(chunks).toString("utf8");
              if (/<!DOCTYPE|<!ENTITY|\x00/i.test(xml)) throw new Error("XLSX XML 인코딩 또는 외부 엔티티를 지원하지 않습니다.");
              const names = require("./xlsx-reader").inspectXml(xml);
              if (entry.fileName === "xl/workbook.xml") sheets = names;
              zip.readEntry();
            } catch (error) { reject(error); }
          });
        });
      });
      zip.readEntry();
    });
    return sheets;
  } finally { zip.close(); }
}

async function importXlsx(connection, file, selectedSheet) {
  const info = await fs.stat(file);
  if (info.size > 32 * 1024 ** 2) throw new Error("XLSX 파일은 32 MiB까지 지원합니다. 큰 파일은 CSV 또는 Parquet로 변환해 주세요.");
  const buffer = await fs.readFile(file);
  if (buffer.length > 32 * 1024 ** 2) throw new Error("XLSX 파일 크기 제한을 초과했습니다.");
  const sheets = await validateWorkbook(buffer);
  const name = selectedSheet ?? sheets[0];
  if (!sheets.includes(name)) throw new Error(`XLSX 시트를 찾을 수 없습니다: ${name ?? "첫 시트"}`);
  const workbook = await require("./xlsx-reader").readWorkbook(buffer, { trim: false, sheets: [name], parseNumber: raw => {
    const value = Number(raw);
    return Number.isInteger(value) && !Number.isSafeInteger(value) ? raw : value;
  } });
  const sheet = workbook[0];
  if (!sheet) throw new Error(`XLSX 시트를 찾을 수 없습니다: ${selectedSheet ?? "첫 시트"}`);
  const data = sheet.data;
  if (!data.length || !data[0]?.length) throw new Error("XLSX 시트에 헤더가 없습니다.");
  const width = data.reduce((max, row) => Math.max(max, row.length), 0);
  if (data.length * width > 2000000) throw new Error("XLSX 시트의 셀 수 제한을 초과했습니다.");
  const columns = Array.from({ length: width }, (_, i) => {
    const kinds = new Set();
    for (let r = 1; r < data.length; r++) { const v = data[r][i]; if (v != null) kinds.add(v instanceof Date ? "date" : typeof v); }
    const kind = kinds.size === 1 ? [...kinds][0] : "string";
    return { name: data[0][i], type: ({ number: "DOUBLE", boolean: "BOOLEAN", date: "TIMESTAMP_MS" })[kind] || "VARCHAR" };
  });
  async function* rows() {
    for (let start = 1; start < data.length; start += 2048) yield data.slice(start, start + 2048).map(row => columns.map((c, i) => {
      const v = row[i];
      if (v == null) return null;
      if (c.type === "TIMESTAMP_MS") return timestampMillisValue(BigInt(v.getTime()));
      return c.type === "VARCHAR" ? v instanceof Date ? v.toISOString() : String(v) : v;
    }));
  }
  return { rowCount: await appendRows(connection, columns, rows()), sheets, selectedSheet: sheet.sheet };
}

module.exports = { EXTENSIONS, formatOf, importSbdf, importXlsx };
