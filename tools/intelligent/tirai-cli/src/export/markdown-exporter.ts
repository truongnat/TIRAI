// ---------------------------------------------------------------------------
// TIRAI — Markdown Exporter
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

export class MarkdownExporter implements TestOutputExporter {
  readonly format = 'markdown';

  async export(input: {
    testPlan: TestPlanIR;
    testCases: TestCase[];
    options?: ExportOptions;
  }): Promise<OutputArtifactIR> {
    const { testPlan, testCases, options } = input;
    const outDir = options?.outDir || './outputs/markdown';
    const testCaseIds = testCases.map((tc) => tc.id);
    const testPlanFingerprint = createHash('sha256').update(JSON.stringify(testPlan)).digest('hex');

    let md = '# TIRAI Test Plan Export\n\n';
    md += '**Generated:** ' + new Date().toISOString() + '\n';
    md += '**Fingerprint:** ' + testPlanFingerprint.slice(0, 16) + '...\n\n';

    md += '## Summary\n\n';
    md += '| Metric | Value |\n';
    md += '|--------|-------|\n';
    md += '| Total Test Cases | ' + testPlan.quality.testCases + ' |\n';
    md += '| Total Scenarios | ' + testPlan.quality.scenarios + ' |\n';
    md += '| Total Requirements | ' + testPlan.quality.requirementsTotal + ' |\n';
    md += '| Coverage Rate | ' + (testPlan.quality.coverageRate * 100).toFixed(1) + '% |\n';
    md += '| Automation Ready | ' + testPlan.quality.automationReady + ' |\n\n';

    md += '## Test Cases\n\n';
    for (const tc of testCases) {
      md += '### ' + tc.id + ': ' + tc.title + '\n\n';
      md += '- **Objective:** ' + tc.objective + '\n';
      md += '- **Type:** ' + tc.type + '\n';
      md += '- **Priority:** ' + tc.priority + '\n';
      md += '- **Status:** ' + tc.automation.status + '\n';
      md += '- **Requirements:** ' + tc.requirementIds.join(', ') + '\n\n';

      if (tc.steps.length > 0) {
        md += '**Steps:**\n\n';
        md += '| Order | Action | Target |\n';
        md += '|-------|--------|--------|\n';
        for (const step of tc.steps) {
          md += '| ' + step.order + ' | ' + step.action + ' | ' + (step.target || '-') + ' |\n';
        }
        md += '\n';
      }

      if (tc.expectedResults.length > 0) {
        md += '**Expected Results:**\n\n';
        for (const er of tc.expectedResults) {
          md += '- [' + er.verificationType + '] ' + er.description + '\n';
        }
        md += '\n';
      }
    }

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.md');
    fs.writeFileSync(filePath, md, 'utf8');

    return {
      artifactId: 'artifact-md-' + testPlanFingerprint.slice(0, 12),
      format: 'markdown',
      kind: 'test-case-export',
      path: filePath,
      testPlanFingerprint,
      testCaseIds,
      createdAt: new Date().toISOString(),
      generatorVersion: '1.0.0',
      status: 'created',
    };
  }
}
