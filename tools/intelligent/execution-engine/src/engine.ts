// ---------------------------------------------------------------------------
// Execution Engine – main orchestrator
// ---------------------------------------------------------------------------
// Transforms Executable Data Preparation IR into Execution Result IR.
// Enforces policy, schedules operations in dependency order, dispatches
// to executors, manages bindings, handles failures/cleanup/rollback,
// and produces a complete audit trail.
//
// Default mode is dry-run — mutation requires triple-gate agreement.

import type {
  ExecutableDataPreparationIR,
  ExecutionResultIR,
  ExecutionContext,
  ExecutionOptions,
  ExecutionMode,
  ExecutionIRStatus,
  OperationExecutionResult,
  ExecutionUnresolved,
  ExecutionWarning,
  PreparationOperation,
  CleanupExecutionSummary,
  RollbackExecutionSummary,
  ExecutionManifest,
  ExecutorType,
} from './models.js';
import { defaultPolicy, mergePolicy, PolicyEngine } from './policy.js';
import { getExecutor, findBestExecutor } from './registry.js';
import { InMemoryBindingStore } from './binding-store.js';
import { DefaultAuditRecorder, auditEvent } from './audit.js';
import { topologicalExecutionOrder, getPredecessors } from './scheduler.js';
import { validateExecutionInput } from './validation/input-validator.js';
import { computeExecutionQuality } from './quality/metrics.js';
import { executeCleanup } from './cleanup/cleanup-handler.js';
import { executeRollback } from './rollback/rollback-handler.js';
import { ExecutionEngineError, ExecutionErrorCode } from './errors.js';
import { ExecutionWarningCode } from './warnings.js';

/**
 * Execute an Executable Data Preparation IR according to the given
 * policy and options.  Returns an ExecutionResultIR and any warnings.
 */
