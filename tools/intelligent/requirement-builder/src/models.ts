// ---------------------------------------------------------------------------
// Requirement IR – canonical data model
// ---------------------------------------------------------------------------
// Source-independent, provider-independent, test-planning-ready.
// Consumes Semantic IR and produces structured, atomic, traceable requirements.

// ---- Reusable provenance (matches Semantic IR model) ----------------------

export interface ProvenanceReference {
  contextId: string;
  sheet?: string;
  ranges?: string[];
  cells?: string[];
}

// ---- Top-level Requirement IR --------------------------------------------

export interface RequirementIR {
  schemaVersion: '1.0';
  document: RequirementDocument;
  requirements: Requirement[];
  unresolved: RequirementUnresolved[];
  conflicts: RequirementConflict[];
  quality: RequirementQualityMetrics;
}

// ---- Document ------------------------------------------------------------

export interface RequirementDocument {
  title?: string;
  summary?: string;
  sourceSemanticIR?: string;
  provenance: ProvenanceReference[];
}

// ---- Requirement ---------------------------------------------------------

export interface Requirement {
  id: string;
  title: string;
  type: RequirementType;
  statement: string;
  sourceNature: RequirementSourceNature;
  actor?: string;
  trigger?: string;
  preconditions: RequirementCondition[];
  inputs: RequirementInput[];
  dataNeeds: RequirementDataNeed[];
  expectedBehaviors: RequirementBehavior[];
  outcomes: RequirementOutcome[];
  constraints: RequirementConstraint[];
  relatedSemanticIds: string[];
  provenance: ProvenanceReference[];
  confidence: number;
  testability: RequirementTestability;
}

export interface RequirementDataNeed {
  description: string;
  type?: string;
  constraints?: string[];
  provenance: ProvenanceReference[];
}

// ---- Requirement type taxonomy -------------------------------------------

export type RequirementType =
  | 'functional'
  | 'validation'
  | 'business-rule'
  | 'data'
  | 'interface'
  | 'security'
  | 'state-transition'
  | 'non-functional'
  | 'technical-constraint'
  | 'unknown';

// ---- Source nature -------------------------------------------------------

export type RequirementSourceNature = 'explicit' | 'derived' | 'ambiguous';

// ---- Sub-models ----------------------------------------------------------

export interface RequirementCondition {
  description: string;
  relatedSemanticIds?: string[];
  provenance: ProvenanceReference[];
}

export interface RequirementInput {
  name: string;
  description?: string;
  dataType?: string;
  required?: boolean;
  constraints?: string[];
  relatedSemanticId?: string;
  provenance: ProvenanceReference[];
}

export interface RequirementBehavior {
  description: string;
  condition?: string;
  target?: string;
  provenance: ProvenanceReference[];
}

export interface RequirementOutcome {
  condition?: string;
  description: string;
  state?: string;
  provenance: ProvenanceReference[];
}

export interface RequirementConstraint {
  type: string;
  description: string;
  value?: unknown;
  provenance: ProvenanceReference[];
}

export interface RequirementTestability {
  status: 'testable' | 'partially-testable' | 'not-testable' | 'unknown';
  reasons: string[];
}

// ---- Unresolved ----------------------------------------------------------

export interface RequirementUnresolved {
  id: string;
  description: string;
  reason: string;
  semanticEvidenceIds: string[];
  provenance: ProvenanceReference[];
  candidates?: string[];
}

// ---- Conflict ------------------------------------------------------------

export interface RequirementConflict {
  id: string;
  requirementIds: string[];
  description: string;
  type: 'contradiction' | 'inconsistent-constraint' | 'ambiguous' | 'potential-overlap';
  provenance: ProvenanceReference[];
  confidence: number;
}

// ---- Quality metrics -----------------------------------------------------

export interface RequirementQualityMetrics {
  total: number;
  explicit: number;
  derived: number;
  testable: number;
  partiallyTestable: number;
  notTestable: number;
  unknownTestability: number;
  lowConfidence: number;
  unresolved: number;
  conflicts: number;
  provenanceCoverage: number;
}

// ---- Requirement candidate (intermediate layer) --------------------------

export interface RequirementCandidate {
  temporaryId: string;
  title: string;
  type: RequirementType;
  statement: string;
  sourceNature: RequirementSourceNature;
  semanticEvidenceIds: string[];
  actor?: string;
  trigger?: string;
  preconditions: RequirementCondition[];
  inputs: RequirementInput[];
  dataNeeds: RequirementDataNeed[];
  expectedBehaviors: RequirementBehavior[];
  outcomes: RequirementOutcome[];
  constraints: RequirementConstraint[];
  provenance: ProvenanceReference[];
  confidence: number;
  rationale?: string;
}

// ---- Candidate extraction result (AI response) ---------------------------

export interface CandidateExtractionResult {
  candidates: RawCandidate[];
  unresolvedCandidates: RawUnresolvedCandidate[];
  conflictCandidates: RawConflictCandidate[];
}

