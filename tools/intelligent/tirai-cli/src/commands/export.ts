// ---------------------------------------------------------------------------
// TIRAI — Export Command
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import { requireWorkspace } from '../workspace.js';
import { loadConfig } from '../config.js';
import { CliError } from '../errors.js';
import { JSONExporter } from '../export/json-exporter.js';
import { ExcelExporter } from '../export/excel-exporter.js';
import { MarkdownExporter } from '../export/markdown-exporter.js';
import { PDFExporter } from '../export/pdf-exporter.js';
import { DOCXExporter } from '../export/docx-exporter.js';
import type { OutputArtifactIR, TestOutputExporter } from '../export/exporter.js';
import { resolveActiveTask, taskPaths, updateTask } from '../tasks.js';

export interface ExportCommandOptions {
  cwd: string;
  format: string;
  outDir?: string;
  includeBlocked?: boolean;
  json?: boolean;
  taskId?: string;
}

const exporters: Record<string, TestOutputExporter> = {
  json: new JSONExporter(),
  xlsx: new ExcelExporter(),
  markdown: new MarkdownExporter(),
  pdf: new PDFExporter(),
  docx: new DOCXExporter(),
};

const formatDirMap: Record<string, 'outputsJsonDir' | 'outputsExcelDir' | 'outputsPdfDir' | 'outputsDocxDir' | 'outputsMarkdownDir'> = {
  json: 'outputsJsonDir',
  xlsx: 'outputsExcelDir',
  pdf: 'outputsPdfDir',
  docx: 'outputsDocxDir',
  markdown: 'outputsMarkdownDir',
};

export async function runExport(opts: ExportCommandOptions): Promise<void> {
  const basePaths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(basePaths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const taskRoot = task ? taskPaths(basePaths, task.id) : undefined;
  const paths = taskRoot ? { ...basePaths, testPlanPath: `${taskRoot.artifacts}/test-plan.json`, testCasesPath: `${taskRoot.artifacts}/testcases.json`, outputsJsonDir: `${taskRoot.outputs}/json`, outputsExcelDir: `${taskRoot.outputs}/excel`, outputsPdfDir: `${taskRoot.outputs}/pdf`, outputsDocxDir: `${taskRoot.outputs}/docx`, outputsMarkdownDir: `${taskRoot.outputs}/markdown` } : basePaths;
  loadConfig(basePaths);

  // Load canonical artifacts
  const testPlanPath = paths.testPlanPath;
  const testCasesPath = paths.testCasesPath;

  if (!fs.existsSync(testPlanPath) || !fs.existsSync(testCasesPath)) {
    throw new CliError('CONFIG_INVALID', 'No canonical test plan found. Run `tirai plan` first.');
  }

  const testPlan = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));
  const testCases = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));
  const contractPath = `${paths.artifactsDir}/contract.json`;
  if (!fs.existsSync(contractPath)) throw new CliError('CONFIG_INVALID', 'Contract artifact not found. Run `tirai ingest` first.');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as { contractId?: string; testCases?: unknown[] };
  const exportedCases = Array.isArray(testCases) ? testCases : (testCases as { testCases?: unknown[] }).testCases ?? [];
  if (!contract.contractId || !Array.isArray(contract.testCases) || contract.testCases.length !== exportedCases.length) {
    throw new CliError('CONFIG_INVALID', 'Contract and export artifacts are inconsistent. Re-run `tirai ingest`.');
  }

  // Determine formats to export
  const formats = opts.format === 'all'
    ? ['json', 'xlsx', 'markdown', 'pdf', 'docx']
    : [opts.format];

  // Validate formats
  for (const fmt of formats) {
    if (!exporters[fmt]) {
      throw new CliError('INVALID_TARGET', `Unknown format: ${fmt}. Supported: json, xlsx, markdown, pdf, docx, all`);
    }
  }
  if (task) updateTask(basePaths, task.id, { status: 'reported' });

  // Export
  const artifacts: OutputArtifactIR[] = [];
  for (const fmt of formats) {
    const exporter = exporters[fmt];
    const outDir = opts.outDir
      ? `${opts.outDir}/${fmt}`
      : paths[formatDirMap[fmt]];
    const artifact = await exporter.export({
      testPlan,
      testCases,
      options: { outDir, contractFingerprint: (contract as { metadata?: { contractFingerprint?: string } }).metadata?.contractFingerprint, contractVersion: (contract as { contractVersion?: number }).contractVersion },
    });
    artifacts.push(artifact);
  }

  if (opts.json) {
    console.log(JSON.stringify({ artifacts }, null, 2));
  } else {
    console.log('TIRAI export complete:');
    for (const artifact of artifacts) {
      console.log(`  ${artifact.format}: ${artifact.path}`);
    }
  }
}
