// End-to-End Test Runner v1 — Canonical data model.
//
// The runner orchestrates frozen TIRAI modules through a controlled lifecycle:
// Load → Validate → Preflight → Prepare → Execute → Evidence → Cleanup → Report.
// It intentionally does not interpret Test Case semantics or synthesize
// executor-specific actions.

import type {
  ProjectExecutionProfile,
  ProjectIdentity,
  ProjectEnvironmentDefinition,
  EnvironmentSafety,
  ProjectCapabilities,
  RuntimeBindingCatalog,
  SecretReferenceCatalog,
  ProjectCommandCatalog,
  ProjectCommandDefinition,
  ProjectProfileProvenance,
} from 'project-adapter';

import type {
  ExecutionMappingIR,
  TestCaseExecutionMapping,
  MappingStatus,
  ClassificationExecutorType,
} from 'execution-mapping-builder';

import type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  TestCaseType,
  VerificationType,
} from 'test-planner';

import type {
  TestDataPlanIR,
  TestCaseDataPlan,
  TestDataItem,
} from 'test-data-planner';

import type {
  ExecutableDataPreparationIR,
  PreparationOperation,
  RuntimeBinding,
} from 'data-resolver';

import type {
  RuntimeBindingStore,
  SecretProvider,
} from 'execution-engine';

import type {
  TestExecutor,
  TestExecutorType,
  TestResultStatus,
  TestRunMode,
  EvidenceReference,
  EvidenceCollector,
  TestExecutionResultIR,
  TestRunResultIR,
  TestRunSummary,
  TestCleanupResult,
  TestCleanupSummary,
  TestDataExecutionSummary,
  RuntimeBindingSummary,
  TestExecutionTiming,
  Clock,
  RunIdProvider,
  TestRunAuditRecorder,
  TestExecutionOrchestrator,
} from 'test-execution-orchestrator';

// Re-export upstream types for downstream consumers.
export type {
  ProjectExecutionProfile,
  ProjectIdentity,
  ProjectEnvironmentDefinition,
  EnvironmentSafety,
  ProjectCapabilities,
  RuntimeBindingCatalog,
  SecretReferenceCatalog,
  ProjectCommandCatalog,
  ProjectCommandDefinition,
  ProjectProfileProvenance,
  ExecutionMappingIR,
  TestCaseExecutionMapping,
  MappingStatus,
  ClassificationExecutorType,
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  TestCaseType,
  VerificationType,
  TestDataPlanIR,
  TestCaseDataPlan,
  TestDataItem,
  ExecutableDataPreparationIR,
  PreparationOperation,
  RuntimeBinding,
  RuntimeBindingStore,
  SecretProvider,
  TestExecutor,
  TestExecutorType,
  TestResultStatus,
  TestRunMode,
  EvidenceReference,
  EvidenceCollector,
  TestExecutionResultIR,
  TestRunResultIR,
  TestRunSummary,
  TestCleanupResult,
  TestCleanupSummary,
  TestDataExecutionSummary,
  RuntimeBindingSummary,
  TestExecutionTiming,
  Clock,
  RunIdProvider,
  TestRunAuditRecorder,
  TestExecutionOrchestrator,
};

// ---- Run mode (spec §6) ---------------------------------------------------

export type EndToEndRunMode =
  | 'validate'
  | 'dry-run'
  | 'simulate'
  | 'execute';

// ---- Runner policy (spec §13) ---------------------------------------------

export interface EndToEndRunnerPolicy {
  mode: EndToEndRunMode;
  allowExecution: boolean;
  allowDatabaseMutation: boolean;
  allowApiMutation: boolean;
  allowBrowserExecution: boolean;
  allowCommands: boolean;
  requireCleanWorkingTree?: boolean;
  failFast: boolean;
  maxTests?: number;
  maxConcurrency: number;
  cleanupAfterRun: boolean;
  cleanupOnFailure: boolean;
  collectEvidence: boolean;
  environmentAllowlist: string[];
}

// ---- Runtime mode (spec §50) ----------------------------------------------

export type RuntimeMode = 'external' | 'managed';

// ---- Preflight (spec §22-24) ----------------------------------------------

export type PreflightCheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';

export interface PreflightCheck {
  id: string;
  name: string;
  status: PreflightCheckStatus;
  message?: string;
  path?: string;
}

export interface RunnerBlocker {
  code: RunnerBlockerCode;
  message: string;
  path?: string;
}

