// Preserve newlines/positions and quoted contents while removing SQL comments.
function withoutComments(sql: string) {
  let result = "", i = 0;
  while (i < sql.length) {
    const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      const stop = end < 0 ? sql.length : end + dollar.length;
      result += sql.slice(i, stop); i = stop;
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      const escapes = quote === "'" && /[eE]/.test(sql[i - 1] || "") && !/[A-Za-z_0-9]/.test(sql[i - 2] || "");
      result += sql[i++];
      while (i < sql.length) {
        const char = sql[i++]; result += char;
        if (escapes && char === "\\" && i < sql.length) { result += sql[i++]; continue; }
        if (char === quote) {
          if (sql[i] !== quote) break;
          result += sql[i++];
        }
      }
    } else if (sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n") { result += " "; i++; }
    } else if (sql.startsWith("/*", i)) {
      let depth = 1; result += "  "; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; result += "  "; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; result += "  "; i += 2; }
        else { result += sql[i] === "\n" ? "\n" : " "; i++; }
      }
    } else result += sql[i++];
  }
  return result;
}

function errorPosition(message: string) {
  const match = message.match(/^LINE\s+(\d+): ?/m);
  if (!match) return null;
  const caret = message.split("\n").findLast(line => line.includes("^")) || "";
  const line = Number(match[1]) - 1;
  return { line, column: Math.max(0, caret.indexOf("^") - match[0].length - (line === 0 && message.slice(match.index! + match[0].length).startsWith("EXPLAIN ") ? "EXPLAIN ".length : 0)) };
}

export { withoutComments, errorPosition };
