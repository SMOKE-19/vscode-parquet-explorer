import readUniversalWorkbook from "read-excel-file/universal";
import { Parser } from "saxen";

// The universal reader uses ArrayBuffer and avoids optional Node ESM loaders
// and another worker implementation inside our existing extension Worker.
export function readWorkbook(buffer, options) {
  return readUniversalWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), options);
}

export function inspectXml(xml) {
  let maxRow = 0, maxColumn = 0;
  let rowElements = 0, cellElements = 0;
  const sheets = [];
  const parser = new Parser();
  parser.on("error", error => { throw error; });
  parser.on("warn", error => { throw error; });
  parser.on("openTag", (name, getAttributes, decode) => {
    const tag = name.split(":").at(-1), attrs = getAttributes();
    if (tag === "sheet" && attrs.name != null) sheets.push(decode(attrs.name));
    if (tag === "row" && ++rowElements > 100000 || tag === "c" && ++cellElements > 2000000) throw new Error("XLSX 시트 크기 제한을 초과했습니다.");
    if ((tag !== "row" && tag !== "c") || attrs.r == null) return;
    const ref = decode(attrs.r);
    const address = tag === "row" ? /^(\d+)$/.exec(ref) : /^([A-Z]+)(\d+)$/.exec(ref);
    if (!address) throw new Error("XLSX 셀 주소가 올바르지 않습니다.");
    const row = Number(address.at(-1));
    let column = 0;
    if (tag === "c") for (const c of address[1]) column = column * 26 + c.charCodeAt(0) - 64;
    maxRow = Math.max(maxRow, row); maxColumn = Math.max(maxColumn, column);
    if (row < 1 || maxRow > 100000 || maxColumn > 10000 || maxRow * maxColumn > 2000000) throw new Error("XLSX 시트 크기 제한(100,000행·2,000,000셀)을 초과했습니다.");
  });
  parser.parse(xml);
  return sheets;
}
