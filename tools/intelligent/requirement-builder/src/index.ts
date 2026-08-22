// ---------------------------------------------------------------------------
// Requirement Builder – public API
// ---------------------------------------------------------------------------

export { buildRequirements } from './builder.js';
export { REQUIREMENT_PROMPT_VERSION } from './prompts/system.js';
export { RequirementBuilderError, RequirementErrorCode } from './errors.js';
export { RequirementWarningCode, CONFIDENCE_THRESHOLD } from './warnings.js';
export { computeFingerprint } from './fingerprint.js';

export type {
  RequirementIR,
  Requirement,
  RequirementType,
  RequirementSourceNature,
  RequirementCondition,
  RequirementInput,
  RequirementBehavior,
  RequirementOutcome,
  RequirementConstraint,
  RequirementTestability,
  RequirementUnresolved,
  RequirementConflict,
  RequirementQualityMetrics,
  RequirementCandidate,
  RequirementWarning,
  RequirementManifest,
  RequirementBuilderOptions,
  RequirementDocument,
  ProvenanceReference,
  SemanticIRInput,
} from './models.js';
