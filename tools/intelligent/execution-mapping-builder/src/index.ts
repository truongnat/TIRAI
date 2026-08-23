// Execution Mapping Builder v1 — Public API.
//
// Transforms Test Case IR + Project Execution Metadata into validated
// Test Execution Mapping IR. Design-time module: does NOT execute tests.

export { buildExecutionMapping } from './builder.js';

// Models
export type {
  ExecutionMappingIR,
  ExecutionMappingBuilderOptions,
  ExecutionMappingResult,
  TestCaseExecutionMapping,
  ExecutionMappingUnresolved,
  ExecutionMappingQuality,
  ExecutionCatalogReferences,
  ExecutorClassification,
  ExecutorCandidate,
  StepMappingCandidate,
  AssertionMappingCandidate,
  ClassificationExecutorType,
  MappingTrust,
  MappingStatus,
  MappingSource,
  UnresolvedStage,
  UnresolvedReason,
  ApiTestExecutionMapping,
  DatabaseTestExecutionMapping,
  AIMappingCandidatesResponse,
  CheckpointMetadata,
  ExecutionMappingErrorCode,
  ExecutionMappingWarningCode,
  SemanticEntity,
  BindingsCatalog,
  BindingDefinition,
  ApiResourceCatalog,
  DbEntityCatalog,
} from './models.js';

// Errors
export { ExecutionMappingError, EXECUTION_MAPPING_ERROR_CODES } from './errors.js';

// Warnings
export { EXECUTION_MAPPING_WARNING_CODES } from './warnings.js';
export type { ExecutionMappingWarning } from './warnings.js';

// Classifier
export { classifyExecutor, classifyAll } from './classifier/index.js';

// Candidates
export {
  isSupportedAction,
  isSupportedAssertion,
  inferActionFromStep,
  inferAssertionFromResult,
  generateStepCandidates,
  generateAssertionCandidates,
  generateExecutorCandidate,
} from './candidates/index.js';

// Catalog
export { UICatalogResolver, createUICatalogResolver, createEmptyCatalog } from './catalog/index.js';
export type { CatalogLookupResult } from './catalog/index.js';

// Bindings
export { BindingResolver, createEmptyBindingsCatalog, createBindingsCatalog } from './bindings/index.js';

// Validation
export { validateUICandidate, validateAllCandidates } from './validation/index.js';
export type { ValidationResult } from './validation/index.js';

// AI
export { requestAICandidates, buildEvidencePackage } from './ai/index.js';

// Quality
export { computeQuality } from './quality/index.js';

// Checkpoint
export { CheckpointStore, createFingerprint } from './checkpoint.js';

// Fingerprint
export { computeFingerprint } from './fingerprint.js';
export type { FingerprintInput } from './fingerprint.js';

// Persistence
export { writeOutput } from './persistence/index.js';
export type { OutputManifest } from './persistence/index.js';
