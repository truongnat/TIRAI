// ---------------------------------------------------------------------------
// Database Executor – pg module type declarations
// ---------------------------------------------------------------------------
// Minimal ambient declarations for the optional `pg` package.  These allow
// compilation without `@types/pg` since pg is only needed at runtime for
// execute mode.  The actual pg.Client satisfies these interfaces.

declare module 'pg' {
  export class Client {
    constructor(config?: Record<string, unknown>);
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
    end(): Promise<void>;
  }
}
