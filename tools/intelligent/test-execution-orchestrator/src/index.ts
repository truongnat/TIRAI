// Test Execution Orchestrator v1 — Barrel export.

// Orchestrator
export { TestExecutionOrchestrator } from './orchestrator.js';
export type { OrchestratorOptions } from './orchestrator.js';

// Registry
export { TestExecutorRegistry } from './registry.js';

// Executors
export { FakeTestExecutor, ManualTestExecutor } from './executors/index.js';
export type { FakeTestExecutorConfig } from './executors/index.js';

// Evidence
export { InMemoryEvidenceCollector } from './evidence/index.js';

// Audit
export { InMemoryTestRunAuditRecorder } from './audit.js';

// Policy
export { defaultTestRunPolicy } from './policy.js';

// Clock
export { SystemClock, FixedClock } from './clock.js';

// Run ID
export { UniqueRunIdProvider, DeterministicRunIdProvider } from './run-id.js';

// Assertion planner
export { planAssertions } from './assertion-planner.js';

// Status classifier
export { classifyTestStatus } from './status-classifier.js';
export type { ClassificationResult } from './status-classifier.js';

// Quality
export { computeRunSummary, computeExecutorBreakdown } from './quality/index.js';

// Errors / Warnings
export { TestExecutionOrchestratorError, TestErrorCode } from './errors.js';
export type { TestErrorCodeType } from './errors.js';
export { TestWarningCode } from './warnings.js';

// Models
export type {
  TestExecutionPhase,
  TestResultStatus,
  TestRunMode,
  TestExecutorType,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorValidation,
  TestExecutorResult,
  TestStepExecutionResult,
  AssertionResult,
  EvidenceType,
  EvidenceReference,
  EvidenceInput,
  EvidenceCollector,
  TestExecutionError,
  TestExecutionWarning,
  TestCleanupResult,
  TestCleanupSummary,
  TestDataExecutionSummary,
  RuntimeBindingSummary,
  TestExecutionTiming,
  TestExecutionResultIR,
  TestRunSummary,
  TestRunAuditEventType,
  TestRunAuditEvent,
  TestRunResultIR,
  TestRunPolicy,
  TestExecutionContext,
  TestRunAuditRecorder,
  Clock,
  RunIdProvider,
  TestRunOptions,
  TestRunManifest,
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  AutomationReadiness,
  VerificationType,
  TestCaseType,
  RuntimeBindingStore,
  RuntimeBindingResult,
  SecretProvider,
  AuditRecorder,
  ExecutionWarning,
} from './models.js';
