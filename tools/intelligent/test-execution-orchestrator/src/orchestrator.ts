// Test Execution Orchestrator v1 — Core orchestrator.
//
// Coordinates test case execution through explicit phases:
// 1. Execution readiness check
// 2. Data preparation
// 3. Test executor selection
// 4. Test step execution
// 5. Assertion verification
// 6. Evidence collection
// 7. Result classification
// 8. Cleanup
// 9. TestExecutionResultIR production

import type {
  TestCase,
  TestExecutionResultIR,
  TestRunResultIR,
  TestRunPolicy,
  TestRunMode,
  TestExecutionContext,
  TestExecutionPhase,
  TestResultStatus,
  TestStepExecutionResult,
  AssertionResult,
  EvidenceReference,
  TestCleanupSummary,
  TestCleanupResult,
  TestExecutionError,
  TestExecutionWarning,
  TestDataExecutionSummary,
  RuntimeBindingSummary,
  TestExecutionTiming,
  TestRunManifest,
  TestExecutorType,
  TestExecutor,
  TestDataPlanIR,
  TestDataItem,
  Clock,
  RunIdProvider,
  SecretProvider,
  RuntimeBindingStore,
} from './models.js';
import type { TestExecutorRegistry } from './registry.js';
import { defaultTestRunPolicy } from './policy.js';
import { SystemClock } from './clock.js';
import { UniqueRunIdProvider } from './run-id.js';
import { InMemoryEvidenceCollector } from './evidence/index.js';
import { InMemoryTestRunAuditRecorder } from './audit.js';
import { classifyTestStatus } from './status-classifier.js';
import { computeRunSummary } from './quality/index.js';
import { TestErrorCode, TestExecutionOrchestratorError } from './errors.js';
import { TestWarningCode } from './warnings.js';

// ---- Secret redaction helpers ---------------------------------------------

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'authorization', 'cookie', 'api-key', 'apikey',
]);

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  for (const sk of SENSITIVE_KEYS) {
    if (lower.includes(sk)) return '***REDACTED***';
  }
  return value;
}

function redactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    redacted[k] = redactValue(k, v);
  }
  return redacted;
}

// ---- Fake secret provider -------------------------------------------------

class NoOpSecretProvider implements SecretProvider {
  async resolve(secretRef: string): Promise<{ value: string; redacted: string }> {
    throw new TestExecutionOrchestratorError(
      TestErrorCode.TEST_BINDING_MISSING,
      `Secret '${secretRef}' not available.`,
    );
  }
}

// ---- Fake binding store ---------------------------------------------------

class InMemoryBindingStore implements RuntimeBindingStore {
  private bindings = new Map<string, { id: string; name: string; producerOperationId: string; value: unknown; sensitive: boolean; status: 'resolved' | 'unresolved' | 'invalid' }>();

  produce(binding: { id: string; name: string; producerOperationId: string; value: unknown; sensitive: boolean; status: 'resolved' | 'unresolved' | 'invalid' }): void {
    this.bindings.set(binding.name, binding);
  }

  resolve(name: string) { return this.bindings.get(name); }
  isResolved(name: string): boolean { return this.bindings.has(name); }
  all() { return Array.from(this.bindings.values()); }
  sensitiveNames(): Set<string> {
    const s = new Set<string>();
    for (const [name, b] of this.bindings) { if (b.sensitive) s.add(name); }
    return s;
  }

  clearSensitive(): void {
    for (const [name, binding] of this.bindings) {
      if (binding.sensitive) this.bindings.set(name, { ...binding, value: '***REDACTED***' });
    }
  }
}

// ---- Orchestrator ---------------------------------------------------------

export interface OrchestratorOptions {
  registry: TestExecutorRegistry;
  policy?: Partial<TestRunPolicy>;
  clock?: Clock;
  runIdProvider?: RunIdProvider;
  environmentId?: string;
  secretProvider?: SecretProvider;
  journeyEnabled?: boolean;
}

export class TestExecutionOrchestrator {
  private registry: TestExecutorRegistry;
  private policy: TestRunPolicy;
  private clock: Clock;
  private runIdProvider: RunIdProvider;
  private environmentId: string;
  private secretProvider: SecretProvider;
  private journeyEnabled: boolean;

