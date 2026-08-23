// ---------------------------------------------------------------------------
// Execution Engine – input validator
// ---------------------------------------------------------------------------

import type { ExecutableDataPreparationIR } from '../models.js';
import { ExecutionEngineError, ExecutionErrorCode } from '../errors.js';

/** Validate that the input IR has the required shape. */
export function validateExecutionInput(ir: unknown): asserts ir is ExecutableDataPreparationIR {
  if (!ir || typeof ir !== 'object') {
    throw new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, 'Input IR is null or not an object');
  }
  const obj = ir as Record<string, unknown>;
  if (obj.schemaVersion !== '1.0') {
    throw new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, `Unsupported schema version: ${obj.schemaVersion}`);
  }
  if (!Array.isArray(obj.operations)) {
    throw new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, 'Missing operations array');
  }
  if (!Array.isArray(obj.bindings)) {
    throw new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, 'Missing bindings array');
  }
  if (!Array.isArray(obj.dependencies)) {
    throw new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, 'Missing dependencies array');
  }
  // Check for duplicate operation IDs
  const opIds = new Set<string>();
  for (const op of obj.operations as Array<Record<string, unknown>>) {
    const id = String(op.id);
    if (opIds.has(id)) {
      throw new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, `Duplicate operation ID: ${id}`);
    }
    opIds.add(id);
  }
}
