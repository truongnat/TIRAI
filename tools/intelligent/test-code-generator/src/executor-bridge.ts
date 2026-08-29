// Execution bridge (spec §18, §19, §28).
//
// Thin, independent shim around the Playwright CLI. It does NOT use the Agentic
// Test Executor, Journey Planner, Recovery Planner, or any AI Provider. There is
// no agentic fallback (spec §19): if generated execution fails, it fails as a
// generated test, never as an agentic run.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  GeneratedTestExecutionResult,
  ExecutionMetrics,
  TestCodeGenerationResult,
  TestCodeGenerationInput,
} from './models.js';
import { validateGeneratedSource } from './validation.js';
import {
  mapPlaywrightJsonToRunResult,
  type PlaywrightJsonReport,
} from './result-mapper.js';

const execFileAsync = promisify(execFile);

export interface ExecuteOptions {
  configPath: string;
  generationResult: TestCodeGenerationResult;
  input: TestCodeGenerationInput;
  env?: Record<string, string>;
  playwrightBin?: string;
  jsonOutputPath?: string;
  timeoutMs?: number;
}

function extractJson(stdout: string): PlaywrightJsonReport {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('No JSON found in Playwright output');
  const end = stdout.lastIndexOf('}');
  const slice = stdout.slice(start, end + 1);
  return JSON.parse(slice) as PlaywrightJsonReport;
}

export async function executeGeneratedTests(
  opts: ExecuteOptions,
): Promise<GeneratedTestExecutionResult> {
  const logs: string[] = [];
  const metrics: ExecutionMetrics = {
    validationAttempts: 0,
    validationPassed: 0,
    validationFailed: 0,
    playwrightExecutionAttempts: 0,
    playwrightPassed: 0,
    playwrightFailed: 0,
    playwrightErrors: 0,
    executionAiCalls: 0,
    agenticFallbacks: 0,
  };

  const titleToTestCaseId = new Map<string, string>();
  for (const tc of opts.input.testCases) {
    titleToTestCaseId.set(tc.title, tc.id);
  }

  // ---- Static validation first (spec §17) ---------------------------------
  // Parse-only validation (no Playwright webServer spin-up here). Independent
  // discovery is performed by the execution run below, which is the canonical
  // acceptance of "Playwright accepts the generated file" (matrix C).
  let allValid = true;
  for (const file of opts.generationResult.generatedFiles) {
    metrics.validationAttempts++;
    const outcome = await validateGeneratedSource(file);
    if (outcome.status === 'valid') {
      metrics.validationPassed++;
    } else {
      metrics.validationFailed++;
      allValid = false;
      logs.push(`VALIDATION_FAILED ${file}: ${outcome.errors.join('; ')}`);
    }
  }

  // If any generated file is invalid, never attempt Playwright execution.
  if (!allValid) {
    logs.push('STATIC_VALIDATION_FAILED: Playwright execution skipped (spec §32).');
    return {
      executionMode: 'GENERATED_E2E',
      framework: 'playwright',
      result: emptyRun(opts),
      metrics,
      logs,
    };
  }

  // ---- Independent Playwright execution (spec §18, §28) --------------------
  metrics.playwrightExecutionAttempts = 1;
  const startedAt = new Date().toISOString();
  try {
    const bin = opts.playwrightBin ?? 'npx';
    const args =
      bin === 'npx'
        ? ['playwright', 'test', '--config', opts.configPath, '--reporter=json', '--workers=1']
        : ['test', '--config', opts.configPath, '--reporter=json', '--workers=1'];
    const spawnEnv = { ...process.env, ...(opts.env ?? {}) };
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: opts.timeoutMs ?? 180_000,
      cwd: dirname(opts.configPath),
      env: spawnEnv,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (stderr) logs.push(`playwright-stderr: ${stderr.split('\n')[0]}`);
    const report = extractJson(stdout);
    if (opts.jsonOutputPath) {
      writeFileSync(opts.jsonOutputPath, stdout.slice(stdout.indexOf('{')), 'utf8');
    }
    const finishedAt = new Date().toISOString();
    const mapped = mapPlaywrightJsonToRunResult(report, {
      runId: `gen-run-${startedAt}`,
      framework: 'playwright',
      executionMode: 'GENERATED_E2E',
      startedAt,
      finishedAt,
      testCases: opts.input.testCases,
      mapping: opts.input.mapping,
      titleToTestCaseId,
    });
    metrics.playwrightPassed = mapped.passed;
    metrics.playwrightFailed = mapped.failed;
    metrics.playwrightErrors = mapped.errors;

    appendBlockedCases(mapped, opts, startedAt, finishedAt);

    return {
      executionMode: 'GENERATED_E2E',
      framework: 'playwright',
      result: mapped.result,
      metrics,
      playwrightJsonPath: opts.jsonOutputPath,
      logs,
    };
  } catch (err) {
    // Playwright exits non-zero on test failures; that is expected. Only treat
    // true spawn/parse failures as bridge errors.
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`playwright-exec-error: ${message.split('\n')[0]}`);
    // Attempt to recover JSON from captured output if present.
    const captured = (err as { stdout?: string })?.stdout;
    if (captured && captured.includes('{')) {
      try {
        const report = extractJson(captured);
        const finishedAt = new Date().toISOString();
        const mapped = mapPlaywrightJsonToRunResult(report, {
          runId: `gen-run-${startedAt}`,
          framework: 'playwright',
          executionMode: 'GENERATED_E2E',
          startedAt,
          finishedAt,
          testCases: opts.input.testCases,
          mapping: opts.input.mapping,
          titleToTestCaseId,
        });
        metrics.playwrightPassed = mapped.passed;
        metrics.playwrightFailed = mapped.failed;
        metrics.playwrightErrors = mapped.errors;
        appendBlockedCases(mapped, opts, startedAt, finishedAt);
        return {
          executionMode: 'GENERATED_E2E',
          framework: 'playwright',
          result: mapped.result,
          metrics,
          playwrightJsonPath: opts.jsonOutputPath,
          logs,
        };
      } catch {
        /* fall through */
      }
    }
    return {
      executionMode: 'GENERATED_E2E',
      framework: 'playwright',
      result: emptyRun(opts),
      metrics,
      logs,
    };
  }
}

