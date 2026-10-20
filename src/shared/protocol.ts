/** Structured-clone/JSON-compatible values sent to the Webview. */
export type CellValue = null | boolean | number | string | CellValue[] | { [key: string]: CellValue | undefined };
export interface TruncatedCell { __pq_truncated__: true; type: string; preview: string; original_bytes?: number; preview_bytes?: number; item_count?: number }
export type DataFormat = 'parquet' | 'csv' | 'tsv' | 'sbdf' | 'xlsx';
export interface Column { name: string; type: string }
export interface ResultColumn extends Column { index: number }
export interface EngineSettings { queryTimeoutSeconds?: number; exactResultCount?: boolean; memoryLimit?: string; threads?: number; tempDirectory?: string; maxTempSize?: string; maxCellBytes?: number; sheet?: string }
export interface SourceMetadata {
 source_path: string; source_kind: 'file' | 'dataset'; format: DataFormat; file_count: number; file_bytes: number;
 row_count: number | null; column_count: number; sheets: string[]; selected_sheet: string | null;
 columns: Column[]; allowed_root: string; view_name: string; default_query: string;
}
export interface SourceStatistics { source_path: string; column_count: number; row_count: number; method: string; elapsed_ms: number }
export interface QueryPayload {
 sql?: string; page?: number; page_size?: number; row_offset?: number; column_offset?: number; column_limit?: number;
 timeout_seconds?: number; include_total_rows?: boolean; pinned_column_indices?: number[]; request_id?: string; favorite_id?: string;
}
export interface QueryResult {
 ok: true; request_id: string; sql?: string; page: number; page_size: number; row_offset: number; has_more: boolean;
 total_rows: number | null; rows: CellValue[][]; columns: ResultColumn[]; column_offset: number; column_limit: number;
 total_columns: number; has_previous_columns: boolean; has_more_columns: boolean; previous_column_offset: number;
 next_column_offset: number; elapsed_ms: number; timeout_seconds: number;
}
export type LintResult = { ok: true; message?: string; elapsed_ms?: number } | { ok: false; message: string; position?: { line: number; column: number } | null; elapsed_ms?: number };
export interface CancelResult { cancelled: boolean; request_id?: string; active_request_id: string | null }
export interface Favorite { id: string; alias: string; description: string; preview: string; useCount: number; pinned: boolean; createdAt?: string; updatedAt?: string; lastUsedAt?: string | null }
export interface FavoriteInput { id?: string; alias?: string; description?: string; sql?: string }
export interface FavoriteSql extends Favorite { sql: string }
export type SaveFavoriteResult = (Favorite & { cancelled?: false }) | { cancelled: true };
export interface EngineOperations {
 meta: { payload: Record<string, never>; result: SourceMetadata };
 stats: { payload: Record<string, never>; result: SourceStatistics };
 query: { payload: QueryPayload; result: QueryResult };
 lint: { payload: { sql?: string }; result: LintResult };
 source: { payload: { path: string; sheet?: string }; result: SourceMetadata };
 cancel: { payload: { request_id?: string }; result: CancelResult };
}
export interface Operations extends EngineOperations {
 restart: { payload: Record<string, never>; result: { restarted: true; initialSql?: string } };
 'favorites.save': { payload: { id?: string; sql?: string }; result: SaveFavoriteResult };
 'favorites.list': { payload: Record<string, never>; result: { folder: string; items: Favorite[] } };
 'favorites.get': { payload: { id?: string }; result: FavoriteSql };
 'favorites.pin': { payload: { id?: string }; result: Favorite };
 'favorites.remove': { payload: { id?: string }; result: { removed: boolean } };
 'favorites.copyPath': { payload: Record<string, never>; result: { copied: true } };
}
export type EngineOperation = keyof EngineOperations;
export type Operation = keyof Operations;
export type Payload<K extends Operation> = Operations[K]['payload'];
export type Result<K extends Operation> = Operations[K]['result'];
export type RequestArgs<K extends Operation> = {} extends Payload<K> ? [payload?: Payload<K>] : [payload: Payload<K>];
export type RequestMessage<K extends Operation = Operation> = { [P in K]: { id: number; operation: P; payload?: Payload<P>; type?: never } }[K];
export type StartupMessage = { type: 'ready'; initialSql?: string } | { type: 'startupError'; error: string; code?: string };
export type WorkerMessage = StartupMessage | { id: number; result?: unknown; error?: string; type?: never };
export type WorkerRequest = RequestMessage<EngineOperation> | { type: 'shutdown' };
export interface Bridge { request<K extends EngineOperation>(operation: K, ...args: RequestArgs<K>): Promise<Result<K>>; stop(): Promise<number> }
