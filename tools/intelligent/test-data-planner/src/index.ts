// ---------------------------------------------------------------------------
// Test Data Planner – public API
// ---------------------------------------------------------------------------

export { buildTestDataPlan } from './planner.js';
export { extractDeterministic, mergeExtractionResults } from './analysis/deterministic-extractor.js';
export { TEST_DATA_PLANNER_PROMPT_VERSION } from './prompts/system.js';
export { TestDataPlannerError, TestDataPlannerErrorCode } from './errors.js';
export { TestDataPlannerWarningCode, DATA_CONFIDENCE_THRESHOLD } from './warnings.js';
export { computeFingerprint } from './fingerprint.js';

export type {
  TestDataPlanIR,
  TestCaseDataPlan,
  TestDataItem,
  TestDataType,
  TestDataLifecycle,
  TestDataStrategy,
  DataConstraint,
  DataConstraintType,
  DataDependency,
  DataDependencyType,
  DataSetupIntent,
  DataSetupType,
  ExecutorHint,
  DataCleanupIntent,
  DataCleanupType,
  ReusableDataSet,
  ReusePolicy,
  TestDataUnresolved,
  DataUnresolvedReason,
  TestDataQualityMetrics,
  DataRequirementCandidate,
  DependencyCandidate,
  ReuseCandidate,
  DataRequirementExtractionResult,
  DependencyAnalysisResult,
  TestDataPlannerOptions,
  TestDataPlannerManifest,
  TestDataPlannerWarning,
  TestCaseIRInput,
  TestPlanIRInput,
  TestProvenance,
} from './models.js';
