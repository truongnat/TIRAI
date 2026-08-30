import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace, ensureDir } from '../workspace.js';
import { loadConfig } from '../config.js';
import { loadState } from '../state.js';
import { CliError } from '../errors.js';
import { writeSummary } from 'test-code-generator';

export interface ReportOptions {
  cwd: string;
  json?: boolean;
}

export async function runReport(opts: ReportOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  loadConfig(paths); // validates

  const hasE2e = fs.existsSync(paths.e2eResultPath);
  const hasUnit = fs.existsSync(paths.unitResultPath);
  if (!hasE2e && !hasUnit) {
    throw new CliError('CONFIG_INVALID', 'No run results found. Run `tirai run` first.');
  }

  let e2eResult: unknown = null;
  let unitResult: unknown = null;
  if (hasE2e) {
    try {
      e2eResult = JSON.parse(fs.readFileSync(paths.e2eResultPath, 'utf8'));
    } catch {
      // ignore
    }
  }
  if (hasUnit) {
    try {
      unitResult = JSON.parse(fs.readFileSync(paths.unitResultPath, 'utf8'));
    } catch {
      // ignore
    }
  }

  const state = loadState(paths);
  const sourcePath = state?.source?.path ? path.relative(paths.root, state.source.path) : 'unknown';
  const testCasesCount = state?.testPlan?.testCaseCount ?? (e2eResult || unitResult ? 1 : 0);

  // Derive summary from canonical results, not raw
  const e2eSummary = (e2eResult as { summary?: { passed: number; failed: number; errors: number; blocked: number; testsTotal: number } } | null)?.summary;
  const unitSummary = (unitResult as { summary?: { passed: number; failed: number; errors: number; blocked: number; testsTotal: number } } | null)?.summary;
  const e2eStatus = (e2eResult as { status?: string } | null)?.status ?? 'unknown';
  const unitStatus = (unitResult as { status?: string } | null)?.status ?? 'unknown';
  const overall = hasE2e && hasUnit
    ? e2eStatus === 'passed' && unitStatus === 'passed' ? 'PASS' : e2eStatus === 'error' || unitStatus === 'error' ? 'ERROR' : 'FAIL'
    : e2eStatus === 'passed' || unitStatus === 'passed' ? 'PASS' : 'FAIL';

  // Ensure reports dir exists and write latest-summary.md via canonical writer where possible
  ensureDir(paths.reportsDir);
  // Use writeSummary helper for each result if available, else fallback
  if (e2eResult && hasE2e) {
    try {
      // writeSummary expects result and context; we synthesize minimal context
      writeSummary(path.join(paths.reportsDir, 'e2e-summary.md'), e2eResult as Parameters<typeof writeSummary>[1], {
        framework: 'playwright',
        executionMode: 'GENERATED_E2E',
        generationStatus: 'success',
        testCasesReceived: testCasesCount,
        testCasesGenerated: e2eSummary?.testsTotal ?? 0,
        testCasesBlocked: e2eSummary?.blocked ?? 0,
        generatedFiles: [] as string[],
      });
    } catch {
      // ignore
    }
  }
  if (unitResult && hasUnit) {
    try {
      writeSummary(path.join(paths.reportsDir, 'unit-summary.md'), unitResult as Parameters<typeof writeSummary>[1], {
        framework: 'vitest',
        executionMode: 'GENERATED_UNIT',
        generationStatus: 'success',
        testCasesReceived: testCasesCount,
        testCasesGenerated: unitSummary?.testsTotal ?? 0,
        testCasesBlocked: unitSummary?.blocked ?? 0,
        generatedFiles: [] as string[],
      });
    } catch {
      // ignore
    }
  }

  const latestPath = paths.latestReportPath;
  const lines = [
    '# TIRAI run summary',
    '',
    `Source:`,
    `  ${sourcePath}`,
    '',
    `TestCases:`,
    `  ${testCasesCount}`,
    '',
    `E2E:`,
    `  ${e2eSummary ? `${e2eSummary.passed} passed, ${e2eSummary.failed} failed, ${e2eSummary.errors} errors, ${e2eSummary.blocked} blocked (${e2eStatus})` : 'no result'}`,
    '',
    `Unit:`,
    `  ${unitSummary ? `${unitSummary.passed} passed, ${unitSummary.failed} failed, ${unitSummary.errors} errors, ${unitSummary.blocked} blocked (${unitStatus})` : 'no result'}`,
    '',
    `Result:`,
    `  ${overall}`,
    '',
    `Report:`,
    `  ${path.relative(paths.root, latestPath)}`,
    '',
    '> Generated from canonical TestRunResultIR. Not the source of truth.',
  ];
  fs.writeFileSync(latestPath, lines.join('\n'), 'utf8');

  if (opts.json) {
    console.log(JSON.stringify({ e2eStatus, unitStatus, overall, e2eSummary, unitSummary, source: sourcePath, testCases: testCasesCount }, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}
