// ---------------------------------------------------------------------------
// Execution Engine – error codes
// ---------------------------------------------------------------------------

export const ExecutionErrorCode = {
  INVALID_IR: 'EXECUTION_INVALID_IR',
  POLICY_FAILURE: 'EXECUTION_POLICY_FAILURE',
  CYCLE_DETECTED: 'EXECUTION_CYCLE_DETECTED',
  EXECUTOR_NOT_FOUND: 'EXECUTION_EXECUTOR_NOT_FOUND',
  SECRET_RESOLUTION_FAILURE: 'EXECUTION_SECRET_RESOLUTION_FAILURE',
  INTERNAL_ERROR: 'EXECUTION_INTERNAL_ERROR',
} as const;

export type ExecutionErrorCodeKey =
  (typeof ExecutionErrorCode)[keyof typeof ExecutionErrorCode];

export class ExecutionEngineError extends Error {
  public readonly code: ExecutionErrorCodeKey;
  public override readonly cause?: unknown;

  constructor(code: ExecutionErrorCodeKey, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExecutionEngineError';
    this.code = code;
    this.cause = cause;
  }
}