export interface RawCandidate {
  temporaryId: string;
  title: string;
  type: string;
  statement: string;
  sourceNature: string;
  semanticEvidenceIds: string[];
  actor?: string;
  trigger?: string;
  preconditions: Array<{
    description: string;
    relatedSemanticIds?: string[];
    provenance: ProvenanceReference[];
  }>;
  inputs: Array<{
    name: string;
    description?: string;
    dataType?: string;
    required?: boolean;
    constraints?: string[];
    relatedSemanticId?: string;
    provenance: ProvenanceReference[];
  }>;
  dataNeeds?: Array<{
    description: string;
    type?: string;
    constraints?: string[];
    provenance: ProvenanceReference[];
  }>;
  expectedBehaviors: Array<{
    description: string;
    condition?: string;
    target?: string;
    provenance: ProvenanceReference[];
  }>;
  outcomes: Array<{
    condition?: string;
    description: string;
    state?: string;
    provenance: ProvenanceReference[];
  }>;
  constraints: Array<{
    type: string;
    description: string;
    value?: unknown;
    provenance: ProvenanceReference[];
  }>;
  provenance: ProvenanceReference[];
  confidence: number;
  rationale?: string;
}

export interface RawUnresolvedCandidate {
  temporaryId: string;
  description: string;
  reason: string;
  semanticEvidenceIds: string[];
  provenance: ProvenanceReference[];
  candidates?: string[];
}

export interface RawConflictCandidate {
  temporaryId: string;
  requirementTemporaryIds: string[];
  description: string;
  type: string;
  provenance: ProvenanceReference[];
  confidence: number;
}

// ---- Consolidation result (Pass 2 AI response) ---------------------------

export interface RequirementConsolidationResult {
  duplicateGroups: Array<{
    sourceTemporaryIds: string[];
    reason: string;
    confidence: number;
  }>;
  additionalConflicts: Array<{
    requirementTemporaryIds: string[];
    description: string;
    type: string;
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
}

// ---- Builder options -----------------------------------------------------

export interface RequirementBuilderOptions {
  /** Output directory for intermediate analysis files. */
  outputDir?: string;
  /** Resume from existing intermediate results. */
  resume?: boolean;
  /** Prompt version override. */
  promptVersion?: string;
  /** Maximum repair attempts (default: 1). */
  maxRepairAttempts?: number;
}

// ---- Analysis manifest ---------------------------------------------------

export interface RequirementManifest {
  schemaVersion: '1.0';
  source: {
    semanticIR: string;
  };
  provider: {
    name: string;
    model: string;
  };
  promptVersion: string;
  stats: {
    requirements: number;
    explicit: number;
    derived: number;
    unresolved: number;
    conflicts: number;
  };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  warnings: RequirementWarning[];
}

// ---- Warning model -------------------------------------------------------

export interface RequirementWarning {
  code: string;
  message: string;
  requirementId?: string;
  contextId?: string;
}

// ---- Semantic IR input types (minimal, for loading) ----------------------
// These mirror the Semantic Analyzer output so we can load it without
// creating a circular dependency.

export interface SemanticIRInput {
  schemaVersion: string;
  /** Pipeline completion status. Only 'complete' is accepted by downstream. */
  status?: 'complete' | 'partial' | 'failed';
  document: {
    title?: string;
    summary?: string;
    language?: string[];
    domainHints?: string[];
    provenance: ProvenanceReference[];
  };
  sections: Array<{
    id: string;
    title: string;
    description?: string;
    type?: string;
    parentId?: string;
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
  entities: Array<{
    id: string;
    name: string;
    type: string;
    description?: string;
    attributes?: Array<{
      name: string;
      value?: unknown;
      dataType?: string;
      description?: string;
      provenance?: ProvenanceReference[];
    }>;
    aliases?: string[];
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
  flows: Array<{
    id: string;
    name: string;
    description?: string;
    actors?: string[];
    steps: Array<{
      order: number;
      action: string;
      actor?: string;
      target?: string;
      condition?: string;
      outcome?: string;
      provenance: ProvenanceReference[];
    }>;
    preconditions?: string[];
    postconditions?: string[];
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
  rules: Array<{
    id: string;
    type: string;
    statement: string;
    conditions?: Array<{
      expression: string;
      operands?: string[];
      provenance?: ProvenanceReference[];
    }>;
    effects?: Array<{
      description: string;
      target?: string;
      value?: unknown;
      provenance?: ProvenanceReference[];
    }>;
    relatedEntityIds?: string[];
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
  relationships: Array<{
    id: string;
    type: string;
    sourceId: string;
    targetId: string;
    description?: string;
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
  unresolved: Array<{
    id: string;
    type: string;
    description: string;
    candidates?: string[];
    provenance: ProvenanceReference[];
    reason: string;
  }>;
  analysis: {
    provider: string;
    model: string;
    promptVersion: string;
    chunksAnalyzed: number;
    aiRequests: number;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    warnings: Array<{ code: string; message: string; contextId?: string; objectId?: string }>;
    quality?: {
      entities: number;
      flows: number;
      flowSteps: number;
      rules: number;
      relationships: number;
      unresolved: number;
      lowConfidenceCount: number;
      provenanceCoverage: number;
    };
  };
}
