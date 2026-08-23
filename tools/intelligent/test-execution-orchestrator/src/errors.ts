// Test Execution Orchestrator v1 — Error codes and error class.

export const TestErrorCode = {
  TEST_PREPARATION_FAILED: 'TEST_PREPARATION_FAILED',
  TEST_EXECUTOR_NOT_FOUND: 'TEST_EXECUTOR_NOT_FOUND',
  TEST_EXECUTOR_VALIDATION_FAILED: 'TEST_EXECUTOR_VALIDATION_FAILED',
  TEST_EXECUTOR_ERROR: 'TEST_EXECUTOR_ERROR',
  TEST_ASSERTION_FAILED: 'TEST_ASSERTION_FAILED',
  TEST_ASSERTION_UNVERIFIABLE: 'TEST_ASSERTION_UNVERIFIABLE',
  TEST_BINDING_MISSING: 'TEST_BINDING_MISSING',
  TEST_EVIDENCE_FAILED: 'TEST_EVIDENCE_FAILED',
  TEST_CLEANUP_FAILED: 'TEST_CLEANUP_FAILED',
  TEST_TIMEOUT: 'TEST_TIMEOUT',
  TEST_INTERNAL_ERROR: 'TEST_INTERNAL_ERROR',
  TEST_INVALID_INPUT: 'TEST_INVALID_INPUT',
  TEST_DENIED_BY_POLICY: 'TEST_DENIED_BY_POLICY',
} as const;

export type TestErrorCodeType = typeof TestErrorCode[keyof typeof TestErrorCode];

export class TestExecutionOrchestratorError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly testCaseId?: string;

  constructor(
    code: string,
    message: string,
    options?: { retryable?: boolean; testCaseId?: string },
  ) {
    super(message);
    this.name = 'TestExecutionOrchestratorError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.testCaseId = options?.testCaseId;
  }
}
