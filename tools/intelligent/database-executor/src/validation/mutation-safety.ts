// ---------------------------------------------------------------------------
// Database Executor – mutation safety
// ---------------------------------------------------------------------------
// Enforces safety rules for database mutations.

import type {
  DatabaseCommand,
  ExecutionContext,
} from '../models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';

/** DDL keywords that are absolutely forbidden in v1. */
const DDL_KEYWORDS = [
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'TRUNCATE',
  'CREATE USER',
  'GRANT',
  'REVOKE',
];

/**
 * Reject DDL statements in the compiled command text.
 */
export function rejectDDL(command: DatabaseCommand, operationId: string): void {
  const upperText = command.text.toUpperCase();
  for (const ddl of DDL_KEYWORDS) {
    if (upperText.includes(ddl)) {
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_DDL_REJECTED,
        message: `DDL statement "${ddl}" is forbidden in database executor v1`,
        operationId,
      });
    }
  }
}

/**
 * Reject raw SQL input from the IR.  Database Executor generates SQL from
 * canonical operation specs only — it never executes arbitrary SQL strings.
 */
export function rejectRawSql(parameters: Record<string, unknown>, operationId: string): void {
  // Check if the parameters contain a 'sql' field with raw SQL text
  if ('sql' in parameters && typeof parameters.sql === 'string') {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_RAW_SQL_REJECTED,
      message: 'Raw SQL input from IR is rejected — Database Executor generates parameterized commands only',
      operationId,
    });
  }
}

/**
 * Validate that the execution context permits mutation.
 * All safety gates must pass (spec §2).
 */
export function validateMutationGate(
  context: ExecutionContext,
  resourceId: string,
  operationId: string,
): void {
  // Gate 1: mode must be execute
  if (context.mode !== 'execute') {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_GATE_FAILURE,
      message: `Database mutation requires execute mode, got: ${context.mode}`,
      operationId,
    });
  }

  // Gate 2: policy must allow mutation
  if (!context.policy.allowMutation) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_GATE_FAILURE,
      message: 'ExecutionPolicy.allowMutation is false — mutation denied',
      operationId,
    });
  }

  // Gate 3: resource must be allowlisted
  if (!context.policy.allowedResourceIds.includes(resourceId)) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_GATE_FAILURE,
      message: `Resource "${resourceId}" is not in the allowed resource list`,
      operationId,
    });
  }

  // Gate 4: resource must not be denied
  if (context.policy.deniedResourceIds.includes(resourceId)) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_GATE_FAILURE,
      message: `Resource "${resourceId}" is explicitly denied`,
      operationId,
    });
  }
}

/**
 * Validate that a DELETE or UPDATE command has a WHERE clause.
 * spec §34-35: reject operations without criteria.
 */
export function validateWhereClause(command: DatabaseCommand, operationId: string): void {
  if ((command.kind === 'delete' || command.kind === 'update') && !command.text.includes('WHERE')) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNSAFE_MUTATION,
      message: `${command.kind.toUpperCase()} without WHERE clause is rejected`,
      operationId,
    });
  }
}
