// ---------------------------------------------------------------------------
// Database Executor – error codes and error class
// ---------------------------------------------------------------------------

/** Database executor error codes (spec §43). */
export const DatabaseErrorCode = {
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_TIMEOUT: 'DB_TIMEOUT',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  DB_CONSTRAINT_VIOLATION: 'DB_CONSTRAINT_VIOLATION',
  DB_UNIQUE_VIOLATION: 'DB_UNIQUE_VIOLATION',
  DB_FOREIGN_KEY_VIOLATION: 'DB_FOREIGN_KEY_VIOLATION',
  DB_NOT_NULL_VIOLATION: 'DB_NOT_NULL_VIOLATION',
  DB_NO_MATCH: 'DB_NO_MATCH',
  DB_AMBIGUOUS_RESULT: 'DB_AMBIGUOUS_RESULT',
  DB_UNSAFE_IDENTIFIER: 'DB_UNSAFE_IDENTIFIER',
  DB_UNSAFE_MUTATION: 'DB_UNSAFE_MUTATION',
  DB_BINDING_MISSING: 'DB_BINDING_MISSING',
  DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',
  DB_CLEANUP_FAILED: 'DB_CLEANUP_FAILED',
  DB_UNKNOWN_ERROR: 'DB_UNKNOWN_ERROR',
  DB_DDL_REJECTED: 'DB_DDL_REJECTED',
  DB_RAW_SQL_REJECTED: 'DB_RAW_SQL_REJECTED',
  DB_GATE_FAILURE: 'DB_GATE_FAILURE',
  DB_MISSING_CONFIG: 'DB_MISSING_CONFIG',
  DB_MISSING_CATALOG: 'DB_MISSING_CATALOG',
} as const;

export type DatabaseErrorCodeType = typeof DatabaseErrorCode[keyof typeof DatabaseErrorCode];

/** Typed error for database executor failures. */
export class DatabaseExecutorError extends Error {
  readonly code: DatabaseErrorCodeType;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly sqlstate?: string;

  constructor(opts: {
    code: DatabaseErrorCodeType;
    message: string;
    retryable?: boolean;
    operationId?: string;
    sqlstate?: string;
  }) {
    super(opts.message);
    this.name = 'DatabaseExecutorError';
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.operationId = opts.operationId;
    this.sqlstate = opts.sqlstate;
  }
}
