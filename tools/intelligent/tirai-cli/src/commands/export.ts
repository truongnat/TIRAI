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

export interface ExportCommandOptions {
  cwd: string;
  format: string;
  outDir?: string;
  includeBlocked?: boolean;
  json?: boolean;
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
  const paths = requireWorkspace(opts.cwd);
  loadConfig(paths);

  // Load canonical artifacts
  const testPlanPath = paths.testPlanPath;
  const testCasesPath = paths.testCasesPath;

  if (!fs.existsSync(testPlanPath) || !fs.existsSync(testCasesPath)) {
    throw new CliError('CONFIG_INVALID', 'No canonical test plan found. Run `tirai plan` first.');
  }

  const testPlan = JSON.parse(fs.readFileSync(testPlanPath, 'utf8'));
  const testCases = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));

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
      options: { outDir },
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