/** Append generation-blocked cases so the canonical result is complete (spec §18 vs §29). */
function appendBlockedCases(
  mapped: { result: GeneratedTestExecutionResult['result'] },
  opts: ExecuteOptions,
  startedAt: string,
  finishedAt: string,
): void {
  const blocked = opts.generationResult.caseResults.filter((c) => c.status === 'blocked');
  for (const b of blocked) {
    mapped.result.testResults.push({
      schemaVersion: '1.0',
      runId: mapped.result.runId,
      testCaseId: b.testCaseId,
      scenarioId: opts.input.testCases.find((t) => t.id === b.testCaseId)?.scenarioId ?? '',
      requirementIds: opts.input.testCases.find((t) => t.id === b.testCaseId)?.requirementIds ?? [],
      status: 'blocked',
      phase: 'blocked',
      steps: [],
      assertions: [],
      evidence: [],
      runtimeBindings: [],
      cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
      errors: [
        {
          code: 'GENERATED_E2E_BLOCKED',
          message: b.blockingReason?.message ?? 'generation blocked',
          retryable: false,
          executorType: 'ui',
        },
      ],
      warnings: [],
      provenance: opts.input.testCases.find((t) => t.id === b.testCaseId)?.provenance ?? [],
      timings: { startedAt, finishedAt, durationMs: 0 },
    });
    mapped.result.summary.testsTotal++;
    mapped.result.summary.blocked++;
  }
}

function emptyRun(_opts: ExecuteOptions): GeneratedTestExecutionResult['result'] {
  return {
    schemaVersion: '1.0',
    runId: `gen-run-empty-${Date.now()}`, // runtime id; not part of generated source
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
