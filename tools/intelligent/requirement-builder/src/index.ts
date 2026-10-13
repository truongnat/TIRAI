// ---------------------------------------------------------------------------
// Requirement Builder – public API (type shell)
// ---------------------------------------------------------------------------
// TIRAI is a pure tool: requirement building is supplied by the host agent.
// This package retains the canonical Requirement IR model only.

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
  RequirementWarning,
  RequirementDocument,
  ProvenanceReference,
  SemanticIRInput,
} from './models.js';
