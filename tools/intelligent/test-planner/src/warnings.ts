// ---------------------------------------------------------------------------
// Test Planner – warning codes
// ---------------------------------------------------------------------------

export const TestPlannerWarningCode = {
  REQUIREMENT_NOT_COVERED: 'TEST_REQUIREMENT_NOT_COVERED',
  REQUIREMENT_PARTIAL_COVERAGE: 'TEST_REQUIREMENT_PARTIAL_COVERAGE',
  CASE_LOW_CONFIDENCE: 'TEST_CASE_LOW_CONFIDENCE',
  CASE_INVALID_PROVENANCE: 'TEST_CASE_INVALID_PROVENANCE',
  CASE_DANGLING_REQUIREMENT: 'TEST_CASE_DANGLING_REQUIREMENT',
  CASE_DUPLICATE: 'TEST_CASE_DUPLICATE',
  CASE_NON_ATOMIC: 'TEST_CASE_NON_ATOMIC',
  EXPECTATION_UNSPECIFIED: 'TEST_EXPECTATION_UNSPECIFIED',
  DATA_UNRESOLVED: 'TEST_DATA_UNRESOLVED',
  REPAIR_APPLIED: 'TEST_REPAIR_APPLIED',
} as const;

export type TestPlannerWarningCodeKey =
  (typeof TestPlannerWarningCode)[keyof typeof TestPlannerWarningCode];

/** Confidence thresholds used for warning classification. */
export const TEST_CONFIDENCE_THRESHOLD = {
  HIGH: 0.8,
  MEDIUM: 0.5,
} as const;
