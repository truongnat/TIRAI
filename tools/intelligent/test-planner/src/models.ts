// ---------------------------------------------------------------------------
// Test Planner – canonical data model
// ---------------------------------------------------------------------------
// Transforms Requirement IR into a grounded, traceable Test Plan IR / Test
// Case IR.  Executor-independent: describes WHAT to verify, not HOW.

// ---- Reusable provenance (matches Requirement IR / Semantic IR model) -----

export interface ProvenanceReference {
  contextId: string;
  sheet?: string;
  ranges?: string[];
  cells?: string[];
}

// ---- Top-level Test Plan IR -----------------------------------------------

export interface TestPlanIR {
  schemaVersion: '1.0';
  scope: TestScope;
  requirementCoverage: RequirementCoverage[];
  scenarios: TestScenario[];
  testCases: TestCase[];
  dataNeeds: TestDataNeed[];
  unresolved: TestPlanningUnresolved[];
  quality: TestPlanQualityMetrics;
  warnings?: TestPlannerWarning[];
}

// ---- Test scope -----------------------------------------------------------

export interface TestScope {
  requirementIds: string[];
  objective: string;
  assumptions: string[];
  exclusions: string[];
}

// ---- Requirement coverage -------------------------------------------------

export type CoverageStrategy =
  | 'positive'
  | 'negative'
  | 'boundary'
  | 'validation'
  | 'state-transition'
  | 'error-handling'
  | 'interface'
  | 'data'
  | 'security'
  | 'other';

export type CoverageStatus = 'covered' | 'partially-covered' | 'not-covered';

export interface RequirementCoverage {
  requirementId: string;
  strategies: CoverageStrategy[];
  scenarioIds: string[];
  status: CoverageStatus;
  reasons: string[];
}

// ---- Test scenario --------------------------------------------------------

export type TestScenarioCategory =
  | 'happy-path'
  | 'negative'
  | 'validation'
  | 'boundary'
  | 'error-handling'
  | 'state-transition'
  | 'data-integrity'
  | 'interface'
  | 'security'
  | 'compatibility'
  | 'other';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface TestScenario {
  id: string;
  title: string;
  objective: string;
  category: TestScenarioCategory;
  requirementIds: string[];
  preconditions: TestPrecondition[];
  dataNeeds: TestDataNeed[];
  expectedBehavior: string[];
  priority: Priority;
  provenance: TestProvenance[];
  confidence: number;
  /** Content-addressable hash of the scenario's canonical form for cross-revision comparison. */
  contentHash?: string;
}

// ---- Test case ------------------------------------------------------------

export type TestCaseType = 'ui' | 'api' | 'database' | 'integration' | 'manual' | 'unknown';

export type VerificationType = 'ui' | 'api' | 'database' | 'state' | 'log' | 'other';

export type VerificationIntentKind =
  | 'visible-ui-state'
  | 'persisted-business-state'
  | 'api-response'
  | 'entity-exists'
  | 'entity-absent'
  | 'value-equals'
  | 'numeric-delta'
  | 'semantic';

export type VerificationAuthorityIntent =
  | 'VISIBLE_UI_STATE'
  | 'PERSISTED_BUSINESS_STATE'
  | 'API_RESPONSE'
  | 'ENTITY_EXISTENCE'
  | 'ENTITY_ABSENCE';

export interface VerificationIntent {
  kind: VerificationIntentKind;
  subject?: string;
  property?: string;
  expectedValue?: string | number | boolean;
  authority?: VerificationAuthorityIntent;
  requiredSources?: Array<'UI' | 'API' | 'DATABASE'>;
}

export type ValueStrategy =
  'fixed' | 'valid' | 'invalid' | 'boundary' | 'generated' | 'existing-data' | 'unknown';

export type DataNeedType =
  | 'input'
  | 'database-record'
  | 'account'
  | 'state'
  | 'external-response'
  | 'file'
  | 'configuration'
  | 'other';

export type AutomationStatus = 'ready' | 'partially-ready' | 'manual-only' | 'unknown';

export type SuggestedExecutor = 'ui' | 'api' | 'database' | 'hybrid';

export type UnresolvedReason =
  | 'missing-expected-result'
  | 'missing-input-constraint'
  | 'missing-error-behavior'
  | 'ambiguous-requirement'
  | 'not-testable'
  | 'other';

export interface TestCase {
  id: string;
  scenarioId: string;
  requirementIds: string[];
  title: string;
  objective: string;
  type: TestCaseType;
  priority: Priority;
  preconditions: TestPrecondition[];
  inputs: TestInput[];
  dataNeeds: TestDataNeed[];
  steps: TestStep[];
  expectedResults: ExpectedResult[];
  cleanup: TestCleanup[];
  automation: AutomationReadiness;
  provenance: TestProvenance[];
  confidence: number;
  /** Content-addressable hash of the test case's canonical form for cross-revision comparison. */
  contentHash?: string;
}

// ---- Sub-models -----------------------------------------------------------

export interface TestStep {
  order: number;
  action: string;
  target?: string;
  input?: string;
  expectedIntermediateResult?: string;
}

export interface ExpectedResult {
  description: string;
  verificationType: VerificationType;
  target?: string;
  verificationIntent?: VerificationIntent;
}

export interface TestPrecondition {
  description: string;
  sourceRequirementIds: string[];
}

export interface TestInput {
  name: string;
  valueStrategy: ValueStrategy;
  value?: unknown;
  description?: string;
}

export interface TestDataNeed {
  id: string;
  description: string;
  type: DataNeedType;
  constraints: string[];
  relatedRequirementIds: string[];
  relatedEntityIds?: string[];
  sourceScenarioId?: string;
  provenance?: TestProvenance[];
}

