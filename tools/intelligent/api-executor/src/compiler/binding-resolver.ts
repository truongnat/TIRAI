// API Executor v1 — Binding resolution.
//
// Resolves DataValueExpression into concrete values using RuntimeBindingStore.

import type { DataValueExpression, RuntimeBindingStore } from '../models.js';
import { ApiErrorCode, ApiExecutorError } from '../errors.js';

export function resolveValueExpression(
  expr: DataValueExpression,
  bindings: RuntimeBindingStore,
  operationId: string,
): unknown {
  if (expr.type === 'literal') {
    return expr.value;
  }

  if (expr.type === 'binding') {
    if (!expr.binding) {
      throw new ApiExecutorError(
        ApiErrorCode.API_BINDING_MISSING,
        `Binding expression missing binding name.`,
        { operationId },
      );
    }
    const value = bindings.resolve(expr.binding);
    if (value === undefined) {
      throw new ApiExecutorError(
        ApiErrorCode.API_BINDING_MISSING,
        `Required binding '${expr.binding}' is not available in the runtime binding store.`,
        { operationId },
      );
    }
    return value.value;
  }

  throw new ApiExecutorError(
    ApiErrorCode.API_INVALID_OPERATION,
    `Unsupported value expression type: ${(expr as DataValueExpression).type}`,
    { operationId },
  );
}

export function resolveRecordExpressions(
  record: Record<string, DataValueExpression> | undefined,
  bindings: RuntimeBindingStore,
  operationId: string,
): Record<string, unknown> {
  if (!record) return {};
  const result: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(record)) {
    result[key] = resolveValueExpression(expr, bindings, operationId);
  }
  return result;
}

export function resolveBodyDeep(
  body: unknown,
  bindings: RuntimeBindingStore,
  operationId: string,
): unknown {
  if (body === null || body === undefined) return body;

  if (typeof body === 'object' && 'type' in body && (body as DataValueExpression).type) {
    return resolveValueExpression(body as DataValueExpression, bindings, operationId);
  }

  if (Array.isArray(body)) {
    return body.map((item) => resolveBodyDeep(item, bindings, operationId));
  }

  if (typeof body === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      result[key] = resolveBodyDeep(value, bindings, operationId);
    }
    return result;
  }

  return body;
}
