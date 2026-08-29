// Unit (Vitest) execution bridge (spec §18, §19, §28).
//
// Thin, independent shim around the Vitest CLI. No Agentic Test Executor, no AI
// Provider, no agentic fallback (spec §19). A generated unit test that fails
// fails as a generated test, never as an agentic run.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';

import type {
  UnitExecutionResult,
  UnitExecutionMetrics,
  UnitGenerationResult,
  TestCase,
  TestRunResultIR,
} from './models.js';
import { validateGeneratedUnitSource } from './validation.js';
import {
  mapPlaywrightJsonToRunResult,
  type PlaywrightJsonReport,
  type PlaywrightSuite,
} from './result-mapper.js';

const execFileAsync = promisify(execFile);

export interface UnitExecuteOptions {
  generationResult: UnitGenerationResult;
  testCases: TestCase[];
  /** Directory used by Vitest to resolve relative imports of the generated specs. */
  resolveDir: string;
  /** Absolute path to the dedicated executor vitest config (avoids test rotation). */
  vitestConfigPath?: string;
  vitestBin?: string;
  jsonOutputPath?: string;
  timeoutMs?: number;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('No JSON found in Vitest output');
  const end = text.lastIndexOf('}');
  const slice = text.slice(start, end + 1);
  return JSON.parse(slice);
}

/** Normalize Vitest JSON reporter output into the Playwright-shaped report. */
function normalizeVitestToPlaywright(vitest: any): PlaywrightJsonReport {
  const source = vitest?.testResults as
    | Array<{
        name?: string;
        assertionResults?: Array<{
          title?: string;
          status?: string;
          failureMessages?: string[];
          ancestorTitles?: string[];
        }>;
      }>
    | undefined;

  const suites: PlaywrightSuite[] = [];
  if (source && Array.isArray(source)) {
    for (const tr of source) {
      const file = tr.name ?? '';
      const specs = (tr.assertionResults ?? []).map((ar) => ({
        title: ar.title ?? '',
        file,
        tests: [
          {
            title: ar.title ?? '',
            status: ar.status === 'passed' ? 'passed' : 'failed',
            results: [
              {
                status: ar.status === 'passed' ? 'expected' : 'unexpected',
                errors: (ar.failureMessages ?? []).map((m) => ({ message: m })),
              },
            ],
          },
        ],
      }));
      suites.push({ title: '', file, specs });
    }
  } else if (vitest?.suites) {
    // Fallback: walk vitest suites/tests directly.
    for (const s of vitest.suites as any[]) {
      const file = s.file ?? '';
      const specs = (s.tests ?? []).map((t: any) => ({
        title: t.name ?? '',
        file,
        tests: [
          {
            title: t.name ?? '',
            status: t.status === 'passed' ? 'passed' : 'failed',
            results: [
              {
                status: t.status === 'passed' ? 'expected' : 'unexpected',
                errors: (t.failureMessages ?? []).map((m: string) => ({ message: m })),
              },
            ],
          },
        ],
      }));
      suites.push({ title: s.name ?? '', file, specs });
    }
  }

  return { suites, config: { configFile: vitest?.configFile ?? null } };
}

