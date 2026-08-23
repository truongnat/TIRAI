// ---------------------------------------------------------------------------
// Database Executor – result mapper
// ---------------------------------------------------------------------------
// Converts database query result rows into runtime bindings.

import type {
  DatabaseQueryResult,
  DatabaseCommand,
  ResultMappingSpec,
  RuntimeBindingResult,
} from '../models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';

/**
 * Map query result rows to runtime bindings according to the result mapping spec.
 */
export function mapResultToBindings(
  queryResult: DatabaseQueryResult,
  command: DatabaseCommand,
  resultMappings: ResultMappingSpec[],
  operationId: string,
): RuntimeBindingResult[] {
  const rows = queryResult.rows;

  // spec §21: zero match — return empty (caller decides if unresolved)
  if (rows.length === 0) {
    return [];
  }

  // spec §22: ambiguous result for single-row expectations
  if (command.expectedResult === 'zero-or-one' && rows.length > 1) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_AMBIGUOUS_RESULT,
      message: `Expected at most 1 row but got ${rows.length} for operation ${operationId}`,
      operationId,
    });
  }

  // Use the first row for binding production
  const row = rows[0];
  const bindings: RuntimeBindingResult[] = [];

  for (const mapping of resultMappings) {
    const value = row[mapping.sourceColumn];

    if (value === undefined) {
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_QUERY_FAILED,
        message: `Expected column "${mapping.sourceColumn}" not found in result`,
        operationId,
      });
    }

    bindings.push({
      id: `${operationId}:${mapping.targetBinding}`,
      name: mapping.targetBinding,
      producerOperationId: operationId,
      value,
      sensitive: mapping.sensitive ?? false,
      status: 'resolved',
    });
  }

  return bindings;
}

/**
 * Produce bindings for an INSERT/UPDATE RETURNING result.
 */
export function mapReturningToBindings(
  queryResult: DatabaseQueryResult,
  resultMappings: ResultMappingSpec[],
  operationId: string,
): RuntimeBindingResult[] {
  if (queryResult.rows.length === 0) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_QUERY_FAILED,
      message: `RETURNING produced no rows for operation ${operationId}`,
      operationId,
    });
  }

  const row = queryResult.rows[0];
  const bindings: RuntimeBindingResult[] = [];

  for (const mapping of resultMappings) {
    const value = row[mapping.sourceColumn];

    bindings.push({
      id: `${operationId}:${mapping.targetBinding}`,
      name: mapping.targetBinding,
      producerOperationId: operationId,
      value: value ?? null,
      sensitive: mapping.sensitive ?? false,
      status: 'resolved',
    });
  }

  return bindings;
}
