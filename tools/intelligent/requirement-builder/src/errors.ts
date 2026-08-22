// ---------------------------------------------------------------------------
// Requirement Builder – error codes
// ---------------------------------------------------------------------------

export const RequirementErrorCode = {
  INPUT_NOT_FOUND: 'REQUIREMENT_INPUT_NOT_FOUND',
  INVALID_SEMANTIC_IR: 'REQUIREMENT_INVALID_SEMANTIC_IR',
  PROVIDER_FAILURE: 'REQUIREMENT_PROVIDER_FAILURE',
  SCHEMA_FAILURE: 'REQUIREMENT_SCHEMA_FAILURE',
  PROVENANCE_FAILURE: 'REQUIREMENT_PROVENANCE_FAILURE',
  CONSOLIDATION_FAILURE: 'REQUIREMENT_CONSOLIDATION_FAILURE',
} as const;

export type RequirementErrorCodeKey = (typeof RequirementErrorCode)[keyof typeof RequirementErrorCode];

export class RequirementBuilderError extends Error {
  public readonly code: RequirementErrorCodeKey;
  public override readonly cause?: unknown;

  constructor(code: RequirementErrorCodeKey, message: string, cause?: unknown) {
    super(message);
    this.name = 'RequirementBuilderError';
    this.code = code;
    this.cause = cause;
  }
}
