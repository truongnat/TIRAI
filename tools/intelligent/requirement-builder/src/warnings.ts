// ---------------------------------------------------------------------------
// Requirement Builder – warning codes
// ---------------------------------------------------------------------------

export const RequirementWarningCode = {
  LOW_CONFIDENCE: 'REQUIREMENT_LOW_CONFIDENCE',
  INVALID_PROVENANCE: 'REQUIREMENT_INVALID_PROVENANCE',
  DANGLING_SEMANTIC_REF: 'REQUIREMENT_DANGLING_SEMANTIC_REF',
  DUPLICATE_CANDIDATE: 'REQUIREMENT_DUPLICATE_CANDIDATE',
  NON_ATOMIC: 'REQUIREMENT_NON_ATOMIC',
  ENTITY_LIKE: 'REQUIREMENT_ENTITY_LIKE',
  NOT_TESTABLE: 'REQUIREMENT_NOT_TESTABLE',
  REPAIR_APPLIED: 'REQUIREMENT_REPAIR_APPLIED',
  CONFLICT_DETECTED: 'REQUIREMENT_CONFLICT_DETECTED',
  PARTIAL_EXTRACTION: 'REQUIREMENT_PARTIAL_EXTRACTION',
} as const;

export type RequirementWarningCodeKey =
  (typeof RequirementWarningCode)[keyof typeof RequirementWarningCode];

/** Confidence thresholds used for warning classification. */
export const CONFIDENCE_THRESHOLD = {
  HIGH: 0.8,
  MEDIUM: 0.5,
} as const;