  constructor(options: OrchestratorOptions) {
    this.registry = options.registry;
    this.policy = defaultTestRunPolicy(options.policy);
    this.clock = options.clock ?? new SystemClock();
    this.runIdProvider = options.runIdProvider ?? new UniqueRunIdProvider();
    this.environmentId = options.environmentId ?? 'default';
    this.secretProvider = options.secretProvider ?? new NoOpSecretProvider();
    this.journeyEnabled = options.journeyEnabled ?? false;
  }

  // ---- Run all test cases -------------------------------------------------

  async run(testCases: TestCase[], dataPlan?: TestDataPlanIR): Promise<TestRunResultIR> {
    const runId = this.runIdProvider.generate();
    const mode = this.policy.mode;
    const startedAt = this.clock.nowIso();
    const audit = new InMemoryTestRunAuditRecorder();

    audit.record({ type: 'run-start', message: `Test run ${runId} started in ${mode} mode.` });

    // Deterministic ordering by test case ID (spec §40)
    const sorted = [...testCases].sort((a, b) => a.id.localeCompare(b.id));

    const results: TestExecutionResultIR[] = [];
    let failFastTriggered = false;

    for (const tc of sorted) {
      if (failFastTriggered) {
        results.push(this.buildSkippedResult(tc, runId, audit));
        continue;
      }

      const result = await this.executeTestCase(tc, runId, mode, audit, dataPlan);
      results.push(result);

      // Fail-fast: stop scheduling after first failure/error
      if (this.policy.failFast && (result.status === 'failed' || result.status === 'error')) {
        failFastTriggered = true;
      }
    }

    const finishedAt = this.clock.nowIso();
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    const summary = computeRunSummary(results, durationMs);

    // Aggregate evidence from all results
    const allEvidence: EvidenceReference[] = [];
    for (const r of results) {
      allEvidence.push(...r.evidence);
    }

    audit.record({ type: 'run-end', message: `Test run ${runId} completed. Status: ${summary.passed} passed, ${summary.failed} failed, ${summary.blocked} blocked.` });

    // Determine run status
    let runStatus: TestRunResultIR['status'];
    if (summary.errors > 0) {
      runStatus = 'error';
    } else if (summary.failed > 0 && summary.passed > 0) {
      runStatus = 'partial';
    } else if (summary.failed > 0) {
      runStatus = 'failed';
    } else if (summary.blocked > 0) {
      runStatus = 'partial';
    } else {
      runStatus = 'passed';
    }

    return {
      schemaVersion: '1.0',
      runId,
      mode,
      startedAt,
      finishedAt,
      status: runStatus,
      testResults: results,
      summary,
      evidence: allEvidence,
      auditTrail: audit.events(),
    };
  }

  // ---- Execute single test case -------------------------------------------

