// ---------------------------------------------------------------------------
// Test Data Planner – error codes
// ---------------------------------------------------------------------------

export const TestDataPlannerErrorCode = {
  INPUT_NOT_FOUND: 'DATA_INPUT_NOT_FOUND',
  INVALID_TEST_CASE_IR: 'DATA_INVALID_TEST_CASE_IR',
  SCHEMA_FAILURE: 'DATA_SCHEMA_FAILURE',
  PROVIDER_FAILURE: 'DATA_PROVIDER_FAILURE',
  TRACEABILITY_FAILURE: 'DATA_TRACEABILITY_FAILURE',
  CONSOLIDATION_FAILURE: 'DATA_CONSOLIDATION_FAILURE',
} as const;

export type TestDataPlannerErrorCodeKey = (typeof TestDataPlannerErrorCode)[keyof typeof TestDataPlannerErrorCode];

export class TestDataPlannerError extends Error {
  public readonly code: TestDataPlannerErrorCodeKey;
  public override readonly cause?: unknown;

  constructor(code: TestDataPlannerErrorCodeKey, message: string, cause?: unknown) {
    super(message);
    this.name = 'TestDataPlannerError';
    this.code = code;
    this.cause = cause;
  }
}
