import { basicSetup, EditorView } from "codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { keymap } from "@codemirror/view";

const styleNonce = document.currentScript?.nonce || "";

const colors = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword], color: "var(--pq-sql-keyword)", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--pq-sql-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--pq-sql-number)" },
  { tag: tags.comment, color: "var(--pq-sql-comment)", fontStyle: "italic" },
  { tag: [tags.variableName, tags.propertyName], color: "var(--pq-sql-variable)" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--vscode-editor-foreground)", backgroundColor: "var(--vscode-editor-background)" },
  ".cm-content": { caretColor: "var(--vscode-editorCursor-foreground)" },
  ".cm-gutters": {
    color: "var(--vscode-editorLineNumber-foreground)",
    backgroundColor: "var(--vscode-editorGutter-background, var(--vscode-editor-background))",
    borderRight: "1px solid var(--vscode-panel-border)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--vscode-editor-lineHighlightBackground, transparent)",
  },
});

function diagnosticsFor(state, result) {
  if (result.ok) return [];
  const position = result.position;
  if (!position || state.doc.length === 0) {
    return [{ from: 0, to: Math.min(1, state.doc.length), severity: "error", message: result.message }];
  }
  const line = state.doc.line(Math.min(state.doc.lines, Math.max(1, position.line + 1)));
  const from = Math.min(line.to, line.from + Math.max(0, position.column));
  return [{ from, to: Math.min(state.doc.length, from + 1), severity: "error", message: result.message }];
}

window.PQSqlEditor = {
  create(parent, { onRun, onLint }) {
    const view = new EditorView({
      doc: "SELECT * FROM data",
      parent,
      extensions: [
        basicSetup,
        EditorView.cspNonce.of(styleNonce),
        sql({ dialect: PostgreSQL }),
        syntaxHighlighting(colors),
        theme,
        lintGutter(),
        linter(async (current) => {
          try { return diagnosticsFor(current.state, await onLint(current.state.doc.toString())); }
          catch { return []; }
        }, { delay: 650 }),
        keymap.of([{ key: "Mod-Enter", run: () => { onRun(); return true; } }]),
      ],
    });
    return {
      getValue: () => view.state.doc.toString(),
      applyLintResult: (result) => view.dispatch(setDiagnostics(view.state, diagnosticsFor(view.state, result))),
      focus: () => view.focus(),
      destroy: () => view.destroy(),
    };
  },
};