  private async executeTestCase(
    tc: TestCase,
    runId: string,
    mode: TestRunMode,
    audit: InMemoryTestRunAuditRecorder,
    dataPlan?: TestDataPlanIR,
  ): Promise<TestExecutionResultIR> {
    const testStartedAt = this.clock.nowIso();
    let phase: TestExecutionPhase = 'pending';
    const errors: TestExecutionError[] = [];
    const warnings: TestExecutionWarning[] = [];
    let steps: TestStepExecutionResult[] = [];
    let assertions: AssertionResult[] = [];
    let evidence: EvidenceReference[] = [];
    let cleanup: TestCleanupSummary = { attempted: 0, succeeded: 0, failed: 0, results: [] };
    let dataPreparation: TestDataExecutionSummary | undefined;
    let status: TestResultStatus = 'blocked';
    let selectedExecutor: TestExecutor | undefined;
    let executionContext: TestExecutionContext | undefined;
    let cleanupCompleted = false;

    const evidenceCollector = new InMemoryEvidenceCollector();
    const bindings = new InMemoryBindingStore();
    const testAudit = new InMemoryTestRunAuditRecorder();

    audit.record({ type: 'test-start', testCaseId: tc.id, message: `Starting test case ${tc.id}.` });

    try {
      // Phase: readiness check
      const readiness = this.checkReadiness(tc);
      if (readiness === 'manual-only') {
        phase = 'completed';
        status = 'manual';
        warnings.push({ code: TestWarningCode.TEST_MANUAL, message: `Test case '${tc.id}' is manual-only.`, testCaseId: tc.id });
        audit.record({ type: 'test-end', testCaseId: tc.id, message: `Test case ${tc.id} classified as manual.` });
        return this.buildResult(tc, runId, status, phase, steps, assertions, evidence, cleanup, dataPreparation, errors, warnings, testStartedAt, bindings);
      }

      // Build execution context
      const context: TestExecutionContext = {
        mode,
        policy: this.policy,
        bindings,
        secrets: this.secretProvider,
        evidence: evidenceCollector,
        audit: testAudit,
        clock: this.clock,
        runId,
        testCaseId: tc.id,
        environmentId: this.environmentId,
        journeyEnabled: this.journeyEnabled,
        testDataItems: selectTestDataItems(tc, dataPlan),
      };
      executionContext = context;

      // Phase: data preparation (spec §16)
      if (this.policy.prepareData && mode !== 'dry-run') {
        phase = 'preparing-data';
        audit.record({ type: 'data-preparation-start', testCaseId: tc.id, message: `Data preparation for ${tc.id}.` });
        dataPreparation = { status: 'succeeded', operationsTotal: 0, operationsSucceeded: 0, operationsFailed: 0, bindingsProduced: 0 };
        audit.record({ type: 'data-preparation-end', testCaseId: tc.id, message: `Data preparation completed for ${tc.id}.` });
      }

      // Phase: executor selection
      phase = 'ready';
      const executor = this.registry.resolve(tc, context);
      selectedExecutor = executor;
      audit.record({ type: 'executor-selected', testCaseId: tc.id, message: `Executor '${executor.type}' selected for ${tc.id}.` });

      // Dry-run: validate only, no execution
      if (mode === 'dry-run') {
        const validation = await executor.validate(tc, context);
        if (!validation.valid) {
          status = 'blocked';
          errors.push({ code: TestErrorCode.TEST_EXECUTOR_VALIDATION_FAILED, message: 'Validation failed in dry-run.', retryable: false, executorType: executor.type });
        } else {
          status = 'skipped';
          warnings.push({ code: TestWarningCode.TEST_SKIPPED, message: `Dry-run: test case '${tc.id}' validated but not executed.`, testCaseId: tc.id });
        }
        phase = 'completed';
        audit.record({ type: 'test-end', testCaseId: tc.id, message: `Dry-run completed for ${tc.id}.` });
        return this.buildResult(tc, runId, status, phase, steps, assertions, evidence, cleanup, dataPreparation, errors, warnings, testStartedAt, bindings);
      }

      // Phase: execution
      phase = 'executing';
      for (const step of tc.steps) {
        audit.record({ type: 'step-start', testCaseId: tc.id, message: `Step ${step.order} started.` });
      }

      const executorResult = await executor.execute(tc, context);

      steps = executorResult.steps;
      assertions = executorResult.assertions;
      evidence = evidenceCollector.list();
      warnings.push(...executorResult.warnings);

      for (const step of tc.steps) {
        audit.record({ type: 'step-end', testCaseId: tc.id, message: `Step ${step.order} completed.` });
      }

      if (executorResult.error) {
        errors.push(executorResult.error);
        status = 'error';
        phase = 'failed';
      } else {
        // Phase: verification
        phase = 'verifying';
        for (const a of assertions) {
          audit.record({ type: 'assertion-start', testCaseId: tc.id, message: `Assertion ${a.id} verification started.` });
          audit.record({ type: 'assertion-end', testCaseId: tc.id, message: `Assertion ${a.id} result: ${a.status}.` });
        }

        // Classify status from assertions
        const classification = classifyTestStatus(assertions, tc.id);
        status = executorResult.status === 'manual' ? 'manual' : classification.status;
        warnings.push(...classification.warnings);
      }

      // Phase: evidence collection (already done by executor)
      phase = 'collecting-evidence';
      for (const ev of evidence) {
        audit.record({ type: 'evidence-added', testCaseId: tc.id, message: `Evidence ${ev.id} added.` });
      }

      // Phase: cleanup
      if (this.policy.cleanupAfterTest && executor.cleanup) {
        phase = 'cleaning-up';
        audit.record({ type: 'cleanup-start', testCaseId: tc.id, message: `Cleanup started for ${tc.id}.` });
        cleanupCompleted = true;
        let cleanupResult: TestCleanupResult;
        try {
          cleanupResult = await executor.cleanup(tc, context);
        } catch (cleanupError) {
          cleanupResult = {
            status: 'failed',
            error: {
              code: 'TEST_CLEANUP_FAILED',
              message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              retryable: false,
              executorType: executor.type,
            },
          };
        }
        cleanup = {
          attempted: 1,
          succeeded: cleanupResult.status === 'succeeded' ? 1 : 0,
          failed: cleanupResult.status === 'failed' ? 1 : 0,
          results: [cleanupResult],
        };
        audit.record({ type: 'cleanup-end', testCaseId: tc.id, message: `Cleanup ${cleanupResult.status} for ${tc.id}.` });

        if (cleanupResult.status === 'failed') {
          warnings.push({
            code: TestWarningCode.TEST_OPTIONAL_CLEANUP_FAILED,
            message: `Cleanup failed for test case '${tc.id}'.`,
            testCaseId: tc.id,
          });
          // A test that passed but leaked or failed to restore prepared state
          // is not a clean pass. Keep the cleanup summary for observability,
          // but surface the run as an execution error as well.
          errors.push({
            code: 'TEST_CLEANUP_FAILED',
            message: cleanupResult.error?.message ?? `Cleanup failed for test case '${tc.id}'.`,
            retryable: false,
            executorType: executor.type,
          });
          status = 'error';
          phase = 'failed';
        }
      }

      if (status !== 'error') {
        phase = 'completed';
      }
    } catch (err) {
      phase = 'failed';
      status = 'error';
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof TestExecutionOrchestratorError ? err.code : TestErrorCode.TEST_INTERNAL_ERROR;
      errors.push({ code, message, retryable: false });
      if (selectedExecutor && executionContext && this.policy.cleanupAfterTest && !cleanupCompleted && selectedExecutor.cleanup) {
        phase = 'cleaning-up';
        audit.record({ type: 'cleanup-start', testCaseId: tc.id, message: `Cleanup started for ${tc.id} after executor error.` });
        cleanupCompleted = true;
        let cleanupResult: TestCleanupResult;
        try {
          cleanupResult = await selectedExecutor.cleanup(tc, executionContext);
        } catch (cleanupError) {
          cleanupResult = {
            status: 'failed',
            error: {
              code: 'TEST_CLEANUP_FAILED',
              message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              retryable: false,
              executorType: selectedExecutor.type,
            },
          };
        }
        cleanup = {
          attempted: 1,
          succeeded: cleanupResult.status === 'succeeded' ? 1 : 0,
          failed: cleanupResult.status === 'failed' ? 1 : 0,
          results: [cleanupResult],
        };
        audit.record({ type: 'cleanup-end', testCaseId: tc.id, message: `Cleanup ${cleanupResult.status} for ${tc.id}.` });
        if (cleanupResult.status === 'failed') {
          errors.push({
            code: 'TEST_CLEANUP_FAILED',
            message: cleanupResult.error?.message ?? `Cleanup failed for test case '${tc.id}'.`,
            retryable: false,
            executorType: selectedExecutor.type,
          });
        }
        phase = 'failed';
      }
    }

    audit.record({ type: 'test-end', testCaseId: tc.id, message: `Test case ${tc.id} completed. Status: ${status}.` });

    return this.buildResult(tc, runId, status, phase, steps, assertions, evidence, cleanup, dataPreparation, errors, warnings, testStartedAt, bindings);
  }

