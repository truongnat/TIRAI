// ---------------------------------------------------------------------------
// Execution Engine – warning codes
// ---------------------------------------------------------------------------

export const ExecutionWarningCode = {
  MANUAL_OPERATION: 'EXECUTION_MANUAL_OPERATION',
  UNRESOLVED_BINDING: 'EXECUTION_UNRESOLVED_BINDING',
  RESOURCE_BLOCKED: 'EXECUTION_RESOURCE_BLOCKED',
  RETRY_APPLIED: 'EXECUTION_RETRY_APPLIED',
  CLEANUP_FAILED: 'EXECUTION_CLEANUP_FAILED',
  ROLLBACK_FAILED: 'EXECUTION_ROLLBACK_FAILED',
  OPERATION_SKIPPED: 'EXECUTION_OPERATION_SKIPPED',
  DRY_RUN_ONLY: 'EXECUTION_DRY_RUN_ONLY',
  EXECUTOR_NOT_FOUND: 'EXECUTION_EXECUTOR_NOT_FOUND',
  BINDING_MISSING: 'EXECUTION_BINDING_MISSING',
} as const;

export type ExecutionWarningCodeKey =
  (typeof ExecutionWarningCode)[keyof typeof ExecutionWarningCode];
