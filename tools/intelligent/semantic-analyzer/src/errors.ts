// ---------------------------------------------------------------------------
// Semantic Analyzer – error codes
// ---------------------------------------------------------------------------

export const SemanticErrorCode = {
  INPUT_NOT_FOUND: 'SEMANTIC_INPUT_NOT_FOUND',
  INVALID_CONTEXT: 'SEMANTIC_INVALID_CONTEXT',
  PROVIDER_FAILURE: 'SEMANTIC_PROVIDER_FAILURE',
  SCHEMA_FAILURE: 'SEMANTIC_SCHEMA_FAILURE',
  PROVENANCE_FAILURE: 'SEMANTIC_PROVENANCE_FAILURE',
  CONSOLIDATION_FAILURE: 'SEMANTIC_CONSOLIDATION_FAILURE',
} as const;

export type SemanticErrorCodeKey = (typeof SemanticErrorCode)[keyof typeof SemanticErrorCode];

export class SemanticAnalyzerError extends Error {
  public readonly code: SemanticErrorCodeKey;
  public override readonly cause?: unknown;

  constructor(code: SemanticErrorCodeKey, message: string, cause?: unknown) {
    super(message);
    this.name = 'SemanticAnalyzerError';
    this.code = code;
    this.cause = cause;
  }
}
