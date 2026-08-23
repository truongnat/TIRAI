// ---------------------------------------------------------------------------
// Database Executor – binding resolver
// ---------------------------------------------------------------------------
// Resolves DataValueExpression into concrete values using the runtime binding
// store from ExecutionContext.

import type {
  DataValueExpression,
  ExecutionContext,
} from '../models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';

/**
 * Resolve a DataValueExpression to a concrete value.
 */
export function resolveValueExpression(
  expr: DataValueExpression,
  context: ExecutionContext,
  operationId: string,
): unknown {
  switch (expr.type) {
    case 'literal':
      return expr.value;

    case 'binding': {
      if (!expr.binding) {
        throw new DatabaseExecutorError({
          code: DatabaseErrorCode.DB_BINDING_MISSING,
          message: 'Binding expression has no binding name',
          operationId,
        });
      }
      const resolved = context.bindings.resolve(expr.binding);
      if (!resolved) {
        throw new DatabaseExecutorError({
          code: DatabaseErrorCode.DB_BINDING_MISSING,
          message: `Unresolved binding: "${expr.binding}"`,
          operationId,
        });
      }
      return resolved.value;
    }

    case 'generated':
    case 'derived': {
      // Generated/derived values should already be in the binding store
      // (produced by ValueGeneratorExecutor earlier in the execution order)
      if (expr.binding) {
        const resolved = context.bindings.resolve(expr.binding);
        if (resolved) return resolved.value;
      }
      // If a literal value is provided alongside, use it
      if (expr.value !== undefined) return expr.value;
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_BINDING_MISSING,
        message: `Generated/derived binding not available: "${expr.binding ?? '?'}"`,
        operationId,
      });
    }

    case 'boundary':
      return expr.value;

    default:
      return expr.value;
  }
}