export interface TestCleanup {
  description: string;
  target?: string;
}

export interface AutomationReadiness {
  status: AutomationStatus;
  suggestedExecutor?: SuggestedExecutor;
  reasons: string[];
}

export interface TestProvenance {
  requirementId: string;
  contextId?: string;
  sheet?: string;
  ranges?: string[];
  cells?: string[];
}

// ---- Unresolved -----------------------------------------------------------

export interface TestPlanningUnresolved {
  id: string;
  requirementIds: string[];
  description: string;
  reason: UnresolvedReason;
  provenance: TestProvenance[];
}

// ---- Quality metrics ------------------------------------------------------

export interface TestPlanQualityMetrics {
  requirementsTotal: number;
  requirementsCovered: number;
  requirementsPartiallyCovered: number;
  requirementsNotCovered: number;
  coverageRate: number;
  scenarios: number;
  testCases: number;
  positiveCases: number;
  negativeCases: number;
  boundaryCases: number;
  validationCases: number;
  unresolved: number;
  automationReady: number;
  provenanceCoverage: number;
}

// ---- AI candidate models (intermediate) -----------------------------------

export interface CoverageCandidate {
  requirementId: string;
  strategies: CoverageStrategy[];
  reasons: string[];
  confidence: number;
}

export interface ScenarioCandidate {
  temporaryId: string;
  title: string;
  objective: string;
  category: TestScenarioCategory;
  requirementIds: string[];
  preconditions: Array<{ description: string; sourceRequirementIds: string[] }>;
  dataNeeds: Array<{
    description: string;
    type: DataNeedType;
    constraints: string[];
    relatedRequirementIds: string[];
    sourceScenarioId?: string;
    provenance?: TestProvenance[];
  }>;
  expectedBehavior: string[];
  priority: Priority;
  provenance: TestProvenance[];
  confidence: number;
}

export interface TestCaseCandidate {
  temporaryId: string;
  scenarioTemporaryId: string;
  requirementIds: string[];
  title: string;
  objective: string;
  type: TestCaseType;
  priority: Priority;
  preconditions: Array<{ description: string; sourceRequirementIds: string[] }>;
  inputs: Array<{
    name: string;
    valueStrategy: ValueStrategy;
    value?: unknown;
    description?: string;
  }>;
  dataNeeds: Array<{
    description: string;
    type: DataNeedType;
    constraints: string[];
    relatedRequirementIds: string[];
    sourceScenarioId?: string;
    provenance?: TestProvenance[];
  }>;
  steps: Array<{
    order: number;
    action: string;
    target?: string;
    input?: string;
    expectedIntermediateResult?: string;
  }>;
  expectedResults: Array<{
    description: string;
    verificationType: VerificationType;
    target?: string;
    verificationIntent?: VerificationIntent;
  }>;
  cleanup: Array<{ description: string; target?: string }>;
  automation: {
    status: AutomationStatus;
    suggestedExecutor?: SuggestedExecutor;
    reasons: string[];
  };
  provenance: TestProvenance[];
  confidence: number;
}

export interface CoverageAnalysisResult {
  coverageCandidates: CoverageCandidate[];
  unresolvedCandidates: Array<{
    requirementId: string;
    description: string;
    reason: UnresolvedReason;
    provenance: TestProvenance[];
  }>;
}

export interface ScenarioExtractionResult {
  scenarios: ScenarioCandidate[];
}

export interface TestCaseExtractionResult {
  testCases: TestCaseCandidate[];
  additionalDataNeeds: Array<{
    description: string;
    type: DataNeedType;
    constraints: string[];
    relatedRequirementIds: string[];
  }>;
  warnings?: TestPlannerWarning[];
}

// ---- Builder options ------------------------------------------------------

export interface TestPlannerOptions {
  outputDir?: string;
  resume?: boolean;
  promptVersion?: string;
  maxRepairAttempts?: number;
  /** Optional acceptance policy; comprehensive remains the production default. */
  coverageMode?: 'comprehensive' | 'minimal-sufficient';
}

// ---- Manifest -------------------------------------------------------------

export interface TestPlannerManifest {
  schemaVersion: '1.0';
  source: {
    requirementIR: string;
  };
  provider: {
    name: string;
    model: string;
  };
  promptVersion: string;
  stats: {
    requirements: number;
    scenarios: number;
    testCases: number;
    dataNeeds: number;
    unresolved: number;
    coverageRate: number;
  };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  fingerprint: string;
  warnings: TestPlannerWarning[];
}

// ---- Warning model --------------------------------------------------------

export interface TestPlannerWarning {
  code: string;
  message: string;
  requirementId?: string;
  scenarioId?: string;
  testCaseId?: string;
}

// ---- Requirement IR input types (minimal, for loading) --------------------
// These mirror the Requirement Builder output so we can load it without
// creating a circular dependency.

export interface RequirementIRInput {
  schemaVersion: string;
  document: {
    title?: string;
    summary?: string;
    sourceSemanticIR?: string;
    provenance: ProvenanceReference[];
  };
  requirements: Array<{
    id: string;
    title: string;
    type: string;
    statement: string;
    sourceNature: string;
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
    relatedSemanticIds: string[];
    provenance: ProvenanceReference[];
    confidence: number;
    testability: { status: string; reasons: string[] };
  }>;
  unresolved: Array<{
    id: string;
    description: string;
    reason: string;
    semanticEvidenceIds: string[];
    provenance: ProvenanceReference[];
    candidates?: string[];
  }>;
  conflicts: Array<{
    id: string;
    requirementIds: string[];
    description: string;
    type: string;
    provenance: ProvenanceReference[];
    confidence: number;
  }>;
  quality: {
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
  };
}