export async function executePreparation(
  ir: ExecutableDataPreparationIR,
  options?: ExecutionOptions,
): Promise<{ result: ExecutionResultIR; warnings: ExecutionWarning[] }> {
  // 1. Validate input
  validateExecutionInput(ir);

  // 2. Build policy
  const policy = mergePolicy(defaultPolicy(), options?.policy);

  // 3. Build execution context
  const bindingStore = new InMemoryBindingStore();
  const auditRecorder = new DefaultAuditRecorder(
    policy.mode === 'dry-run' ? '2025-01-01T00:00:00.000Z' : undefined,
  );
  const context: ExecutionContext = {
    mode: policy.mode,
    policy,
    bindings: bindingStore,
    audit: auditRecorder,
    seed: options?.seed,
  };

  const executionId = options?.executionIdProvider?.generate() ?? `EXEC-${Date.now()}`;
  const warnings: ExecutionWarning[] = [];

  auditRecorder.record(auditEvent('execution-start', `Execution ${executionId} started in ${policy.mode} mode`));

  // 4. Policy validation
  const policyEngine = new PolicyEngine();
  const policyResult = policyEngine.validate(ir, policy);
  auditRecorder.record(auditEvent('policy-validation', `Policy validation: ${policyResult.valid ? 'passed' : 'failed'}`));

  // 5. Compute execution order
  let executionOrder: string[];
  try {
    executionOrder = topologicalExecutionOrder(ir.operations, ir.dependencies);
  } catch (err) {
    throw new ExecutionEngineError(
      ExecutionErrorCode.CYCLE_DETECTED,
      'Operation dependency graph contains cycles',
      err,
    );
  }

  // 6. Execute based on mode
  const opsById = new Map(ir.operations.map((o) => [o.id, o]));
  const opResults: OperationExecutionResult[] = [];
  const failedOps = new Set<string>();
  const blockedOps = new Set<string>();

  if (policy.mode === 'dry-run') {
    // Dry-run: validate only, no execution
    for (const opId of executionOrder) {
      const op = opsById.get(opId)!;
      const executor = getExecutor(op.resolver as ExecutorType);

      if (!executor) {
        opResults.push(makeDryRunResult(op, 'blocked'));
        warnings.push({
          code: ExecutionWarningCode.EXECUTOR_NOT_FOUND,
          message: `No executor for type ${op.resolver}`,
          operationId: op.id,
        });
        continue;
      }

      // Check if blocked by dependency
      const preds = getPredecessors(opId, ir.dependencies);
      const anyBlocked = preds.some((p) => blockedOps.has(p) || failedOps.has(p));
      if (anyBlocked) {
        blockedOps.add(opId);
        opResults.push(makeDryRunResult(op, 'blocked'));
        continue;
      }

      if (op.resolver === 'manual') {
        opResults.push(makeDryRunResult(op, 'manual'));
        warnings.push({
          code: ExecutionWarningCode.MANUAL_OPERATION,
          message: `Manual operation: ${op.id}`,
          operationId: op.id,
        });
      } else {
        opResults.push(makeDryRunResult(op, 'validated'));
      }
    }
  } else {
    // Simulate (or execute) mode: run operations through executors
    for (const opId of executionOrder) {
      const op = opsById.get(opId)!;

      // Check if blocked
      const preds = getPredecessors(opId, ir.dependencies);
      const anyFailed = preds.some((p) => failedOps.has(p));
      const anyBlocked = preds.some((p) => blockedOps.has(p));
      if (anyFailed || anyBlocked) {
        blockedOps.add(opId);
        opResults.push(makeBlockedResult(op));
        auditRecorder.record(auditEvent('operation-end', `Blocked: ${op.id}`, op.id));
        continue;
      }

      // Find executor
      const executor = findBestExecutor(op, context)?.executor ?? getExecutor(op.resolver as ExecutorType);
      if (!executor) {
        failedOps.add(opId);
        opResults.push(makeErrorResult(op, 'EXECUTOR_NOT_FOUND', `No executor for type ${op.resolver}`));
        if (policy.failFast) break;
        continue;
      }

      // Check consumed bindings
      const missingBindings = op.consumes.filter((c) => !bindingStore.isResolved(c));
      if (missingBindings.length > 0) {
        warnings.push({
          code: ExecutionWarningCode.BINDING_MISSING,
          message: `Unresolved bindings: ${missingBindings.join(', ')}`,
          operationId: op.id,
        });
      }

      // Execute
      auditRecorder.record(auditEvent('operation-start', `Executing ${op.id}`, op.id));
      const result = await executor.execute(op, context);
      opResults.push(result);

      if (result.status === 'succeeded') {
        // Produce bindings
        for (const binding of result.producedBindings) {
          bindingStore.produce(binding);
          auditRecorder.record(auditEvent('binding-produced', `Produced ${binding.name}`, op.id));
        }
      } else if (result.status === 'failed') {
        failedOps.add(opId);
        if (policy.failFast) {
          auditRecorder.record(auditEvent('operation-end', `Failed (fail-fast): ${op.id}`, op.id));
          break;
        }
      } else if (result.status === 'manual') {
        // Manual operations don't fail the engine
        warnings.push({
          code: ExecutionWarningCode.MANUAL_OPERATION,
          message: `Manual operation: ${op.id}`,
          operationId: op.id,
        });
      }
      auditRecorder.record(auditEvent('operation-end', `${result.status}: ${op.id}`, op.id));
    }
  }

  // 7. Cleanup
  let cleanupSummary: CleanupExecutionSummary = { attempted: 0, succeeded: 0, failed: 0, results: [] };
  if (policy.mode !== 'dry-run' && (policy.cleanupAfterSuccess || policy.cleanupOnFailure)) {
    const hasFailures = failedOps.size > 0;
    const shouldCleanup = hasFailures ? policy.cleanupOnFailure : policy.cleanupAfterSuccess;
    if (shouldCleanup) {
      cleanupSummary = await executeCleanup(opResults, ir.operations, executionOrder, context);
    }
  }

  // 8. Rollback
  let rollbackSummary: RollbackExecutionSummary = { attempted: 0, succeeded: 0, failed: 0, results: [] };
  if (policy.mode !== 'dry-run' && policy.rollbackOnFailure && failedOps.size > 0) {
    rollbackSummary = await executeRollback(opResults, ir.operations, executionOrder, context);
  }

  // 9. Build bindings snapshot
  const bindingsSnapshot = bindingStore.safeSnapshot();

  // 10. Preserve unresolved
  const unresolved: ExecutionUnresolved[] = ir.unresolved.map((u) => ({
    id: u.id,
    dataItemId: u.dataItemId,
    description: u.description,
    reason: u.reason,
    provenance: u.provenance,
  }));

  // 11. Compute quality
  const quality = computeExecutionQuality(opResults, bindingsSnapshot, cleanupSummary, rollbackSummary);

  // 12. Determine overall status
  const status = determineOverallStatus(policy.mode, opResults, failedOps.size > 0);

  auditRecorder.record(auditEvent('execution-end', `Execution completed: ${status}`));

  const result: ExecutionResultIR = {
    schemaVersion: '1.0',
    executionId,
    mode: policy.mode,
    status,
    operations: opResults,
    bindings: bindingsSnapshot,
    cleanup: cleanupSummary,
    rollback: rollbackSummary,
    unresolved,
    auditTrail: auditRecorder.events(),
    quality,
  };

  return { result, warnings };
}

