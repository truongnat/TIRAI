// Test Execution Orchestrator v1 — Canonical data model.
//
// Coordinates test case execution across executor types. Consumes TestCase IR
// from the test planner, dispatches to registered TestExecutors, evaluates
// assertions, collects evidence, and produces TestExecutionResultIR.

import type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  AutomationReadiness,
  VerificationType,
  TestCaseType,
} from 'test-planner';

import type {
  RuntimeBindingStore,
  RuntimeBindingResult,
  SecretProvider,
  AuditRecorder,
  ExecutionWarning,
} from 'execution-engine';

// Re-export upstream types consumed by downstream code.
export type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  AutomationReadiness,
  VerificationType,
  TestCaseType,
};
export type {
  RuntimeBindingStore,
  RuntimeBindingResult,
  SecretProvider,
  AuditRecorder,
  ExecutionWarning,
};

// ---- Execution phases (spec §6) -------------------------------------------

export type TestExecutionPhase =
  | 'pending'
  | 'preparing-data'
  | 'ready'
  | 'executing'
  | 'verifying'
  | 'collecting-evidence'
  | 'cleaning-up'
  | 'completed'
  | 'failed'
  | 'blocked';

// ---- Test result status (spec §7) -----------------------------------------

export type TestResultStatus =
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'manual'
  | 'error';

// ---- Test run mode (spec §10) ---------------------------------------------

export type TestRunMode = 'dry-run' | 'simulate' | 'execute';

// ---- Test executor types (spec §12) ---------------------------------------

export type TestExecutorType =
  | 'ui'
  | 'api'
  | 'database'
  | 'integration'
  | 'manual'
  | 'fake';

// ---- Test executor contract (spec §11) ------------------------------------

export interface TestExecutorMatch {
  supported: boolean;
  score: number;
  reasons: string[];
}

export interface TestExecutorValidation {
  valid: boolean;
  errors: TestExecutionWarning[];
}

export interface TestExecutorResult {
  status: TestResultStatus;
  steps: TestStepExecutionResult[];
  assertions: AssertionResult[];
  evidence: EvidenceReference[];
  cleanup?: TestCleanupResult;
  error?: TestExecutionError;
  warnings: TestExecutionWarning[];
}