export type RunnerBlockerCode =
  | 'RUNNER_PROFILE_INVALID'
  | 'RUNNER_ENVIRONMENT_MISSING'
  | 'RUNNER_MAPPING_INCOMPLETE'
  | 'RUNNER_MAPPING_STALE'
  | 'RUNNER_DATA_PLAN_STALE'
  | 'RUNNER_PREPARED_DATA_STALE'
  | 'RUNNER_DATA_PLAN_INVALID'
  | 'RUNNER_TEST_CASES_MISSING'
  | 'RUNNER_TEST_CASES_INVALID'
  | 'RUNNER_TEST_EXECUTOR_UNAVAILABLE'
  | 'RUNNER_BINDING_MISSING'
  | 'RUNNER_SECRET_MISSING'
  | 'RUNNER_RESOURCE_DENIED'
  | 'RUNNER_PRODUCTION_EXECUTE_DENIED'
  | 'RUNNER_POLICY_CONFLICT'
  | 'RUNNER_GRAPH_CYCLE'
  | 'RUNNER_INPUT_MISMATCH';

export interface RunnerWarning {
  code: RunnerWarningCode;
  message: string;
  path?: string;
}

export type RunnerWarningCode =
  | 'RUNNER_NO_UI_PROFILE'
  | 'RUNNER_NO_API_PROFILE'
  | 'RUNNER_NO_DB_PROFILE'
  | 'RUNNER_PARTIAL_MAPPING'
  | 'RUNNER_MANUAL_TEST_CASES'
  | 'RUNNER_UNUSED_BINDING'
  | 'RUNNER_UNUSED_SECRET'
  | 'RUNNER_COMMAND_UNSAFE'
  | 'RUNNER_SHARED_NONPROD_MUTATION'
  | 'RUNNER_LOW_CONFIDENCE_MAPPING';

export interface RunnerError {
  code: RunnerErrorCode;
  message: string;
  path?: string;
}

export type RunnerErrorCode =
  | 'RUNNER_INTERNAL_ERROR'
  | 'RUNNER_INPUT_INVALID'
  | 'RUNNER_INPUT_MISSING'
  | 'RUNNER_SCHEMA_UNSUPPORTED'
  | 'RUNNER_PATH_ESCAPE'
  | 'RUNNER_TIMEOUT'
  | 'RUNNER_CANCELLED'
  | 'RUNNER_EXECUTOR_ERROR'
  | 'RUNNER_PREPARATION_ERROR'
  | 'RUNNER_CLEANUP_ERROR'
  | 'RUNNER_RUNTIME_ERROR';

export interface PreflightResult {
  status: 'ready' | 'blocked' | 'warning';
  checks: PreflightCheck[];
  blockers: RunnerBlocker[];
  warnings: RunnerWarning[];
}

// ---- Test selection (spec §25-27) -----------------------------------------

export interface TestSelection {
  testCaseIds?: string[];
  scenarioIds?: string[];
  requirementIds?: string[];
  tags?: string[];
  executorTypes?: ClassificationExecutorType[];
}

// ---- Project runtime (spec §49-51) ----------------------------------------

export interface ProjectRuntimeManager {
  start(): Promise<ProjectRuntimeState>;
  waitUntilReady(timeoutMs?: number): Promise<ProjectRuntimeState>;
  stop(): Promise<ProjectRuntimeState>;
  getState(): ProjectRuntimeState;
}

export type ProjectRuntimeState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'error';

export interface ProjectRuntimeSummary {
  mode: RuntimeMode;
  started: boolean;
  ready: boolean;
  stopped: boolean;
  startError?: string;
  stopError?: string;
}

// ---- Project command executor (spec §44-47) --------------------------------

export interface ProjectCommandExecutor {
  validate(command: ProjectCommandDefinition): RunnerBlocker | null;
  execute(command: ProjectCommandDefinition): Promise<ProjectCommandResult>;
  terminate(): Promise<void>;
}

