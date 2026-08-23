// ---------------------------------------------------------------------------
// Execution Engine – manual executor
// ---------------------------------------------------------------------------
// Handles operations that require human intervention.  Manual operations
// are marked with status='manual' and include the instruction text.
// They do not fail the entire engine — the overall status becomes
// 'partially-succeeded' instead.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
} from '../models.js';
import { ExecutionWarningCode } from '../warnings.js';

/**
 * Manual executor.  Always supports any operation but returns status
 * 'manual' with the instruction text.  Used as a universal fallback.
 */
export class ManualExecutor implements PreparationExecutor {
  readonly type = 'manual' as const;

  canExecute(
    _operation: PreparationOperation,
    _context: ExecutionContext,
  ): ExecutorMatch {
    return { supported: true, score: 0.01, reasons: ['manual-fallback'] };
  }

  async validate(
    _operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async execute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const instruction = (operation.parameters.instruction as string) ??
      `Manually prepare: ${operation.dataItemId}`;

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'manual',
      executorType: 'manual',
      action: 'manual',
      producedBindings: [],
      warnings: [{
        code: ExecutionWarningCode.MANUAL_OPERATION,
        message: instruction,
        operationId: operation.id,
      }],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }
}
