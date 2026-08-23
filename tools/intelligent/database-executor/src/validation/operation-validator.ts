// ---------------------------------------------------------------------------
// Database Executor – operation validator
// ---------------------------------------------------------------------------
// Validates database preparation operations before compilation/execution.

import type {
  PreparationOperation,
  DatabasePreparationSpec,
  ExecutionContext,
  ValidationResult,
  DatabaseCatalog,
  ResourceMapping,
  ExecutionWarning,
} from '../models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';
import { validateIdentifier } from '../compiler/identifier.js';

/**
 * Validate a database preparation operation.
 */
export function validateDatabaseOperation(
  operation: PreparationOperation,
  context: ExecutionContext,
  catalog?: DatabaseCatalog,
  mapping?: ResourceMapping,
): ValidationResult {
  const warnings: ExecutionWarning[] = [];

  // Must have a resolverSpec with DatabasePreparationSpec shape
  const spec = operation.resolverSpec as DatabasePreparationSpec | undefined;
  if (!spec) {
    return {
      valid: false,
      errors: [{
        code: DatabaseErrorCode.DB_QUERY_FAILED,
        message: `Operation ${operation.id} has no resolverSpec`,
        operationId: operation.id,
      }],
    };
  }

  // Validate mode
  const validModes = ['select', 'insert', 'derive', 'update', 'restore'];
  if (!validModes.includes(spec.mode)) {
    return {
      valid: false,
      errors: [{
        code: DatabaseErrorCode.DB_QUERY_FAILED,
        message: `Invalid database operation mode: ${spec.mode}`,
        operationId: operation.id,
      }],
    };
  }

  // Validate entity name
  try {
    const allowedTables = catalog
      ? new Set(catalog.schemas.flatMap(s => s.tables.map(t => t.name)))
      : undefined;
    const tableName = mapping?.fieldMappings?.['__table'] ?? spec.entity;
    validateIdentifier(tableName, 'table', allowedTables);
  } catch (err) {
    if (err instanceof DatabaseExecutorError) {
      return {
        valid: false,
        errors: [{
          code: err.code,
          message: err.message,
          operationId: operation.id,
        }],
      };
    }
    throw err;
  }

  // Validate criteria fields for update/delete — must have explicit criteria
  if ((spec.mode === 'update' || spec.mode === 'restore') && (!spec.criteria || spec.criteria.length === 0)) {
    return {
      valid: false,
      errors: [{
        code: DatabaseErrorCode.DB_UNSAFE_MUTATION,
        message: `UPDATE/RESTORE operation ${operation.id} requires explicit criteria`,
        operationId: operation.id,
      }],
    };
  }

  // Validate criterion field names if catalog available
  if (catalog && spec.criteria) {
    const allowedColumns = getAllowedColumnsForEntity(catalog, mapping, spec.entity);
    for (const constraint of spec.criteria) {
      if (constraint.field) {
        try {
          validateIdentifier(constraint.field, 'column', allowedColumns);
        } catch (err) {
          if (err instanceof DatabaseExecutorError) {
            warnings.push({
              code: err.code,
              message: err.message,
              operationId: operation.id,
            });
          }
        }
      }
    }
  }

  // Warn if resource ID is missing
  if (!operation.resourceId) {
    warnings.push({
      code: DatabaseErrorCode.DB_MISSING_CONFIG,
      message: `Operation ${operation.id} has no resourceId`,
      operationId: operation.id,
    });
  }

  return { valid: true, errors: warnings };
}

function getAllowedColumnsForEntity(
  catalog: DatabaseCatalog,
  mapping: ResourceMapping | undefined,
  entity: string,
): Set<string> {
  const tableName = mapping?.fieldMappings?.['__table'] ?? entity;
  const schemaName = mapping?.fieldMappings?.['__schema'];

  for (const schema of catalog.schemas) {
    if (schemaName && schema.name !== schemaName) continue;
    const table = schema.tables.find(t => t.name === tableName);
    if (table) {
      return new Set(table.columns.map(c => c.name));
    }
  }
  return new Set();
}
