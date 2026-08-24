// ---------------------------------------------------------------------------
// Semantic Analyzer – warning codes
// ---------------------------------------------------------------------------

export const SemanticWarningCode = {
  LOW_CONFIDENCE: 'SEMANTIC_LOW_CONFIDENCE',
  INVALID_PROVENANCE: 'SEMANTIC_INVALID_PROVENANCE',
  DUPLICATE_CANDIDATE: 'SEMANTIC_DUPLICATE_CANDIDATE',
  RELATIONSHIP_UNRESOLVED: 'SEMANTIC_RELATIONSHIP_UNRESOLVED',
  CONSOLIDATION_PARTIAL: 'SEMANTIC_CONSOLIDATION_PARTIAL',
  REPAIR_APPLIED: 'SEMANTIC_REPAIR_APPLIED',
  CONTEXT_SKIPPED: 'SEMANTIC_CONTEXT_SKIPPED',
  UNSUPPORTED_CONTENT: 'SEMANTIC_UNSUPPORTED_CONTENT',
  OUTPUT_BUDGET_ESCALATION: 'SEMANTIC_OUTPUT_BUDGET_ESCALATION',
} as const;

export type SemanticWarningCodeKey =
  (typeof SemanticWarningCode)[keyof typeof SemanticWarningCode];

/** Confidence thresholds used for warning classification. */
export const CONFIDENCE_THRESHOLD = {
  HIGH: 0.8,
  MEDIUM: 0.5,
} as const;
