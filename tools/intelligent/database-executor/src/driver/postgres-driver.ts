// ---------------------------------------------------------------------------
// Database Executor – PostgreSQL driver
// ---------------------------------------------------------------------------
// Concrete PostgreSQL driver using the `pg` package.  This file is the ONLY
// place that imports `pg`.  All domain types remain driver-agnostic.
//
// For v1, the driver is implemented as a thin wrapper.  When `pg` is not
// installed (e.g. in CI without native dependencies), the driver will throw
// a clear error on connect() rather than at import time.

import type {
  DatabaseDriver,
  DatabaseSession,
  DatabaseConnectionConfig,
  ResolvedSecrets,
  DatabaseCommand,
  DatabaseQueryResult,
  HealthCheckResult,
} from '../models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';

// Minimal client interface — avoids importing `pg` at compile time.
// The actual `pg.Client` satisfies this interface at runtime.
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  end(): Promise<void>;
}

interface PgModule {
  default: { new(config?: Record<string, unknown>): PgClient };
  Client: { new(config?: Record<string, unknown>): PgClient };
}

// ---- PostgreSQL driver implementation -------------------------------------

export class PostgreSQLDriver implements DatabaseDriver {
  readonly dialect = 'postgresql' as const;

  async connect(
    config: DatabaseConnectionConfig,
    secrets: ResolvedSecrets,
  ): Promise<DatabaseSession> {
    let pg: PgModule;
    try {
      pg = await import('pg') as unknown as PgModule;
    } catch {
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_CONNECTION_FAILED,
        message: 'PostgreSQL driver (pg) is not installed. Run: npm install pg',
      });
    }

    const connectionTimeoutMs = config.connectionTimeoutMs ?? 10000;
    const queryTimeoutMs = config.queryTimeoutMs ?? 30000;

    const clientConfig: Record<string, unknown> = {
      connectionTimeoutMillis: connectionTimeoutMs,
      statement_timeout: queryTimeoutMs,
      ssl: config.ssl ? true : undefined,
    };

    if (secrets.connectionString) {
      clientConfig.connectionString = secrets.connectionString;
    } else {
      clientConfig.host = config.host ?? 'localhost';
      clientConfig.port = config.port ?? 5432;
      clientConfig.database = config.database ?? 'postgres';
      clientConfig.user = secrets.user ?? 'postgres';
      clientConfig.password = secrets.password ?? '';
    }

    let client: PgClient;
    try {
      const PgClientCtor = pg.Client ?? pg.default;
      client = new PgClientCtor(clientConfig);
      await client.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_CONNECTION_FAILED,
        message: `PostgreSQL connection failed: ${message}`,
        retryable: isTransientError(err),
      });
    }

    return new PostgreSQLSession(client, queryTimeoutMs);
  }

  async healthCheck(
    config: DatabaseConnectionConfig,
    secrets: ResolvedSecrets,
  ): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const session = await this.connect(config, secrets);
      await session.query({
        kind: 'select',
        text: 'SELECT 1 AS ok',
        parameters: [],
        expectedResult: 'one',
        metadata: {
          resourceId: config.resourceId,
          table: '__health_check',
          columns: ['ok'],
          operationId: '__health_check',
          parameterBindings: [],
        },
      });
      await session.close();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ---- PostgreSQL session ---------------------------------------------------

class PostgreSQLSession implements DatabaseSession {
  private readonly client: PgClient;
  private readonly queryTimeoutMs: number;
  private inTransaction = false;

  constructor(client: PgClient, queryTimeoutMs: number) {
    this.client = client;
    this.queryTimeoutMs = queryTimeoutMs;
  }

  async query(command: DatabaseCommand): Promise<DatabaseQueryResult> {
    try {
      const result = await this.client.query(command.text, command.parameters as unknown[]);
      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? 0,
        command: command.kind,
      };
    } catch (err) {
      throw mapPostgreSQLError(err, command);
    }
  }

  async begin(): Promise<void> {
    if (this.inTransaction) return;
    await this.client.query('BEGIN');
    this.inTransaction = true;
  }

  async commit(): Promise<void> {
    if (!this.inTransaction) return;
    await this.client.query('COMMIT');
    this.inTransaction = false;
  }

  async rollback(): Promise<void> {
    if (!this.inTransaction) return;
    try {
      await this.client.query('ROLLBACK');
    } catch {
      // Swallow rollback errors — the connection may already be broken
    }
    this.inTransaction = false;
  }

  async close(): Promise<void> {
    try {
      if (this.inTransaction) {
        await this.rollback();
      }
    } finally {
      await this.client.end();
    }
  }
}

// ---- Error mapping (spec §44) ---------------------------------------------

function mapPostgreSQLError(err: unknown, command: DatabaseCommand): DatabaseExecutorError {
  const pgErr = err as { code?: string; message?: string; detail?: string };
  const sqlstate = pgErr?.code;
  const message = pgErr?.message ?? String(err);

  switch (sqlstate) {
    case '23505':
      return new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_UNIQUE_VIOLATION,
        message: `Unique constraint violation: ${message}`,
        sqlstate,
        operationId: command.metadata.operationId,
      });
    case '23503':
      return new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_FOREIGN_KEY_VIOLATION,
        message: `Foreign key violation: ${message}`,
        sqlstate,
        operationId: command.metadata.operationId,
      });
    case '23502':
      return new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_NOT_NULL_VIOLATION,
        message: `Not null violation: ${message}`,
        sqlstate,
        operationId: command.metadata.operationId,
      });
    case '57014': // query_canceled (timeout)
      return new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_TIMEOUT,
        message: `Query timeout after ${command.metadata.operationId}`,
        retryable: true,
        sqlstate,
        operationId: command.metadata.operationId,
      });
    case '08006': // connection_failure
    case '08001': // client cannot connect
      return new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_CONNECTION_FAILED,
        message: `Connection failure: ${message}`,
        retryable: true,
        sqlstate,
        operationId: command.metadata.operationId,
      });
    default:
      return new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_QUERY_FAILED,
        message: `Query failed: ${message}`,
        sqlstate,
        operationId: command.metadata.operationId,
      });
  }
}

/**
 * Determine if an error is transient and potentially retryable.
 */
function isTransientError(err: unknown): boolean {
  const pgErr = err as { code?: string };
  const transientCodes = ['08006', '08001', '57014', '40001', '40P01'];
  return transientCodes.includes(pgErr?.code ?? '');
}
