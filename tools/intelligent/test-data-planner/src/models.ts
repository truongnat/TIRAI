// ---------------------------------------------------------------------------
// Test Data Planner – canonical data model
// ---------------------------------------------------------------------------
// Transforms Test Case IR + Test Data Needs into a grounded, traceable
// Test Data Plan IR.  Executor-independent: describes WHAT data is required,
// not HOW to create or mutate it.

// ---- Reusable provenance (matches Test Planner / Requirement IR model) -----

export interface TestProvenance {
  requirementId: string;
  contextId?: string;
  sheet?: string;
  ranges?: string[];
}

// ---- Top-level Test Data Plan IR ------------------------------------------

export interface TestDataPlanIR {
  schemaVersion: '1.0';
  testCases: TestCaseDataPlan[];
  dataItems: TestDataItem[];
  dependencyGraph: DataDependency[];
  reusableSets: ReusableDataSet[];
  unresolved: TestDataUnresolved[];
  quality: TestDataQualityMetrics;
}

// ---- Test case data plan --------------------------------------------------

export interface TestCaseDataPlan {
  testCaseId: string;
  requiredDataItemIds: string[];
  setupItemIds: string[];
  cleanupItemIds: string[];
  reusableDataSetIds: string[];
  unresolvedIds: string[];
}

// ---- Test data item -------------------------------------------------------

export type TestDataType =
  | 'input'
  | 'database-record'
  | 'account'
  | 'state'
  | 'external-response'
  | 'file'
  | 'configuration'
  | 'token'
  | 'identifier'
  | 'reference-data'
  | 'other';

export type TestDataLifecycle =
  | 'existing'
  | 'temporary'
  | 'generated'
  | 'shared'
  | 'persistent'
  | 'unknown';

export type TestDataStrategy =
  | 'reuse-existing'
  | 'create-new'
  | 'generate'
  | 'derive'
  | 'mock'
  | 'stub'
  | 'configure'
  | 'select-existing'
  | 'unknown';

export interface TestDataItem {
  id: string;
  name: string;
  description: string;
  type: TestDataType;
  lifecycle: TestDataLifecycle;
  strategy: TestDataStrategy;
  constraints: DataConstraint[];
  dependencies: string[];
  relatedTestCaseIds: string[];
  relatedRequirementIds: string[];
  relatedEntityIds: string[];
  setup: DataSetupIntent[];
  cleanup: DataCleanupIntent[];
  provenance: TestProvenance[];
  confidence: number;
}

// ---- Data constraint ------------------------------------------------------

export type DataConstraintType =
  | 'required'
  | 'format'
  | 'min'
  | 'max'
  | 'length'
  | 'unique'
  | 'nullable'
  | 'foreign-key'
  | 'state'
  | 'value'
  | 'relation'
  | 'other';

export interface DataConstraint {
  type: DataConstraintType;
  field?: string;
  operator?: string;
  value?: unknown;
  description: string;
  provenance: TestProvenance[];
}

// ---- Data dependency ------------------------------------------------------

export type DataDependencyType =
  | 'requires'
  | 'references'
  | 'derived-from'
  | 'created-after'
  | 'must-exist-before'
  | 'cleanup-after'
  | 'other';

export interface DataDependency {
  id: string;
  sourceDataItemId: string;
  targetDataItemId: string;
  type: DataDependencyType;
  description?: string;
}

// ---- Setup / cleanup intents ----------------------------------------------

export type DataSetupType = 'select' | 'create' | 'generate' | 'configure' | 'mock' | 'derive' | 'none';
export type ExecutorHint = 'database' | 'api' | 'ui' | 'file' | 'configuration' | 'unknown';

export interface DataSetupIntent {
  type: DataSetupType;
  description: string;
  executorHint?: ExecutorHint;
}

export type DataCleanupType = 'delete' | 'restore' | 'reset' | 'expire' | 'none' | 'unknown';

export interface DataCleanupIntent {
  type: DataCleanupType;
  description: string;
}

// ---- Reusable data set ----------------------------------------------------

export type ReusePolicy = 'safe' | 'isolated-copy' | 'read-only' | 'unknown';

export interface ReusableDataSet {
  id: string;
  name: string;
  dataItemIds: string[];
  applicableTestCaseIds: string[];
  reusePolicy: ReusePolicy;
  reason: string;
}

// ---- Unresolved -----------------------------------------------------------

export type DataUnresolvedReason =
  | 'missing-constraint'
  | 'missing-source'
  | 'unknown-state'
  | 'unknown-data-location'
  | 'unknown-creation-strategy'
  | 'ambiguous-dependency'
  | 'other';