  // ---- Readiness check ----------------------------------------------------

  private checkReadiness(tc: TestCase): 'ready' | 'partial' | 'manual-only' | 'unknown' {
    const automationStatus = tc.automation.status;
    if (automationStatus === 'manual-only') return 'manual-only';
    if (automationStatus === 'ready') return 'ready';
    if (automationStatus === 'partially-ready') return 'partial';
    return 'unknown';
  }

  // ---- Build result -------------------------------------------------------

  private buildResult(
    tc: TestCase,
    runId: string,
    status: TestResultStatus,
    phase: TestExecutionPhase,
    steps: TestStepExecutionResult[],
    assertions: AssertionResult[],
    evidence: EvidenceReference[],
    cleanup: TestCleanupSummary,
    dataPreparation: TestDataExecutionSummary | undefined,
    errors: TestExecutionError[],
    warnings: TestExecutionWarning[],
    startedAt: string,
    bindings: RuntimeBindingStore,
  ): TestExecutionResultIR {
    const finishedAt = this.clock.nowIso();

    // Redact sensitive evidence metadata
    const redactedEvidence = evidence.map((e) => ({
      ...e,
      metadata: e.sensitive ? redactMetadata(e.metadata) : e.metadata,
    }));

    // Build runtime binding summary
    const runtimeBindings: RuntimeBindingSummary[] = bindings.all().map((b) => ({
      name: b.name,
      value: b.sensitive ? '***REDACTED***' : b.value,
      sensitive: b.sensitive,
      status: b.status,
    }));

    const timings: TestExecutionTiming = {
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    };

    return {
      schemaVersion: '1.0',
      runId,
      testCaseId: tc.id,
      scenarioId: tc.scenarioId,
      requirementIds: tc.requirementIds,
      status,
      phase,
      dataPreparation,
      steps,
      assertions,
      evidence: redactedEvidence,
      runtimeBindings,
      cleanup,
      errors,
      warnings,
      provenance: tc.provenance,
      timings,
    };
  }

