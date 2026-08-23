// ---------------------------------------------------------------------------
// Test Planner – error codes
// ---------------------------------------------------------------------------

export const TestPlannerErrorCode = {
  INPUT_NOT_FOUND: 'TEST_INPUT_NOT_FOUND',
  INVALID_REQUIREMENT_IR: 'TEST_INVALID_REQUIREMENT_IR',
  PROVIDER_FAILURE: 'TEST_PROVIDER_FAILURE',
  SCHEMA_FAILURE: 'TEST_SCHEMA_FAILURE',
  TRACEABILITY_FAILURE: 'TEST_TRACEABILITY_FAILURE',
  CONSOLIDATION_FAILURE: 'TEST_CONSOLIDATION_FAILURE',
} as const;

export type TestPlannerErrorCodeKey = (typeof TestPlannerErrorCode)[keyof typeof TestPlannerErrorCode];

export class TestPlannerError extends Error {
  public readonly code: TestPlannerErrorCodeKey;
  public override readonly cause?: unknown;

  constructor(code: TestPlannerErrorCodeKey, message: string, cause?: unknown) {
    super(message);
    this.name = 'TestPlannerError';
    this.code = code;
    this.cause = cause;
  }
}
