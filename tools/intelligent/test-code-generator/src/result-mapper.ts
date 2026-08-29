// Result mapper (spec §20, §21, §22).
//
// Maps real Playwright JSON reporter output into the canonical TestRunResultIR
// (reused from test-execution-orchestrator). Status taxonomy mirrors TIRAI
// semantics: PASS / FAIL (business assertion) / ERROR (infrastructure).
//
// Distinguishing FAIL vs ERROR (spec §33, §34): a test whose failure is an
// `expect` assertion failure is a business FAIL; any navigation/browser/
// connection/timeout failure is an infrastructure ERROR. This keeps generator
// failures distinct from test failures (spec §17, §22).

import type {
  TestRunResultIR,
  TestExecutionResultIR,
  TestResultStatus,
  TestExecutionError,
  TestProvenance,
  TestCase,
  ExecutionMappingIR,
} from './re-export.js';

export interface PlaywrightJsonReport {
  config?: { configFile?: string | null };
  suites?: PlaywrightSuite[];
  stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  startTime?: string;
  duration?: number;
}

export interface PlaywrightSuite {
  title?: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

export interface PlaywrightSpec {
  title: string;
  ok?: boolean;
  tests?: PlaywrightTest[];
  file?: string;
}

export interface PlaywrightTest {
  title: string;
  status?: string;
  duration?: number;
  errors?: Array<{ message?: string; stack?: string; snippet?: string }>;
  results?: Array<{
    status?: string;
    duration?: number;
    errors?: Array<{ message?: string; stack?: string; snippet?: string }>;
    error?: { message?: string; stack?: string };
  }>;
}

export interface MapContext {
  runId: string;
  framework: 'playwright';
  executionMode: 'GENERATED_E2E' | 'GENERATED_UNIT';
  startedAt: string;
  finishedAt: string;
  testCases: TestCase[];
  mapping: ExecutionMappingIR;
  /** Map of generated test title -> test case id (provided by generation result). */
  titleToTestCaseId: Map<string, string>;
}

function flattenSpecs(suites: PlaywrightSuite[] | undefined, out: PlaywrightSpec[]): void {
  if (!suites) return;
  for (const s of suites) {
    if (s.specs) out.push(...s.specs);
    if (s.suites) flattenSpecs(s.suites, out);
  }
}

export function isInfrastructureError(message: string): boolean {
  return /net::|ECONNREFUSED|ECONNRESET|Timeout .* exceeded|Target (page|context or browser) (has been closed|is closed)|browserType\.launch|Navigation failed|page\.goto|Failed to launch|Playwright|Executable|closed unexpectedly/i.test(
    message,
  );
}

/** Classify a single failed Playwright test into FAIL (business) or ERROR (infra). */
export function classifyFailure(
  errors: Array<{ message?: string }> | undefined,
): TestResultStatus {
  if (!errors || errors.length === 0) return 'failed';
  const combined = errors.map((e) => e.message ?? '').join('\n');
  return isInfrastructureError(combined) ? 'error' : 'failed';
}

function statusFor(
  status: string | undefined,
  errors: PlaywrightTest['errors'],
): TestResultStatus {
  switch (status) {
    case 'expected':
    case 'passed':
      return 'passed';
    case 'skipped':
      return 'skipped';
    case 'timedOut':
    case 'interrupted':
      return 'error';
    case 'unexpected':
    case 'failed':
      return classifyFailure(errors);
    default:
      return classifyFailure(errors);
  }
}

export interface MappedRun {
  result: TestRunResultIR;
  passed: number;
  failed: number;
  errors: number;
  blocked: number;
}

export function mapPlaywrightJsonToRunResult(
  report: PlaywrightJsonReport,
  ctx: MapContext,
): MappedRun {
  const specs: PlaywrightSpec[] = [];
  flattenSpecs(report.suites, specs);

  const testResults: TestExecutionResultIR[] = [];
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let blocked = 0;

  for (const spec of specs) {
    const test = spec.tests?.[spec.tests.length - 1];
    const results = test?.results ?? [];
    const lastResult = results[results.length - 1] ?? {};
    const pwStatus = (lastResult.status as string | undefined) ?? test?.status ?? 'failed';
    const errs = lastResult.errors ?? (lastResult.error ? [lastResult.error] : undefined) ?? test?.errors ?? [];
    const status = statusFor(pwStatus, errs);
    if (status === 'passed') passed++;
    else if (status === 'error') errors++;
    else if (status === 'failed') failed++;
    else if (status === 'blocked') blocked++;

    const testCaseId = ctx.titleToTestCaseId.get(spec.title) ?? spec.title;
    const tc = ctx.testCases.find((t) => t.id === testCaseId);
    const duration = (lastResult.duration as number | undefined) ?? test?.duration ?? 0;
    const startedAt = ctx.startedAt;
    const finishedAt = new Date(
      new Date(ctx.startedAt).getTime() + duration,
    ).toISOString();

    const mappedErrors: TestExecutionError[] = errs.map((e) => ({
      code: status === 'error' ? 'GENERATED_E2E_INFRASTRUCTURE' : 'GENERATED_E2E_ASSERTION',
      message: e.message ?? 'unknown error',
      retryable: false,
      executorType: 'ui',
    }));

    const provenance: TestProvenance[] = tc?.provenance ?? [];

    const result: TestExecutionResultIR = {
      schemaVersion: '1.0',
      runId: ctx.runId,
      testCaseId,
      scenarioId: tc?.scenarioId ?? '',
      requirementIds: tc?.requirementIds ?? [],
      status,
      phase: status === 'passed' ? 'completed' : 'failed',
      steps: [],
      assertions: [],
      evidence: [
        {
          id: `gen-evidence-${testCaseId}`,
          kind: 'playwright-result',
          path: spec.file ?? '',
          description: `GENERATED_E2E execution of '${spec.title}' (status=${status})`,
        } as unknown as TestExecutionResultIR['evidence'][number],
      ],
      runtimeBindings: [],
      cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
      errors: mappedErrors,
      warnings: [],
      provenance,
      timings: { startedAt, finishedAt, durationMs: duration },
    };
    testResults.push(result);
  }

  const total = testResults.length;
  const overall: TestRunResultIR['status'] =
    total === 0
      ? 'error'
      : errors > 0 && passed + failed === 0
        ? 'error'
        : failed > 0 && errors === 0
          ? 'failed'
          : errors > 0
            ? 'partial'
            : 'passed';

  const result: TestRunResultIR = {
    schemaVersion: '1.0',
    runId: ctx.runId,
    mode: 'execute',
    startedAt: ctx.startedAt,
    finishedAt: ctx.finishedAt,
    status: overall,
    testResults,
    summary: {
      testsTotal: total,
      passed,
      failed,
      blocked,
      skipped: 0,
      manual: 0,
      errors,
      assertionsTotal: 0,
      assertionsPassed: 0,
      assertionsFailed: 0,
      assertionsBlocked: 0,
      evidenceItems: testResults.length,
      cleanupFailures: 0,
      provenanceCoverage: total > 0 ? 1 : 0,
      durationMs: report.duration ?? 0,
    },
    evidence: [
      {
        id: `gen-run-evidence-${ctx.runId}`,
        kind: 'execution-mode',
        path: report.config?.configFile ?? '',
        description: `executionMode=${ctx.executionMode}; framework=${ctx.framework}`,
      } as unknown as TestRunResultIR['evidence'][number],
    ],
    auditTrail: [
      {
        sequence: 1,
        type: 'run-start',
        timestamp: ctx.startedAt,
        message: `GENERATED_E2E run started (framework=${ctx.framework})`,
      },
      {
        sequence: 2,
        type: 'run-end',
        timestamp: ctx.finishedAt,
        message: `GENERATED_E2E run finished (status=${overall}; passed=${passed}; failed=${failed}; errors=${errors})`,
      },
    ],
  };

  return { result, passed, failed, errors, blocked };
}

// ---- Vitest JSON normalization (Phase 5.4 integration gap) -----------------
//
// Mirrors mapPlaywrightJsonToRunResult but for the Vitest JSON reporter
// output emitted by `vitest run --reporter=json`. Real generated Unit code is
// executed by the actual Vitest CLI; this normalizes its reporter JSON into the
// canonical TestRunResultIR (reused from test-execution-orchestrator) so both
// GENERATED_E2E and GENERATED_UNIT branches share one result envelope.
//
// A Vitest assertion failure is a business FAIL; the Vitest runner does not
// emit infrastructure-error classification, so every non-passing result is
// treated as a business failure unless explicitly skipped.

export interface VitestAssertionResult {
  title: string;
  fullName?: string;
  status?: string;
  duration?: number;
  failureMessages?: string[];
}

export interface VitestFileResult {
  name?: string;
  status?: string;
  assertionResults?: VitestAssertionResult[];
  startTime?: number;
  endTime?: number;
  duration?: number;
}

export interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  startTime?: number;
  endTime?: number;
  duration?: number;
  testResults?: VitestFileResult[];
}

