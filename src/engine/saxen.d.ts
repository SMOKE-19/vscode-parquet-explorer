/** Narrow declarations for the saxen callbacks used by the XML preflight. */
declare module 'saxen' {
  export class Parser {
    on(event: 'error' | 'warn', callback: (error: Error) => void): this;
    on(event: 'openTag', callback: (name: string, attributes: () => Record<string, string>, decode: (value: string) => string) => void): this;
    parse(xml: string): void;
  }
}
