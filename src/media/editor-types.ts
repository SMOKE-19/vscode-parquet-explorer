import type { LintResult, RequestMessage } from "../shared/protocol";
export interface EditorOptions { onRun(): unknown; onLint(sql: string): Promise<LintResult> }
export interface SqlEditor { getValue(): string; setValue(value: string): void; applyLintResult(result: LintResult): void; focus(): void; destroy(): void }
export interface SqlEditorFactory { create(parent: HTMLElement, options: EditorOptions): SqlEditor }

interface VsCodeApi { postMessage(message: RequestMessage | { type: 'loaded' }): void }
declare global {
  function acquireVsCodeApi(): VsCodeApi;
  interface Window { PQSqlEditor: SqlEditorFactory }
}