export interface VitestMapContext {
  runId: string;
  framework: 'vitest';
  executionMode: 'GENERATED_UNIT';
  startedAt: string;
  finishedAt: string;
  testCases: TestCase[];
  titleToTestCaseId: Map<string, string>;
}

function vitestStatus(status: string | undefined, failureMessages: string[] | undefined): TestResultStatus {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'skipped':
    case 'todo':
    case 'pending':
      return 'skipped';
    case 'failed':
    case 'unknown':
    default:
      // Vitest assertion failures are business FAIL; no infra classifier exists.
      return failureMessages && failureMessages.length > 0 ? 'failed' : 'failed';
  }
}

export function mapVitestJsonToRunResult(report: VitestJsonReport, ctx: VitestMapContext): MappedRun {
  const files = report.testResults ?? [];
  const testResults: TestExecutionResultIR[] = [];
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let blocked = 0;

  for (const file of files) {
    for (const assertion of file.assertionResults ?? []) {
      const status = vitestStatus(assertion.status, assertion.failureMessages);
      if (status === 'passed') passed++;
      else if (status === 'error') errors++;
      else if (status === 'failed') failed++;
      else if (status === 'blocked') blocked++;

      const testCaseId = ctx.titleToTestCaseId.get(assertion.title) ?? assertion.title;
      const tc = ctx.testCases.find((t) => t.id === testCaseId);
      const duration = assertion.duration ?? 0;
      const finishedAt = new Date(new Date(ctx.startedAt).getTime() + duration).toISOString();

      const mappedErrors: TestExecutionError[] = (assertion.failureMessages ?? []).map((m) => ({
        code: 'GENERATED_UNIT_ASSERTION',
        message: m,
        retryable: false,
        executorType: 'integration',
      }));

      testResults.push({
        schemaVersion: '1.0',
        runId: ctx.runId,
        testCaseId,
        scenarioId: tc?.scenarioId ?? '',
        requirementIds: tc?.requirementIds ?? [],
        status,
        phase: status === 'passed' ? 'completed' : 'failed',
        steps: [],
        assertions: [],
        evidence: [
          {
            id: `gen-unit-evidence-${testCaseId}`,
            kind: 'vitest-result',
            path: file.name ?? '',
            description: `GENERATED_UNIT execution of '${assertion.title}' (status=${status})`,
          } as unknown as TestExecutionResultIR['evidence'][number],
        ],
        runtimeBindings: [],
        cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
        errors: mappedErrors,
        warnings: [],
        provenance: tc?.provenance ?? [],
        timings: { startedAt: ctx.startedAt, finishedAt, durationMs: duration },
      });
    }
  }

  const total = testResults.length;
  const overall: TestRunResultIR['status'] =
    total === 0
      ? 'error'
      : errors > 0 && passed + failed === 0
        ? 'error'
        : failed > 0 && errors === 0
          ? 'failed'
          : errors > 0
            ? 'partial'
            : 'passed';

  const result: TestRunResultIR = {
    schemaVersion: '1.0',
    runId: ctx.runId,
    mode: 'execute',
    startedAt: ctx.startedAt,
    finishedAt: ctx.finishedAt,
    status: overall,
    testResults,
    summary: {
      testsTotal: total,
      passed,
      failed,
      blocked,
      skipped: 0,
      manual: 0,
      errors,
      assertionsTotal: 0,
      assertionsPassed: 0,
      assertionsFailed: 0,
      assertionsBlocked: 0,
      evidenceItems: testResults.length,
      cleanupFailures: 0,
      provenanceCoverage: total > 0 ? 1 : 0,
      durationMs: report.duration ?? 0,
    },
    evidence: [
      {
        id: `gen-unit-run-evidence-${ctx.runId}`,
        kind: 'execution-mode',
        path: '',
        description: `executionMode=${ctx.executionMode}; framework=${ctx.framework}`,
      } as unknown as TestRunResultIR['evidence'][number],
    ],
    auditTrail: [
      {
        sequence: 1,
        type: 'run-start',
        timestamp: ctx.startedAt,
        message: `GENERATED_UNIT run started (framework=${ctx.framework})`,
      },
      {
        sequence: 2,
        type: 'run-end',
        timestamp: ctx.finishedAt,
        message: `GENERATED_UNIT run finished (status=${overall}; passed=${passed}; failed=${failed}; errors=${errors})`,
      },
    ],
  };

  return { result, passed, failed, errors, blocked };
}
