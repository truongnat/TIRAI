// ---------------------------------------------------------------------------
// Test Data Planner – warning codes
// ---------------------------------------------------------------------------

export const TestDataPlannerWarningCode = {
  MISSING_CONSTRAINT: 'DATA_MISSING_CONSTRAINT',
  UNKNOWN_STRATEGY: 'DATA_UNKNOWN_STRATEGY',
  INVALID_REFERENCE: 'DATA_INVALID_REFERENCE',
  DUPLICATE_CANDIDATE: 'DATA_DUPLICATE_CANDIDATE',
  DEPENDENCY_CYCLE: 'DATA_DEPENDENCY_CYCLE',
  UNSAFE_REUSE: 'DATA_UNSAFE_REUSE',
  MISSING_PROVENANCE: 'DATA_MISSING_PROVENANCE',
  REPAIR_APPLIED: 'DATA_REPAIR_APPLIED',
  PARTIAL_PLAN: 'DATA_PARTIAL_PLAN',
} as const;

export type TestDataPlannerWarningCodeKey =
  (typeof TestDataPlannerWarningCode)[keyof typeof TestDataPlannerWarningCode];

/** Confidence thresholds used for warning classification. */
export const DATA_CONFIDENCE_THRESHOLD = {
  HIGH: 0.8,
  MEDIUM: 0.5,
} as const;
