// ---------------------------------------------------------------------------
// Execution Engine – cleanup handler
// ---------------------------------------------------------------------------
// Runs cleanup operations in reverse dependency order after execution.
// Only operations that define cleanupOperationIds participate.

import type {
  PreparationOperation,
  ExecutionContext,
  OperationExecutionResult,
  CleanupOperationResult,
  CleanupExecutionSummary,
  ExecutorType,
} from '../models.js';
import { getExecutor } from '../registry.js';
import { auditEvent } from '../audit.js';

/**
 * Execute cleanup for successfully executed operations that have
 * cleanup intents.  Cleanup runs in reverse execution order.
 */
export async function executeCleanup(
  executedOps: OperationExecutionResult[],
  operations: PreparationOperation[],
  executionOrder: string[],
  context: ExecutionContext,
): Promise<CleanupExecutionSummary> {
  const opsById = new Map(operations.map((o) => [o.id, o]));
  const succeededIds = new Set(
    executedOps.filter((r) => r.status === 'succeeded' || r.status === 'cleanup-succeeded').map((r) => r.operationId),
  );

  // Find operations with cleanup, in reverse execution order
  const cleanupTargets: PreparationOperation[] = [];
  for (const opId of [...executionOrder].reverse()) {
    const op = opsById.get(opId);
    if (!op || !succeededIds.has(opId)) continue;
    if (op.cleanupOperationIds.length > 0) {
      cleanupTargets.push(op);
    }
  }

  const results: CleanupOperationResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const op of cleanupTargets) {
    const executor = getExecutor(op.resolver as ExecutorType);
    context.audit.record(auditEvent('cleanup-start', `Cleanup for ${op.id}`, op.id));

    if (!executor?.cleanup) {
      results.push({
        operationId: `CLEANUP-${op.id}`,
        parentOperationId: op.id,
        status: 'skipped',
      });
      context.audit.record(auditEvent('cleanup-end', `No cleanup handler for ${op.id}`, op.id));
      continue;
    }

    try {
      const result = await executor.cleanup(op, context);
      const status = result.status === 'succeeded' ? 'succeeded' : 'failed';
      if (status === 'succeeded') succeeded++;
      else failed++;
      results.push({
        operationId: `CLEANUP-${op.id}`,
        parentOperationId: op.id,
        status,
        error: result.error,
      });
    } catch {
      failed++;
      results.push({
        operationId: `CLEANUP-${op.id}`,
        parentOperationId: op.id,
        status: 'failed',
        error: { code: 'CLEANUP_ERROR', message: 'Cleanup threw an exception', retryable: false },
      });
    }
    context.audit.record(auditEvent('cleanup-end', `Cleanup ${results.at(-1)!.status} for ${op.id}`, op.id));
  }

  return { attempted: results.length, succeeded, failed, results };
}
