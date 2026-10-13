// ---------------------------------------------------------------------------
// Test Planner – public API (type shell)
// ---------------------------------------------------------------------------
// TIRAI is a pure tool: test planning is supplied by the host agent.
// This package retains the canonical Test Plan / Test Case IR model only.

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
  TestPlannerWarning,
  RequirementIRInput,
  ProvenanceReference,
} from './models.js';
