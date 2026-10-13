import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace, ensureDir } from '../workspace.js';
import { loadConfig } from '../config.js';
import { loadState } from '../state.js';
import { CliError } from '../errors.js';
import { writeSummary } from 'test-code-generator';
import { resolveActiveTask, taskPaths, updateTask } from '../tasks.js';

export interface ReportOptions {
  cwd: string;
  json?: boolean;
  taskId?: string;
}

export async function runReport(opts: ReportOptions): Promise<void> {
  const basePaths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(basePaths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const taskRoot = task ? taskPaths(basePaths, task.id) : undefined;
  const paths = taskRoot ? {
    ...basePaths,
    artifactsDir: taskRoot.artifacts,
    resultsDir: taskRoot.results,
    e2eResultPath: path.join(taskRoot.results, 'e2e-run-result-ir.json'),
    unitResultPath: path.join(taskRoot.results, 'unit-run-result-ir.json'),
    reportsDir: taskRoot.reports,
    latestReportPath: path.join(taskRoot.reports, 'latest-summary.md'),
  } : basePaths;
  loadConfig(basePaths); // validates
  if (!task) {
    const state = loadState(basePaths);
    const runId = state?.run?.runId;
    if (runId && path.basename(runId) === runId) {
      const webRunDirectory = path.join(basePaths.workspace, 'runs', runId);
      const webReportPath = path.join(webRunDirectory, 'report.json');
      if (fs.existsSync(webReportPath)) {
        let report: unknown;
        try {
          report = JSON.parse(fs.readFileSync(webReportPath, 'utf8'));
        } catch (error) {
          throw new CliError('CONFIG_INVALID', `Web run report is invalid JSON: ${String(error)}`);
        }
        if (report && typeof report === 'object' && 'kind' in report && report.kind === 'tirai-web-test-run') {
          if (opts.json) console.log(JSON.stringify(report, null, 2));
          else {
            const markdownPath = path.join(webRunDirectory, 'report.md');
            console.log(fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, 'utf8') : JSON.stringify(report, null, 2));
          }
          return;
        }
      }
    }
  }

  const hasE2e = fs.existsSync(paths.e2eResultPath);
  const hasUnit = fs.existsSync(paths.unitResultPath);
  const adapterPaths = fs.existsSync(paths.resultsDir)
    ? fs.readdirSync(paths.resultsDir).filter((name) => name.startsWith('execute-') && name.endsWith('.json'))
    : [];
  if (!hasE2e && !hasUnit && adapterPaths.length === 0) {
    throw new CliError('CONFIG_INVALID', 'No run results found. Run `tirai run` or `tirai execute` first.');
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
  const contractPath = path.join(paths.artifactsDir, 'contract.json');
  const contract = fs.existsSync(contractPath) ? JSON.parse(fs.readFileSync(contractPath, 'utf8')) as { contractVersion?: number; metadata?: { contractFingerprint?: string }; quality?: { requirements?: number; scenarios?: number; testCases?: number; unresolved?: number; conflicts?: number; provenanceCoverage?: number }; unresolved?: Array<{ id?: string; description?: string; reason?: string }>; conflicts?: Array<{ id?: string; description?: string; type?: string }> } : null;
  const sourcePath = state?.source?.path ? path.relative(paths.root, state.source.path) : 'unknown';
  const testCasesCount = state?.testPlan?.testCaseCount ?? (e2eResult || unitResult ? 1 : 0);

  // Derive summary from canonical results, not raw
  const e2eSummary = (e2eResult as { summary?: { passed: number; failed: number; errors: number; blocked: number; testsTotal: number } } | null)?.summary;
  const unitSummary = (unitResult as { summary?: { passed: number; failed: number; errors: number; blocked: number; testsTotal: number } } | null)?.summary;
  const adapterResults = adapterPaths.map((name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(paths.resultsDir, name), 'utf8')) as {
        platform?: string; environment?: string; status?: string; executionStatus?: string;
        adapter?: string; testCases?: number; apiOperations?: number; databaseChecks?: number;
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  const e2eStatus = (e2eResult as { status?: string } | null)?.status ?? 'unknown';
  const unitStatus = (unitResult as { status?: string } | null)?.status ?? 'unknown';
  const executionStatuses = [
    ...(hasE2e ? [e2eStatus] : []),
    ...(hasUnit ? [unitStatus] : []),
    ...adapterResults.map((result) => result?.executionStatus ?? result?.status ?? 'unknown'),
  ];
  const overall = executionStatuses.includes('error') ? 'ERROR'
    : executionStatuses.includes('failed') ? 'FAIL'
    : executionStatuses.includes('blocked') ? 'BLOCKED'
    : executionStatuses.includes('manual') ? 'MANUAL'
    : executionStatuses.includes('partial') ? 'PARTIAL'
    : executionStatuses.every((status) => status === 'passed') ? 'PASS'
    : 'UNKNOWN';

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
    `Contract:`,
    `  ${contract?.metadata?.contractFingerprint ?? 'unknown'} (version ${contract?.contractVersion ?? 'unknown'})`,
    `  Requirements ${contract?.quality?.requirements ?? 'unknown'}, scenarios ${contract?.quality?.scenarios ?? 'unknown'}, unresolved ${contract?.quality?.unresolved ?? 'unknown'}, conflicts ${contract?.quality?.conflicts ?? 'unknown'}`,
    ...(contract?.unresolved?.length ? ['', 'Unresolved gaps:', ...contract.unresolved.map((item) => `  - ${item.id ?? 'unknown'}: ${item.description ?? item.reason ?? 'unspecified'}`)] : []),
    ...(contract?.conflicts?.length ? ['', 'Conflicts:', ...contract.conflicts.map((item) => `  - ${item.id ?? 'unknown'} [${item.type ?? 'unknown'}]: ${item.description ?? 'unspecified'}`)] : []),
    '',
    `E2E:`,
    `  ${e2eSummary ? `${e2eSummary.passed} passed, ${e2eSummary.failed} failed, ${e2eSummary.errors} errors, ${e2eSummary.blocked} blocked (${e2eStatus})` : 'no result'}`,
    '',
    `Unit:`,
    `  ${unitSummary ? `${unitSummary.passed} passed, ${unitSummary.failed} failed, ${unitSummary.errors} errors, ${unitSummary.blocked} blocked (${unitStatus})` : 'no result'}`,
    '',
    `Adapter execution:`,
    ...(adapterResults.length ? adapterResults.map((r) => `  ${r?.platform ?? 'unknown'} / ${r?.environment ?? 'unknown'}: ${r?.executionStatus ?? r?.status ?? 'unknown'} (${r?.adapter ?? 'adapter'})`) : ['  no result']),
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
  const report = { schemaVersion: '1.0', generatedFrom: 'TestRunResultIR', source: sourcePath, testCases: testCasesCount, contract: contract ? { fingerprint: contract.metadata?.contractFingerprint, version: contract.contractVersion, quality: contract.quality, unresolved: contract.unresolved ?? [], conflicts: contract.conflicts ?? [] } : null, e2e: { status: e2eStatus, summary: e2eSummary }, unit: { status: unitStatus, summary: unitSummary }, adapters: adapterResults, overall };
  fs.writeFileSync(path.join(paths.reportsDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  fs.writeFileSync(path.join(paths.reportsDir, 'report.html'), `<!doctype html><html><head><meta charset="utf-8"><title>TIRAI report</title></head><body><h1>TIRAI run report</h1><p><strong>Result:</strong> ${escapeHtml(overall)}</p><p><strong>Source:</strong> ${escapeHtml(sourcePath)}</p><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></body></html>`, 'utf8');
  if (task) updateTask(basePaths, task.id, { status: 'reported' });

  if (opts.json) {
    console.log(JSON.stringify({ e2eStatus, unitStatus, adapters: adapterResults, overall, e2eSummary, unitSummary, source: sourcePath, testCases: testCasesCount }, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}