export interface TestExecutor {
  readonly type: TestExecutorType;
  canExecute(testCase: TestCase, context: TestExecutionContext): TestExecutorMatch;
  validate(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorValidation>;
  execute(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorResult>;
  cleanup?(testCase: TestCase, context: TestExecutionContext): Promise<TestCleanupResult>;
}

// ---- Step execution result (spec §20) -------------------------------------

export interface TestStepExecutionResult {
  order: number;
  action: string;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  evidenceIds: string[];
  error?: TestExecutionError;
}

// ---- Assertion result (spec §22) ------------------------------------------

export interface AssertionResult {
  id: string;
  expectedResultIndex: number;
  description: string;
  verificationType: VerificationType;
  status: 'passed' | 'failed' | 'not-verified' | 'blocked';
  actual?: unknown;
  evidenceIds: string[];
}

// ---- Evidence model (spec §26) --------------------------------------------

export type EvidenceType =
  | 'screenshot'
  | 'api-request'
  | 'api-response'
  | 'database-result'
  | 'log'
  | 'trace'
  | 'text'
  | 'file'
  | 'other';

export interface EvidenceReference {
  id: string;
  type: EvidenceType;
  sourceExecutor: TestExecutorType;
  testCaseId: string;
  stepOrder?: number;
  assertionId?: string;
  artifactRef?: string;
  metadata: Record<string, unknown>;
  sensitive: boolean;
}

export interface EvidenceInput {
  type: EvidenceType;
  sourceExecutor: TestExecutorType;
  testCaseId: string;
  stepOrder?: number;
  assertionId?: string;
  artifactRef?: string;
  metadata?: Record<string, unknown>;
  sensitive?: boolean;
}

export interface EvidenceCollector {
  add(input: EvidenceInput): EvidenceReference;
  list(): EvidenceReference[];
}

// ---- Error model (spec §33) -----------------------------------------------

export interface TestExecutionError {
  code: string;
  message: string;
  retryable: boolean;
  executorType?: TestExecutorType;
}

// ---- Warning model (spec §35) ---------------------------------------------

export interface TestExecutionWarning {
  code: string;
  message: string;
  testCaseId?: string;
}

// ---- Cleanup summary ------------------------------------------------------

export interface TestCleanupResult {
  status: 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  error?: TestExecutionError;
}

export interface TestCleanupSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  results: TestCleanupResult[];
}

// ---- Data preparation summary ---------------------------------------------

export interface TestDataExecutionSummary {
  status: 'succeeded' | 'blocked' | 'failed' | 'skipped';
  operationsTotal: number;
  operationsSucceeded: number;
  operationsFailed: number;
  bindingsProduced: number;
  error?: TestExecutionError;
}

// ---- Runtime binding summary ----------------------------------------------

export interface RuntimeBindingSummary {
  name: string;
  value: unknown;
  sensitive: boolean;
  status: 'resolved' | 'unresolved' | 'invalid';
}

// ---- Timing ---------------------------------------------------------------

export interface TestExecutionTiming {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dataPreparationMs?: number;
  executionMs?: number;
  verificationMs?: number;
  cleanupMs?: number;
}

// ---- Test execution result IR (spec §8) -----------------------------------

export interface TestExecutionResultIR {
  schemaVersion: '1.0';
  runId: string;
  testCaseId: string;
  scenarioId: string;
  requirementIds: string[];
  status: TestResultStatus;
  phase: TestExecutionPhase;
  dataPreparation?: TestDataExecutionSummary;
  steps: TestStepExecutionResult[];
  assertions: AssertionResult[];
  evidence: EvidenceReference[];
  runtimeBindings: RuntimeBindingSummary[];
  cleanup: TestCleanupSummary;
  errors: TestExecutionError[];
  warnings: TestExecutionWarning[];
  provenance: TestProvenance[];
  timings: TestExecutionTiming;
}

// ---- Test run summary -----------------------------------------------------

export interface TestRunSummary {
  testsTotal: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  manual: number;
  errors: number;
  assertionsTotal: number;
  assertionsPassed: number;
  assertionsFailed: number;
  assertionsBlocked: number;
  evidenceItems: number;
  cleanupFailures: number;
  provenanceCoverage: number;
  durationMs: number;
}

// ---- Test run audit event (spec §32) --------------------------------------

export type TestRunAuditEventType =
  | 'run-start'
  | 'test-start'
  | 'data-preparation-start'
  | 'data-preparation-end'
  | 'executor-selected'
  | 'step-start'
  | 'step-end'
  | 'assertion-start'
  | 'assertion-end'
  | 'evidence-added'
  | 'cleanup-start'
  | 'cleanup-end'
  | 'test-end'
  | 'run-end';

export interface TestRunAuditEvent {
  sequence: number;
  type: TestRunAuditEventType;
  testCaseId?: string;
  timestamp: string;
  message: string;
}

// ---- Test run result IR (spec §9) -----------------------------------------

export interface TestRunResultIR {
  schemaVersion: '1.0';
  runId: string;
  mode: TestRunMode;
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed' | 'partial' | 'error';
  testResults: TestExecutionResultIR[];
  summary: TestRunSummary;
  evidence: EvidenceReference[];
  auditTrail: TestRunAuditEvent[];
}

// ---- Test run policy (spec §38) -------------------------------------------

export interface TestRunPolicy {
  mode: TestRunMode;
  failFast: boolean;
  maxConcurrency: number;
  prepareData: boolean;
  cleanupAfterTest: boolean;
  collectEvidence: boolean;
  allowManual: boolean;
  testTimeoutMs: number;
  allowedTestExecutorTypes: TestExecutorType[];
}

// ---- Test execution context -----------------------------------------------

export interface TestExecutionContext {
  mode: TestRunMode;
  policy: TestRunPolicy;
  bindings: RuntimeBindingStore;
  secrets: SecretProvider;
  evidence: EvidenceCollector;
  audit: TestRunAuditRecorder;
  clock: Clock;
  runId: string;
  testCaseId: string;
  environmentId: string;
}

export interface TestRunAuditRecorder {
  record(event: Omit<TestRunAuditEvent, 'sequence' | 'timestamp'>): void;
  events(): TestRunAuditEvent[];
}

// ---- Clock abstraction (spec §56) -----------------------------------------

export interface Clock {
  now(): Date;
  nowIso(): string;
}

// ---- Run ID provider (spec §57) -------------------------------------------

export interface RunIdProvider {
  generate(): string;
}

// ---- Test run options -----------------------------------------------------

export interface TestRunOptions {
  policy?: Partial<TestRunPolicy>;
  clock?: Clock;
  runIdProvider?: RunIdProvider;
  environmentId?: string;
  secretProvider?: SecretProvider;
}

// ---- Manifest (spec §60) --------------------------------------------------

export interface TestRunManifest {
  schemaVersion: '1.0';
  runId: string;
  mode: TestRunMode;
  stats: {
    testsTotal: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    manual: number;
    errors: number;
    assertionsTotal: number;
    assertionsPassed: number;
    evidenceItems: number;
    cleanupFailures: number;
    durationMs: number;
  };
  executorBreakdown: Record<TestExecutorType, number>;
  warnings: TestExecutionWarning[];
}
