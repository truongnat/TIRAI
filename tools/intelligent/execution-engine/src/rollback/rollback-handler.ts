// ---------------------------------------------------------------------------
// Execution Engine – rollback handler
// ---------------------------------------------------------------------------
// Rolls back successfully executed operations in reverse order when a
// failure occurs and policy.rollbackOnFailure is true.

import type {
  PreparationOperation,
  ExecutionContext,
  OperationExecutionResult,
  RollbackOperationResult,
  RollbackExecutionSummary,
  ExecutorType,
} from '../models.js';
import { getExecutor } from '../registry.js';
import { auditEvent } from '../audit.js';

/**
 * Rollback successfully executed operations in reverse execution order.
 * Only operations whose executor supports rollback participate.
 */
export async function executeRollback(
  executedOps: OperationExecutionResult[],
  operations: PreparationOperation[],
  executionOrder: string[],
  context: ExecutionContext,
): Promise<RollbackExecutionSummary> {
  const opsById = new Map(operations.map((o) => [o.id, o]));
  const succeededIds = new Set(
    executedOps.filter((r) => r.status === 'succeeded').map((r) => r.operationId),
  );

  // Reverse execution order for rollback
  const rollbackTargets: PreparationOperation[] = [];
  for (const opId of [...executionOrder].reverse()) {
    const op = opsById.get(opId);
    if (!op || !succeededIds.has(opId)) continue;
    rollbackTargets.push(op);
  }

  const results: RollbackOperationResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const op of rollbackTargets) {
    const executor = getExecutor(op.resolver as ExecutorType);
    context.audit.record(auditEvent('rollback-start', `Rollback for ${op.id}`, op.id));

    if (!executor?.rollback) {
      results.push({
        operationId: `ROLLBACK-${op.id}`,
        parentOperationId: op.id,
        status: 'skipped',
      });
      context.audit.record(auditEvent('rollback-end', `No rollback handler for ${op.id}`, op.id));
      continue;
    }

    try {
      const result = await executor.rollback(op, context);
      const status = result.status === 'succeeded' ? 'succeeded' : 'failed';
      if (status === 'succeeded') succeeded++;
      else failed++;
      results.push({
        operationId: `ROLLBACK-${op.id}`,
        parentOperationId: op.id,
        status,
        error: result.error,
      });
    } catch {
      failed++;
      results.push({
        operationId: `ROLLBACK-${op.id}`,
        parentOperationId: op.id,
        status: 'failed',
        error: { code: 'ROLLBACK_ERROR', message: 'Rollback threw an exception', retryable: false },
      });
    }
    context.audit.record(auditEvent('rollback-end', `Rollback ${results.at(-1)!.status} for ${op.id}`, op.id));
  }

  return { attempted: results.length, succeeded, failed, results };
}