export async function executeUnitTests(
  opts: UnitExecuteOptions,
): Promise<UnitExecutionResult> {
  const logs: string[] = [];
  const metrics: UnitExecutionMetrics = {
    validationAttempts: 0,
    validationPassed: 0,
    validationFailed: 0,
    vitestExecutionAttempts: 0,
    vitestPassed: 0,
    vitestFailed: 0,
    vitestErrors: 0,
    executionAiCalls: 0,
    agenticFallbacks: 0,
    aiSymbolGuesses: 0,
  };

  const titleToTestCaseId = new Map<string, string>();
  for (const tc of opts.testCases) titleToTestCaseId.set(tc.title, tc.id);

  // ---- Static validation first (spec §17) ---------------------------------
  let allValid = true;
  for (const file of opts.generationResult.generatedFiles) {
    metrics.validationAttempts++;
    const outcome = validateGeneratedUnitSource(file, { resolveDir: opts.resolveDir });
    if (outcome.status === 'valid') metrics.validationPassed++;
    else {
      metrics.validationFailed++;
      allValid = false;
      logs.push(`VALIDATION_FAILED ${file}: ${outcome.errors.join('; ')}`);
    }
  }

  if (!allValid) {
    logs.push('STATIC_VALIDATION_FAILED: Vitest execution skipped (spec §32).');
    return {
      executionMode: 'GENERATED_UNIT',
      framework: 'vitest',
      result: emptyRun(opts),
      metrics,
      logs,
    };
  }

  // ---- Independent Vitest execution (spec §18, §28) -----------------------
  metrics.vitestExecutionAttempts = 1;
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();
  try {
    const bin = opts.vitestBin ?? 'npx';
    const baseArgs =
      bin === 'npx'
        ? ['vitest', 'run']
        : ['run'];
    const configArgs = opts.vitestConfigPath ? ['--config', opts.vitestConfigPath] : [];
    const args = [
      ...baseArgs,
      ...configArgs,
      '--reporter=json',
      '--no-color',
      ...opts.generationResult.generatedFiles,
    ];
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: opts.timeoutMs ?? 180_000,
      cwd: opts.resolveDir,
      env: { ...process.env },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (stderr) logs.push(`vitest-stderr: ${stderr.split('\n')[0]}`);
    const vitestJson = extractJson(stdout) as any;
    if (opts.jsonOutputPath) {
      writeFileSync(opts.jsonOutputPath, JSON.stringify(vitestJson, null, 2), 'utf8');
    }
    const report = normalizeVitestToPlaywright(vitestJson);
    return finish(opts, report, metrics, logs, startedAt, finishedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`vitest-exec-error: ${message.split('\n')[0]}`);
    const captured = (err as { stdout?: string })?.stdout;
    if (captured && captured.includes('{')) {
      try {
        const vitestJson = extractJson(captured) as any;
        if (opts.jsonOutputPath) {
          writeFileSync(opts.jsonOutputPath, JSON.stringify(vitestJson, null, 2), 'utf8');
        }
        const report = normalizeVitestToPlaywright(vitestJson);
        return finish(opts, report, metrics, logs, startedAt, finishedAt);
      } catch {
        /* fall through */
      }
    }
    return {
      executionMode: 'GENERATED_UNIT',
      framework: 'vitest',
      result: emptyRun(opts),
      metrics,
      logs,
    };
  }
}

function finish(
  opts: UnitExecuteOptions,
  report: PlaywrightJsonReport,
  metrics: UnitExecutionMetrics,
  logs: string[],
  startedAt: string,
  finishedAt: string,
): UnitExecutionResult {
  const titleToTestCaseId = new Map<string, string>();
  for (const tc of opts.testCases) titleToTestCaseId.set(tc.title, tc.id);
  const mapped = mapPlaywrightJsonToRunResult(report, {
    runId: `gen-unit-run-${startedAt}`,
    framework: 'playwright', // reused taxonomy; the report is already normalized
    executionMode: 'GENERATED_UNIT',
    startedAt,
    finishedAt,
    testCases: opts.testCases,
    mapping: { testMappings: [], unresolved: [], catalogs: {} } as any,
    titleToTestCaseId,
  });
  metrics.vitestPassed = mapped.passed;
  metrics.vitestFailed = mapped.failed;
  metrics.vitestErrors = mapped.errors;

  appendBlockedCases(mapped.result, opts, startedAt, finishedAt);
  return {
    executionMode: 'GENERATED_UNIT',
    framework: 'vitest',
    result: mapped.result,
    metrics,
    logs,
  };
}

function appendBlockedCases(
  result: TestRunResultIR,
  opts: UnitExecuteOptions,
  startedAt: string,
  finishedAt: string,
): void {
  const blocked = opts.generationResult.caseResults.filter((c) => c.status === 'blocked');
  for (const b of blocked) {
    result.testResults.push({
      schemaVersion: '1.0',
      runId: result.runId,
      testCaseId: b.testCaseId,
      scenarioId: opts.testCases.find((t) => t.id === b.testCaseId)?.scenarioId ?? '',
      requirementIds: opts.testCases.find((t) => t.id === b.testCaseId)?.requirementIds ?? [],
      status: 'blocked',
      phase: 'blocked',
      steps: [],
      assertions: [],
      evidence: [],
      runtimeBindings: [],
      cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
      errors: [
        {
          code: 'GENERATED_UNIT_BLOCKED',
          message: b.blockingReason?.message ?? 'generation blocked',
          retryable: false,
          executorType: 'integration',
        },
      ],
      warnings: [],
      provenance: opts.testCases.find((t) => t.id === b.testCaseId)?.provenance ?? [],
      timings: { startedAt, finishedAt, durationMs: 0 },
    });
    result.summary.testsTotal++;
    result.summary.blocked++;
  }
}

function emptyRun(_opts: UnitExecuteOptions): TestRunResultIR {
  return {
    schemaVersion: '1.0',
    runId: `gen-unit-run-empty-${Date.now()}`,
    mode: 'execute',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'error',
    testResults: [],
    summary: {
      testsTotal: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      manual: 0,
      errors: 0,
      assertionsTotal: 0,
      assertionsPassed: 0,
      assertionsFailed: 0,
      assertionsBlocked: 0,
      evidenceItems: 0,
      cleanupFailures: 0,
      provenanceCoverage: 0,
      durationMs: 0,
    },
    evidence: [],
    auditTrail: [],
  };
}
