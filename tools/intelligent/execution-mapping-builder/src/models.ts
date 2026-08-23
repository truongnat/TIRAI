// Execution Mapping Builder v1 — Canonical data model.
//
// Transforms Test Case IR + Project Execution Metadata into Test Execution
// Mapping IR. Design-time module: answers which executor, which resources,
// which actions, which bindings, which assertions. Does NOT execute tests.

import type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
} from 'test-planner';

import type {
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UIActionType,
  UIAssertionType,
  UILocatorStrategy,
} from 'ui-executor';

import type {
  TestExecutorType,
  RuntimeBindingStore,
  SecretProvider,
} from 'test-execution-orchestrator';

import type { AIProvider } from 'ai-provider';

// Re-export upstream types for downstream consumers.
export type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UIActionType,
  UIAssertionType,
  UILocatorStrategy,
  TestExecutorType,
  RuntimeBindingStore,
  SecretProvider,
  AIProvider,
};

// ---- Mapping Trust Levels (spec §27) --------------------------------------

export type MappingTrust =
  | 'explicit'
  | 'catalog'
  | 'code-derived'
  | 'semantic-evidence'
  | 'ai-inferred';

// ---- Mapping Status (spec §29) --------------------------------------------

export type MappingStatus =
  | 'ready'
  | 'partial'
  | 'manual'
  | 'unresolved';

// ---- Mapping Source (spec §39) --------------------------------------------

export interface MappingSource {
  type: MappingTrust;
  reference: string;
  description?: string;
}

// ---- Executor Classification Result ---------------------------------------

export type ClassificationExecutorType = 'ui' | 'api' | 'database' | 'integration' | 'manual' | 'unknown';

export interface ExecutorClassification {
  testCaseId: string;
  executorType: ClassificationExecutorType;
  confidence: number;
  evidence: string[];
  source: MappingSource[];
}

// ---- Step Mapping Candidate (spec §30) ------------------------------------

export interface StepMappingCandidate {
  stepOrder: number;
  action: UIActionType;
  targetLogicalName?: string;
  valueBinding?: string;
  valueLiteral?: string;
  secretRef?: string;
  trust: MappingTrust;
  evidence: string[];
}

// ---- Assertion Mapping Candidate (spec §30) -------------------------------

export interface AssertionMappingCandidate {
  expectedResultIndex: number;
  assertionType: UIAssertionType;
  targetLogicalName?: string;
  expectedValue?: string;
  trust: MappingTrust;
  evidence: string[];
}

// ---- Executor Candidate (spec §30) ----------------------------------------

export interface ExecutorCandidate {
  testCaseId: string;
  executorType: ClassificationExecutorType;
  pageLogicalName?: string;
  stepCandidates: StepMappingCandidate[];
  assertionCandidates: AssertionMappingCandidate[];
  trust: MappingTrust;
  confidence: number;
  evidence: string[];
}

// ---- API Test Execution Mapping (spec §22) --------------------------------

export interface ApiTestExecutionMapping {
  testCaseId: string;
  resourceId: string;
  operationId?: string;
  method?: string;
  pathMapping?: string;
  inputBindings: Record<string, string>;
  expectedStatus?: number[];
  assertions: ApiAssertionMapping[];
}

export interface ApiAssertionMapping {
  expectedResultIndex: number;
  assertionType: string;
  targetPath?: string;
  expectedValue?: string;
}

// ---- Database Test Execution Mapping (spec §23) ---------------------------

export interface DatabaseTestExecutionMapping {
  testCaseId: string;
  entityId: string;
  queryType?: string;
  inputBindings: Record<string, string>;
  assertions: DatabaseAssertionMapping[];
}

export interface DatabaseAssertionMapping {
  expectedResultIndex: number;
  assertionType: string;
  column?: string;
  expectedValue?: string;
}

// ---- Test Case Execution Mapping (spec §7) --------------------------------

export interface TestCaseExecutionMapping {
  testCaseId: string;
  executorType: ClassificationExecutorType;
  confidence: number;
  status: MappingStatus;
  source: MappingSource[];
  ui?: TestExecutionMapping;
  api?: ApiTestExecutionMapping;
  database?: DatabaseTestExecutionMapping;
  unresolvedIds: string[];
  provenance: TestProvenance[];
}

// ---- Execution Mapping Unresolved (spec §40) ------------------------------

export type UnresolvedStage =
  | 'executor'
  | 'step'
  | 'target'
  | 'value'
  | 'assertion'
  | 'binding'
  | 'page'
  | 'resource';

export type UnresolvedReason =
  | 'missing-catalog-entry'
  | 'ambiguous-target'
  | 'missing-binding'
  | 'insufficient-evidence'
  | 'unsupported-action'
  | 'unsupported-assertion'
  | 'multi-executor-required'
  | 'other';

export interface ExecutionMappingUnresolved {
  id: string;
  testCaseId: string;
  stage: UnresolvedStage;
  description: string;
  reason: UnresolvedReason;
  provenance: TestProvenance[];
}

// ---- Execution Catalog References -----------------------------------------

