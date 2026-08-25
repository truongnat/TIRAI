// End-to-End Test Runner v1 — Public API barrel.
//
// The runner orchestrates frozen TIRAI modules through a controlled lifecycle.
// It does not interpret Test Case semantics or synthesize executor actions.

// Runner
export { EndToEndRunner } from './runner.js';
export { Scenario3Pipeline } from './scenario3.js';
export type {
  Scenario3Specification,
  Scenario3StageAdapters,
  Scenario3ExecutionAdapter,
  Scenario3PipelineResult,
} from './scenario3.js';

// Policy
export { defaultPolicy, checkExecutionGate, isValidMode, enforceMaxTests } from './policy.js';

// Preflight
export { runPreflight } from './preflight.js';

// Selection
export { selectTests, sortByTestId, applyMaxTests } from './selection.js';

// Fingerprints
export {
  computeHash,
  computeObjectHash,
  computeInputHashes,
  computeTestCasesSemanticHash,
  isMappingStale,
  isDataPlanStale,
  isPreparedDataStale,
  canonicalJson,
  verifyMappingTestCaseConsistency,
  verifyDataPlanTestCaseConsistency,
  verifyPreparedDataConsistency,
} from './fingerprints.js';

// Loader
export {
  loadAllInputs,
  loadProfile,
  loadTestCases,
  loadMappings,
  loadDataPlan,
  loadPreparedData,
  assertWithinRoot,
} from './loader.js';
export type { LoadInputOptions } from './loader.js';

// Runtime
export { FakeProjectRuntimeManager } from './runtime/index.js';

// Execution
export { FakeProjectCommandExecutor, FakeSecretProvider } from './execution/index.js';

// Preparation
export { runPreparation } from './preparation/index.js';

// Cleanup
export { runCleanup } from './cleanup/index.js';

// Audit
export { InMemoryRunAuditRecorder } from './audit/index.js';

// Reporting
export { generateJUnit, generateSummaryMd, generateSummaryJson } from './reporting/index.js';

// Quality
export { computeRunQuality } from './quality/index.js';

// Persistence
export { writeRunOutput } from './persistence/index.js';
export type { WriteRunOutputOptions } from './persistence/index.js';

// Errors
export { EndToEndRunnerError } from './errors.js';

// Warnings
export { createWarning } from './warnings.js';

// Models
export type {
  EndToEndRunMode,
  EndToEndRunnerPolicy,
  RuntimeMode,
  PreflightCheckStatus,
  PreflightCheck,
  RunnerBlocker,
  RunnerBlockerCode,
  RunnerWarning,
  RunnerWarningCode,
  RunnerError,
  RunnerErrorCode,
  PreflightResult,
  TestSelection,
  ProjectRuntimeManager,
  ProjectRuntimeState,
  ProjectRuntimeSummary,
  ProjectCommandExecutor,
  ProjectCommandResult,
  EndToEndSecretProvider,
  EndToEndPreparationSummary,
  EndToEndCleanupSummary,
  CleanupPhaseResult,
  EndToEndRunQuality,
  EndToEndRunTiming,
  RunnerAuditEventType,
  RunnerAuditEvent,
  RunnerAuditRecorder,
  EndToEndRunStatus,
  InputArtifactHashes,
  MappingSourceCompatibility,
  DataPlanSourceCompatibility,
  PreparedDataSourceCompatibility,
  EndToEndRunResultIR,
  EndToEndRunManifest,
  EndToEndExitCode,
  EndToEndRunnerOptions,
  EndToEndRunnerInput,
  SignalHandler,
  RunnerLogLevel,
  RunnerLogEntry,
  RunnerLogger,
  JUnitTestSuite,
  JUnitTestCase,
} from './models.js';

// Re-export upstream types
export type {
  ProjectExecutionProfile,
  ExecutionMappingIR,
  TestCase,
  TestDataPlanIR,
  ExecutableDataPreparationIR,
  TestRunResultIR,
  TestExecutionResultIR,
  EvidenceReference,
  TestRunSummary,
  Clock,
  RunIdProvider,
  SecretProvider,
  RuntimeBindingStore,
  TestExecutionOrchestrator,
} from './models.js';
