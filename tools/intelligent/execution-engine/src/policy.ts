// ---------------------------------------------------------------------------
// Execution Engine – policy engine
// ---------------------------------------------------------------------------
// Validates execution policy before any operation runs.  Policy failures
// are fatal — they happen BEFORE execution begins.  The default policy is
// fail-closed dry-run with mutation denied.

import type {
  ExecutionPolicy,
  ExecutionMode,
  ExecutorType,
  ExecutableDataPreparationIR,
  ExecutionWarning,
} from './models.js';
import { ExecutionEngineError, ExecutionErrorCode } from './errors.js';
import { ExecutionWarningCode } from './warnings.js';

/** Returns the default execution policy — dry-run, mutation denied. */
export function defaultPolicy(): ExecutionPolicy {
  return {
    mode: 'dry-run',
    allowMutation: false,
    allowedResourceIds: [],
    deniedResourceIds: [],
    allowedExecutorTypes: [
      'database', 'api', 'account', 'file',
      'configuration', 'state', 'value-generator', 'manual', 'fake',
    ],
    requireDryRunFirst: true,
    failFast: true,
    cleanupOnFailure: false,
    rollbackOnFailure: false,
  };
}

/** Merge partial overrides into a base policy. */
export function mergePolicy(
  base: ExecutionPolicy,
  overrides?: Partial<ExecutionPolicy>,
): ExecutionPolicy {
  if (!overrides) return { ...base };
  return { ...base, ...overrides };
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: ExecutionWarning[];
}

/**
 * PolicyEngine validates the execution plan against the policy before any
 * operation is executed.  Rejects mutation in dry-run, denied resources,
 * denied executor types, operation count above policy, and execute mode
 * without explicit mutation agreement.
 */
export class PolicyEngine {
  validate(
    ir: ExecutableDataPreparationIR,
    policy: ExecutionPolicy,
  ): PolicyValidationResult {
    const errors: ExecutionWarning[] = [];

    // Execute mode requires explicit mutation consent
    if (policy.mode === 'execute' && !policy.allowMutation) {
      errors.push({
        code: ExecutionWarningCode.DRY_RUN_ONLY,
        message: 'Execute mode requires allowMutation=true in policy',
      });
    }

    // Check operation count limit
    if (
      policy.maxOperations !== undefined &&
      ir.operations.length > policy.maxOperations
    ) {
      errors.push({
        code: ExecutionWarningCode.RESOURCE_BLOCKED,
        message: `Operation count ${ir.operations.length} exceeds policy limit ${policy.maxOperations}`,
      });
    }

    // Check each operation against policy
    for (const op of ir.operations) {
      // Resource denied
      if (op.resourceId && policy.deniedResourceIds.includes(op.resourceId)) {
        errors.push({
          code: ExecutionWarningCode.RESOURCE_BLOCKED,
          message: `Resource ${op.resourceId} is denied by policy`,
          operationId: op.id,
        });
      }

      // Resource not in allowlist (for execute mode)
      if (
        policy.mode === 'execute' &&
        policy.allowedResourceIds.length > 0 &&
        op.resourceId &&
        !policy.allowedResourceIds.includes(op.resourceId)
      ) {
        errors.push({
          code: ExecutionWarningCode.RESOURCE_BLOCKED,
          message: `Resource ${op.resourceId} is not in allowlist`,
          operationId: op.id,
        });
      }

      // Executor type denied
      const executorType = op.resolver as ExecutorType;
      if (
        policy.allowedExecutorTypes.length > 0 &&
        !policy.allowedExecutorTypes.includes(executorType)
      ) {
        errors.push({
          code: ExecutionWarningCode.EXECUTOR_NOT_FOUND,
          message: `Executor type ${executorType} is not allowed by policy`,
          operationId: op.id,
        });
      }

      // Mutation in dry-run
      if (policy.mode === 'dry-run' && isMutatingAction(op.action)) {
        errors.push({
          code: ExecutionWarningCode.DRY_RUN_ONLY,
          message: `Mutation action '${op.action}' not permitted in dry-run mode`,
          operationId: op.id,
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Determine whether an action would mutate state.  Used to enforce dry-run
 * restrictions — select/copy/generate/mock operations are read-only or
 * side-effect-free, while create/configure/restore mutate.
 */
function isMutatingAction(action: string): boolean {
  return ['create', 'configure', 'restore'].includes(action);
}

/**
 * Validate execute-mode double-gate (spec §50).  Requires ALL three:
 * mode=execute, policy.allowMutation=true, and explicit CLI acknowledgement.
 */
export function validateExecuteGate(
  mode: ExecutionMode,
  policy: ExecutionPolicy,
  cliAllowMutation: boolean,
): void {
  if (mode !== 'execute') return;

  if (!policy.allowMutation) {
    throw new ExecutionEngineError(
      ExecutionErrorCode.POLICY_FAILURE,
      'Execute mode requires policy.allowMutation=true',
    );
  }

  if (!cliAllowMutation) {
    throw new ExecutionEngineError(
      ExecutionErrorCode.POLICY_FAILURE,
      'Execute mode requires --allow-mutation CLI flag',
    );
  }
}