export interface ExecutionCatalogReferences {
  uiCatalog?: UIElementCatalog;
  apiResources?: ApiResourceCatalog;
  dbEntities?: DbEntityCatalog;
  bindingsCatalog?: BindingsCatalog;
}

export interface ApiResourceCatalog {
  resources: ApiResourceDefinition[];
}

export interface ApiResourceDefinition {
  id: string;
  path: string;
  methods: string[];
  aliases?: string[];
}

export interface DbEntityCatalog {
  entities: DbEntityDefinition[];
}

export interface DbEntityDefinition {
  id: string;
  tableName: string;
  columns: string[];
  aliases?: string[];
}

export interface BindingsCatalog {
  bindings: BindingDefinition[];
}

export interface BindingDefinition {
  name: string;
  type: 'runtime' | 'secret' | 'generated';
  description?: string;
}

// ---- Execution Mapping Quality (spec §54) ---------------------------------

export interface ExecutionMappingQuality {
  testCasesTotal: number;
  ready: number;
  partial: number;
  manual: number;
  unresolved: number;
  uiMappings: number;
  apiMappings: number;
  databaseMappings: number;
  integrationMappings: number;
  stepsTotal: number;
  stepsMapped: number;
  assertionsTotal: number;
  assertionsMapped: number;
  bindingsRequired: number;
  bindingsResolved: number;
  catalogReferenceValidity: number;
  provenanceCoverage: number;
}

// ---- Execution Mapping IR (spec §6) ---------------------------------------

export interface ExecutionMappingIR {
  schemaVersion: '1.0';
  testMappings: TestCaseExecutionMapping[];
  unresolved: ExecutionMappingUnresolved[];
  catalogs: ExecutionCatalogReferences;
  quality: ExecutionMappingQuality;
}

// ---- AI Candidate Response (spec §32) -------------------------------------

export interface AIMappingCandidatesResponse {
  mappingCandidates: AICandidateMapping[];
  unresolvedCandidates: AIUnresolvedCandidate[];
}

export interface AICandidateMapping {
  testCaseId: string;
  executorType: ClassificationExecutorType;
  pageLogicalName?: string;
  stepCandidates: AIStepCandidate[];
  assertionCandidates: AIAssertionCandidate[];
}

export interface AIStepCandidate {
  stepOrder: number;
  action: UIActionType;
  targetLogicalName?: string;
  valueBinding?: string;
  valueLiteral?: string;
  secretRef?: string;
  confidence?: number;
}

export interface AIAssertionCandidate {
  expectedResultIndex: number;
  assertionType: UIAssertionType;
  targetLogicalName?: string;
  expectedValue?: string;
  confidence?: number;
}

export interface AIUnresolvedCandidate {
  testCaseId: string;
  stage: UnresolvedStage;
  description: string;
  reason: UnresolvedReason;
}

// ---- Builder Options ------------------------------------------------------

export interface ExecutionMappingBuilderOptions {
  testCases: TestCase[];
  uiCatalog?: UIElementCatalog;
  apiCatalog?: ApiResourceCatalog;
  dbCatalog?: DbEntityCatalog;
  bindingsCatalog?: BindingsCatalog;
  semanticEntities?: SemanticEntity[];
  provider?: AIProvider;
  providerName?: string;
  resume?: boolean;
  checkpointDir?: string;
  batchSize?: number;
}

// ---- Semantic Entity (simplified) -----------------------------------------

export interface SemanticEntity {
  id: string;
  type: string;
  name: string;
  description?: string;
  properties?: Record<string, unknown>;
}

// ---- Builder Result -------------------------------------------------------

export interface ExecutionMappingResult {
  mapping: ExecutionMappingIR;
  aiCalls: number;
  tokensUsed: number;
  repairs: number;
  checkpointReused: boolean;
}

// ---- Checkpoint Metadata --------------------------------------------------

export interface CheckpointMetadata {
  stage: 'classification' | 'candidates' | 'validation' | 'complete';
  fingerprint: string;
  timestamp: string;
  providerName?: string;
  model?: string;
  completedBatches: number[];
}

// ---- Builder Error Codes --------------------------------------------------

export type ExecutionMappingErrorCode =
  | 'EMB_INVALID_TEST_CASE'
  | 'EMB_MISSING_CATALOG'
  | 'EMB_AMBIGUOUS_TARGET'
  | 'EMB_MISSING_BINDING'
  | 'EMB_UNSUPPORTED_ACTION'
  | 'EMB_UNSUPPORTED_ASSERTION'
  | 'EMB_PROVIDER_FAILED'
  | 'EMB_SCHEMA_INVALID'
  | 'EMB_CHECKPOINT_CORRUPT'
  | 'EMB_DUPLICATE_MAPPING';

// ---- Builder Warning Codes ------------------------------------------------

export type ExecutionMappingWarningCode =
  | 'EMB_NO_PROVIDER'
  | 'EMB_AI_CANDIDATE_REJECTED'
  | 'EMB_LOW_CONFIDENCE'
  | 'EMB_PARTIAL_COVERAGE';
