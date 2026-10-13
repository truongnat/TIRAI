// ---------------------------------------------------------------------------
// Test Data Planner – public API (type shell)
// ---------------------------------------------------------------------------
// TIRAI is a pure tool: test data planning is supplied by the host agent.
// This package retains the canonical Test Data Plan IR model only.

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
  TestDataPlannerWarning,
  TestCaseIRInput,
  TestPlanIRInput,
  TestProvenance,
} from './models.js';