export interface ProjectCommandResult {
  commandId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ---- Secret provider (spec §69-71) ----------------------------------------

export interface EndToEndSecretProvider {
  resolve(name: string): Promise<string | undefined>;
  has(name: string): Promise<boolean>;
}

// ---- Preparation summary (spec §55) ---------------------------------------

export interface EndToEndPreparationSummary {
  status: 'succeeded' | 'failed' | 'partial' | 'skipped';
  operationsTotal: number;
  operationsSucceeded: number;
  operationsFailed: number;
  bindingsProduced: number;
  durationMs: number;
  errors: RunnerError[];
}

// ---- Cleanup summary (spec §55) -------------------------------------------

export interface EndToEndCleanupSummary {
  testCleanup: CleanupPhaseResult;
  dataCleanup: CleanupPhaseResult;
  runtimeCleanup: CleanupPhaseResult;
  failures: number;
}

export interface CleanupPhaseResult {
  attempted: boolean;
  succeeded: boolean;
  error?: string;
}

// ---- Run quality (spec §55) -----------------------------------------------

export interface EndToEndRunQuality {
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  testsBlocked: number;
  testsManual: number;
  testsError: number;
  assertionsTotal: number;
  assertionsPassed: number;
  assertionsFailed: number;
  evidenceCount: number;
  cleanupFailures: number;
  provenanceCoverage: number;
  durationMs: number;
}

// ---- Run timing (spec §55) ------------------------------------------------

export interface EndToEndRunTiming {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  preflightMs: number;
  runtimeStartMs: number;
  preparationMs: number;
  executionMs: number;
  cleanupMs: number;
  reportingMs: number;
}

// ---- Runner audit event (spec §73) ----------------------------------------

export type RunnerAuditEventType =
  | 'run-created'
  | 'inputs-loaded'
  | 'preflight-start'
  | 'preflight-end'
  | 'runtime-start'
  | 'runtime-end'
  | 'preparation-start'
  | 'preparation-end'
  | 'tests-start'
  | 'tests-end'
  | 'cleanup-start'
  | 'cleanup-end'
  | 'report-written'
  | 'run-finished';

export interface RunnerAuditEvent {
  sequence: number;
  type: RunnerAuditEventType;
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

// ---- Runner audit recorder ------------------------------------------------

export interface RunnerAuditRecorder {
  record(type: RunnerAuditEventType, message: string, details?: Record<string, unknown>): void;
  events(): RunnerAuditEvent[];
}

// ---- Run status (spec §56) ------------------------------------------------

export type EndToEndRunStatus =
  | 'validated'
  | 'passed'
  | 'failed'
  | 'partial'
  | 'blocked'
  | 'error';

// ---- Input artifact fingerprints (spec §19-21) ----------------------------

export interface InputArtifactHashes {
  profileFingerprint: string;
  testCasesHash: string;
  mappingHash: string;
  dataPlanHash?: string;
  preparedDataHash?: string;
}

// ---- End-to-end run result IR (spec §55) ----------------------------------

export interface EndToEndRunResultIR {
  schemaVersion: '1.0';
  runId: string;
  projectId: string;
  environmentId: string;
  mode: EndToEndRunMode;
  status: EndToEndRunStatus;
  preflight: PreflightResult;
  runtime: ProjectRuntimeSummary;
  preparation: EndToEndPreparationSummary;
  tests: TestRunResultIR;
  cleanup: EndToEndCleanupSummary;
  evidence: EvidenceReference[];
  warnings: RunnerWarning[];
  errors: RunnerError[];
  quality: EndToEndRunQuality;
  timings: EndToEndRunTiming;
  inputHashes: InputArtifactHashes;
  runnerVersion: string;
  seed?: number;
}

// ---- Run manifest (spec §54) ----------------------------------------------

export interface EndToEndRunManifest {
  schemaVersion: '1.0';
  runId: string;
  projectId: string;
  environmentId: string;
  mode: EndToEndRunMode;
  profileFingerprint: string;
  inputHashes: InputArtifactHashes;
  selection: TestSelection;
  startedAt: string;
  finishedAt: string;
  runnerVersion: string;
  seed?: number;
}

// ---- Exit codes (spec §63) ------------------------------------------------

export type EndToEndExitCode =
  | 0  // success / validated
  | 1  // test failures
  | 2  // blocked / preflight
  | 3  // infrastructure error
  | 4; // invalid input / config

// ---- Runner options -------------------------------------------------------

export interface EndToEndRunnerOptions {
  policy: EndToEndRunnerPolicy;
  selection?: TestSelection;
  runtimeMode?: RuntimeMode;
  outputDir?: string;
  seed?: number;
  timeoutMs?: number;
  clock?: Clock;
  runIdProvider?: RunIdProvider;
  secretProvider?: EndToEndSecretProvider;
  runtimeManager?: ProjectRuntimeManager;
  commandExecutor?: ProjectCommandExecutor;
  auditRecorder?: RunnerAuditRecorder;
  orchestrator?: TestExecutionOrchestrator;
  pretty?: boolean;
}

// ---- Runner input (loaded artifacts) --------------------------------------

export interface EndToEndRunnerInput {
  profile: ProjectExecutionProfile;
  testCases: TestCase[];
  mappings: ExecutionMappingIR;
  dataPlan?: TestDataPlanIR;
  preparedData?: ExecutableDataPreparationIR;
}

// ---- Signal handling (spec §76-77) ----------------------------------------

export interface SignalHandler {
  onSignal(callback: () => void): void;
  dispose(): void;
}

// ---- Log level (spec §72) -------------------------------------------------

export type RunnerLogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface RunnerLogEntry {
  level: RunnerLogLevel;
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RunnerLogger {
  error(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  debug(message: string, details?: Record<string, unknown>): void;
  entries(): RunnerLogEntry[];
}

// ---- JUnit types (spec §61-62) -------------------------------------------

export interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  testCases: JUnitTestCase[];
}

export interface JUnitTestCase {
  classname: string;
  name: string;
  time: number;
  failure?: { message: string; type: string; text: string };
  error?: { message: string; type: string; text: string };
  skipped?: { message: string };
}
