// ---------------------------------------------------------------------------
// Execution Engine – quality metrics
// ---------------------------------------------------------------------------

import type {
  OperationExecutionResult,
  RuntimeBindingResult,
  ExecutionQualityMetrics,
  CleanupExecutionSummary,
  RollbackExecutionSummary,
} from '../models.js';

/** Compute execution quality metrics from results. */
export function computeExecutionQuality(
  operations: OperationExecutionResult[],
  bindings: RuntimeBindingResult[],
  cleanup: CleanupExecutionSummary,
  rollback: RollbackExecutionSummary,
): ExecutionQualityMetrics {
  let validated = 0;
  let executed = 0;
  let succeeded = 0;
  let failed = 0;
  let blocked = 0;
  let manual = 0;

  for (const op of operations) {
    switch (op.status) {
      case 'validated': validated++; break;
      case 'succeeded': succeeded++; executed++; break;
      case 'failed': failed++; executed++; break;
      case 'blocked': blocked++; break;
      case 'manual': manual++; break;
      case 'running': executed++; break;
      case 'rolled-back': executed++; break;
      case 'cleanup-succeeded': succeeded++; executed++; break;
      case 'cleanup-failed': succeeded++; executed++; break;
      default: break;
    }
  }

  // Provenance coverage
  let withProvenance = 0;
  for (const op of operations) {
    if (op.provenance.length > 0) withProvenance++;
  }
  const provenanceCoverage = operations.length > 0
    ? withProvenance / operations.length
    : 0;

  // Unresolved bindings
  const unresolvedBindings = bindings.filter((b) => b.status === 'unresolved').length;

  return {
    operationsTotal: operations.length,
    validated,
    executed,
    succeeded,
    failed,
    blocked,
    manual,
    cleanupSucceeded: cleanup.succeeded,
    cleanupFailed: cleanup.failed,
    rollbackSucceeded: rollback.succeeded,
    rollbackFailed: rollback.failed,
    bindingsProduced: bindings.filter((b) => b.status === 'resolved').length,
    unresolvedBindings,
    provenanceCoverage,
  };
}
