// ---------------------------------------------------------------------------
// Test Planner – public API
// ---------------------------------------------------------------------------

export { buildTestPlan, buildTestPlanFromRequirementIR } from './planner.js';
export { TEST_PLANNER_PROMPT_VERSION } from './prompts/system.js';
export { TestPlannerError, TestPlannerErrorCode } from './errors.js';
export { TestPlannerWarningCode, TEST_CONFIDENCE_THRESHOLD } from './warnings.js';
export { computeFingerprint } from './fingerprint.js';

export type {
  TestPlanIR,
  TestScope,
  RequirementCoverage,
  CoverageStrategy,
  CoverageStatus,
  TestScenario,
  TestScenarioCategory,
  TestCase,
  TestCaseType,
  TestStep,
  ExpectedResult,
  TestPrecondition,
  TestInput,
  TestDataNeed,
  DataNeedType,
  TestCleanup,
  AutomationReadiness,
  AutomationStatus,
  SuggestedExecutor,
  TestProvenance,
  TestPlanningUnresolved,
  UnresolvedReason,
  TestPlanQualityMetrics,
  Priority,
  VerificationType,
  VerificationIntent,
  VerificationIntentKind,
  VerificationAuthorityIntent,
  ValueStrategy,
  CoverageCandidate,
  ScenarioCandidate,
  TestCaseCandidate,
  CoverageAnalysisResult,
  ScenarioExtractionResult,
  TestCaseExtractionResult,
  TestPlannerOptions,
  TestPlannerManifest,
  TestPlannerWarning,
  RequirementIRInput,
  ProvenanceReference,
} from './models.js';