/** Build manifest for output persistence. */
export function buildManifest(
  sourcePath: string,
  mode: ExecutionMode,
  result: ExecutionResultIR,
  warnings: ExecutionWarning[],
): ExecutionManifest {
  return {
    schemaVersion: '1.0',
    source: { executableDataPreparationIR: sourcePath },
    mode,
    stats: {
      operationsTotal: result.quality.operationsTotal,
      succeeded: result.quality.succeeded,
      failed: result.quality.failed,
      blocked: result.quality.blocked,
      manual: result.quality.manual,
      bindingsProduced: result.quality.bindingsProduced,
      cleanupAttempted: result.cleanup.attempted,
      rollbackAttempted: result.rollback.attempted,
      auditEvents: result.auditTrail.length,
    },
    warnings,
  };
}

// ---- Helpers --------------------------------------------------------------

function makeDryRunResult(op: PreparationOperation, status: 'validated' | 'blocked' | 'manual'): OperationExecutionResult {
  return {
    operationId: op.id,
    dataItemId: op.dataItemId,
    status,
    executorType: op.resolver as ExecutorType,
    action: op.action,
    producedBindings: [],
    warnings: [],
    provenance: op.provenance,
    retryCount: 0,
  };
}

function makeBlockedResult(op: PreparationOperation): OperationExecutionResult {
  return {
    operationId: op.id,
    dataItemId: op.dataItemId,
    status: 'blocked',
    executorType: op.resolver as ExecutorType,
    action: op.action,
    producedBindings: [],
    warnings: [{ code: ExecutionWarningCode.RESOURCE_BLOCKED, message: 'Blocked by failed dependency', operationId: op.id }],
    provenance: op.provenance,
    retryCount: 0,
  };
}

function makeErrorResult(op: PreparationOperation, code: string, message: string): OperationExecutionResult {
  return {
    operationId: op.id,
    dataItemId: op.dataItemId,
    status: 'failed',
    executorType: op.resolver as ExecutorType,
    action: op.action,
    producedBindings: [],
    warnings: [],
    error: { code, message, retryable: false, executorType: op.resolver as ExecutorType },
    provenance: op.provenance,
    retryCount: 0,
  };
}

function determineOverallStatus(
  mode: ExecutionMode,
  results: OperationExecutionResult[],
  hasFailures: boolean,
): ExecutionIRStatus {
  if (mode === 'dry-run') return 'validated';
  if (hasFailures) {
    const anySucceeded = results.some((r) => r.status === 'succeeded');
    return anySucceeded ? 'partially-succeeded' : 'failed';
  }
  const hasManual = results.some((r) => r.status === 'manual');
  if (hasManual) return 'partially-succeeded';
  return 'succeeded';
}