export interface TestDataUnresolved {
  id: string;
  testCaseIds: string[];
  description: string;
  reason: DataUnresolvedReason;
  provenance: TestProvenance[];
}

// ---- Quality metrics ------------------------------------------------------

export interface TestDataQualityMetrics {
  testCasesTotal: number;
  testCasesWithCompleteDataPlan: number;
  testCasesPartiallyPlanned: number;
  dataItems: number;
  reusableDataSets: number;
  dependencies: number;
  unresolved: number;
  cyclicDependencies: number;
  provenanceCoverage: number;
  strategyCoverage: number;
  testsRequiringData: number;
  testsCoveredByData: number;
  coverageRate: number;
  unresolvedDataRequirements: number;
}

// ---- AI candidate models (intermediate) -----------------------------------

export interface DataRequirementCandidate {
  temporaryId: string;
  testCaseId: string;
  name: string;
  description: string;
  type: TestDataType;
  lifecycle: TestDataLifecycle;
  strategy: TestDataStrategy;
  constraints: Array<{
    type: DataConstraintType;
    field?: string;
    operator?: string;
    value?: unknown;
    description: string;
  }>;
  relatedRequirementIds: string[];
  relatedEntityIds: string[];
  provenance: TestProvenance[];
  confidence: number;
}

export interface DependencyCandidate {
  sourceTemporaryId: string;
  targetTemporaryId: string;
  type: DataDependencyType;
  description?: string;
}

export interface ReuseCandidate {
  temporaryIds: string[];
  reason: string;
  reusePolicy: ReusePolicy;
}

export interface DataRequirementExtractionResult {
  dataCandidates: DataRequirementCandidate[];
  unresolvedCandidates: Array<{
    testCaseIds: string[];
    description: string;
    reason: DataUnresolvedReason;
    provenance: TestProvenance[];
  }>;
}

export interface DependencyAnalysisResult {
  dependencyCandidates: DependencyCandidate[];
  reuseCandidates: ReuseCandidate[];
}

// ---- Builder options ------------------------------------------------------

export interface TestDataPlannerOptions {
  outputDir?: string;
  resume?: boolean;
  promptVersion?: string;
  maxRepairAttempts?: number;
}

// ---- Manifest -------------------------------------------------------------

export interface TestDataPlannerManifest {
  schemaVersion: '1.0';
  source: {
    testCaseIR: string;
    testPlanIR?: string;
  };
  provider: {
    name: string;
    model: string;
  };
  promptVersion: string;
  stats: {
    testCases: number;
    dataItems: number;
    dependencies: number;
    reusableSets: number;
    unresolved: number;
    completePlans: number;
    partialPlans: number;
    testsRequiringData?: number;
    testsCoveredByData?: number;
    coverageRate?: number;
  };
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  fingerprint: string;
  warnings: TestDataPlannerWarning[];
}

// ---- Warning model --------------------------------------------------------

export interface TestDataPlannerWarning {
  code: string;
  message: string;
  dataItemId?: string;
  testCaseId?: string;
  dependencyId?: string;
}

// ---- Test Case IR input types (minimal, for loading) ----------------------

export interface TestCaseIRInput {
  schemaVersion: string;
  testCases: Array<{
    id: string;
    scenarioId: string;
    requirementIds: string[];
    title: string;
    objective: string;
    type: string;
    priority: string;
    preconditions: Array<{ description: string; sourceRequirementIds: string[] }>;
    inputs: Array<{ name: string; valueStrategy: string; value?: unknown; description?: string }>;
    dataNeeds: Array<{
      id: string;
      description: string;
      type: string;
      constraints: string[];
      relatedRequirementIds: string[];
      relatedEntityIds?: string[];
    }>;
    steps: Array<{ order: number; action: string; target?: string; input?: string }>;
    expectedResults: Array<{ description: string; verificationType: string; target?: string }>;
    cleanup: Array<{ description: string; target?: string }>;
    automation: { status: string; suggestedExecutor?: string; reasons: string[] };
    provenance: Array<{ requirementId: string; contextId?: string; sheet?: string; ranges?: string[] }>;
    confidence: number;
  }>;
  dataNeeds?: Array<{
    id: string;
    description: string;
    type: string;
    constraints: string[];
    relatedRequirementIds: string[];
  }>;
}

export interface TestPlanIRInput {
  schemaVersion: string;
  scope?: {
    requirementIds: string[];
    objective: string;
  };
  scenarios?: Array<{
    id: string;
    title: string;
    requirementIds: string[];
    dataNeeds?: Array<{ id: string; description: string; type: string }>;
  }>;
  unresolved?: Array<{
    id: string;
    requirementIds: string[];
    description: string;
    reason: string;
  }>;
  quality?: Record<string, unknown>;
}
