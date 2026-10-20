/** Error values cross native, Worker and file-system boundaries. */
export function errorMessage(error: unknown): string {
  return String((error as { message?: unknown } | null)?.message || error);
}
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
