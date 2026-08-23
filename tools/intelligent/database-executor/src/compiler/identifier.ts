// ---------------------------------------------------------------------------
// Database Executor – identifier validation
// ---------------------------------------------------------------------------
// Identifiers (schema, table, column) cannot be parameterized by PostgreSQL.
// They are accepted only from validated environment mappings and catalogs,
// never from model-generated text or untrusted input.

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';

/** Characters forbidden in any SQL identifier. */
const FORBIDDEN_PATTERNS = [
  /;/,           // statement terminator
  /--/,          // SQL line comment
  /\/\*/,        // SQL block comment open
  /\*\//,        // SQL block comment close
  /'/,           // single quote
  /"/,           // double quote
  /\\/,          // backslash
  /\b(DROP|ALTER|CREATE|TRUNCATE|INSERT|UPDATE|DELETE|SELECT|GRANT|REVOKE)\b/i,
];

/** Maximum allowed identifier length. */
const MAX_IDENTIFIER_LENGTH = 128;

/** Regex for a valid simple identifier (alphanumeric + underscore). */
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Validate a single SQL identifier (schema, table, or column name).
 * Throws DatabaseExecutorError with DB_UNSAFE_IDENTIFIER on rejection.
 */
export function validateIdentifier(
  identifier: string,
  kind: 'schema' | 'table' | 'column',
  allowed?: Set<string>,
): string {
  if (!identifier || identifier.length === 0) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNSAFE_IDENTIFIER,
      message: `Empty ${kind} identifier rejected`,
    });
  }

  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNSAFE_IDENTIFIER,
      message: `${kind} identifier exceeds maximum length (${MAX_IDENTIFIER_LENGTH}): "${identifier.slice(0, 20)}..."`,
    });
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(identifier)) {
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_UNSAFE_IDENTIFIER,
        message: `${kind} identifier contains forbidden pattern: "${identifier}"`,
      });
    }
  }

  if (!VALID_IDENTIFIER.test(identifier)) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNSAFE_IDENTIFIER,
      message: `${kind} identifier contains invalid characters: "${identifier}"`,
    });
  }

  if (allowed && !allowed.has(identifier)) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNSAFE_IDENTIFIER,
      message: `${kind} identifier not in allowed set: "${identifier}"`,
    });
  }

  return identifier;
}

/**
 * Build a set of allowed identifiers from a catalog or mapping.
 */
export function buildAllowedSet(values: string[]): Set<string> {
  return new Set(values);
}

/**
 * Quote an identifier for safe use in PostgreSQL SQL.
 * Uses double-quote escaping per PostgreSQL rules.
 */
export function quoteIdentifier(identifier: string): string {
  // After validation, the identifier is known-safe.  Double-quote wrapping
  // preserves case-sensitivity and prevents keyword collision.
  return `"${identifier}"`;
}