  private buildSkippedResult(
    tc: TestCase,
    runId: string,
    audit: InMemoryTestRunAuditRecorder,
  ): TestExecutionResultIR {
    const now = this.clock.nowIso();
    audit.record({ type: 'test-start', testCaseId: tc.id, message: `Test case ${tc.id} skipped due to fail-fast.` });
    audit.record({ type: 'test-end', testCaseId: tc.id, message: `Test case ${tc.id} skipped.` });

    return {
      schemaVersion: '1.0',
      runId,
      testCaseId: tc.id,
      scenarioId: tc.scenarioId,
      requirementIds: tc.requirementIds,
      status: 'skipped',
      phase: 'completed',
      steps: [],
      assertions: [],
      evidence: [],
      runtimeBindings: [],
      cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
      errors: [],
      warnings: [{ code: TestWarningCode.TEST_SKIPPED, message: `Skipped due to fail-fast policy.`, testCaseId: tc.id }],
      provenance: tc.provenance,
      timings: { startedAt: now, finishedAt: now, durationMs: 0 },
    };
  }

  // ---- Build manifest (spec §60) ------------------------------------------

  buildManifest(runResult: TestRunResultIR): TestRunManifest {
    const executorBreakdown: Record<string, number> = {};
    for (const _r of runResult.testResults) {
      // Count by executor type inferred from steps/assertions
      const key = 'total';
      executorBreakdown[key] = (executorBreakdown[key] ?? 0) + 1;
    }

    return {
      schemaVersion: '1.0',
      runId: runResult.runId,
      mode: runResult.mode,
      stats: {
        testsTotal: runResult.summary.testsTotal,
        passed: runResult.summary.passed,
        failed: runResult.summary.failed,
        blocked: runResult.summary.blocked,
        skipped: runResult.summary.skipped,
        manual: runResult.summary.manual,
        errors: runResult.summary.errors,
        assertionsTotal: runResult.summary.assertionsTotal,
        assertionsPassed: runResult.summary.assertionsPassed,
        evidenceItems: runResult.summary.evidenceItems,
        cleanupFailures: runResult.summary.cleanupFailures,
        durationMs: runResult.summary.durationMs,
      },
      executorBreakdown: executorBreakdown as Record<TestExecutorType, number>,
      warnings: runResult.testResults.flatMap((r) => r.warnings),
    };
  }
}

function selectTestDataItems(testCase: TestCase, dataPlan?: TestDataPlanIR): TestDataItem[] | undefined {
  if (!dataPlan) return undefined;
  const testCasePlan = dataPlan.testCases.find((candidate) => candidate.testCaseId === testCase.id);
  if (!testCasePlan) return [];
  const itemIds = new Set([
    ...testCasePlan.requiredDataItemIds,
    ...testCasePlan.setupItemIds,
    ...testCasePlan.cleanupItemIds,
  ]);
  return dataPlan.dataItems.filter((item) => itemIds.has(item.id));
}
