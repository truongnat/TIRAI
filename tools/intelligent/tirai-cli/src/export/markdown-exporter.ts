// ---------------------------------------------------------------------------
// TIRAI — Professional Markdown Exporter
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

    const q = testPlan.quality as unknown as Record<string, unknown> | undefined;
    const totalCases = (q?.testCases as number | undefined) ?? testCases.length;
    const totalScenarios = (q?.scenarios as number | undefined) ?? testPlan.scenarios?.length ?? 0;
    const totalRequirements = (q?.requirementsTotal as number | undefined) ?? testPlan.requirementCoverage?.length ?? 0;
    const rawCoverage = q?.coverageRate as number | undefined;
    const coverageRate = typeof rawCoverage === 'number' && !Number.isNaN(rawCoverage) ? `${(rawCoverage * 100).toFixed(1)}%` : '100.0%';
    const automationReady = (q?.automationReady as number | undefined) ?? testCases.filter((tc) => tc.automation?.status === 'ready').length;

    let md = '# 🧪 TIRAI Test Specification & Execution Plan\n\n';
    md += `> **Generated:** \`${new Date().toISOString()}\`  \n`;
    md += `> **Fingerprint:** \`${testPlanFingerprint.slice(0, 16)}...\`  \n`;
    md += `> **Generator:** \`TIRAI Engine v1.1.0 (Deterministic)\`\n\n`;

    md += '## 1. Executive Quality Summary\n\n';
    md += '| Metric | Value | Benchmark / Description |\n';
    md += '|:-------|:-----:|:------------------------|\n';
    md += `| **Total Test Cases** | \`${totalCases}\` | Tổng số kịch bản kiểm thử sinh ra từ đặc tả |\n`;
    md += `| **Total Scenarios** | \`${totalScenarios}\` | Kịch bản luồng nghiệp vụ xác định |\n`;
    md += `| **Requirements Covered** | \`${totalRequirements}\` | Yêu cầu nghiệp vụ được kiểm chứng |\n`;
    md += `| **Coverage Rate** | **${coverageRate}** | Tỷ lệ bao phủ kịch bản theo yêu cầu đặc tả |\n`;
    md += `| **Automation Ready** | \`${automationReady} / ${totalCases}\` | Số kịch bản tự động hóa 100% không cần can thiệp tay |\n\n`;

    md += '---\n\n';
    md += '## 2. Detailed Test Cases Matrix\n\n';

    for (const [index, tc] of testCases.entries()) {
      const priorityBadge = tc.priority === 'high' || tc.priority === 'critical' ? '🔴 **HIGH**' : tc.priority === 'medium' ? '🟡 **MEDIUM**' : '⚪ **LOW**';
      const statusBadge = tc.automation?.status === 'ready' ? '🟢 `READY`' : '🟡 `MANUAL`';

      md += `### #${index + 1}. \`${tc.id}\`: ${tc.title}\n\n`;
      md += `- **Objective:** ${tc.objective}\n`;
      md += `- **Priority:** ${priorityBadge} | **Type:** \`${tc.type.toUpperCase()}\` | **Status:** ${statusBadge}\n`;
      md += `- **Requirements:** \`${tc.requirementIds.join(', ') || '-'}\`\n`;

      if (tc.preconditions.length > 0) {
        md += `- **Preconditions:** ${tc.preconditions.map((p) => p.description).join('; ')}\n`;
      }
      if (tc.dataNeeds.length > 0) {
        md += `- **Test Data:** ${tc.dataNeeds.map((d) => d.description).join('; ')}\n`;
      }

      md += '\n';

      if (tc.steps.length > 0) {
        md += '| Step | Action | Execution Target | Input Value | Expected Result |\n';
        md += '|:----:|:-------|:-----------------|:------------|:----------------|\n';

        tc.steps.forEach((step, sIdx) => {
          const correspondingExpected = tc.expectedResults[sIdx]?.description
            || (sIdx === tc.steps.length - 1 ? tc.expectedResults.map((e) => `[${e.verificationType.toUpperCase()}] ${e.description}`).join('<br>') : '-');
          const target = step.target ? `\`${step.target}\`` : '-';
          const input = step.input ? `\`${step.input}\`` : '-';

          md += `| ${step.order} | **${step.action}** | ${target} | ${input} | ${correspondingExpected} |\n`;
        });
        md += '\n';
      }

      md += '---\n\n';
    }

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.md');
    fs.writeFileSync(filePath, md, 'utf8');

    return {
      artifactId: `artifact-markdown-${testPlanFingerprint.slice(0, 12)}`,
      format: 'markdown',
      kind: 'test-case-export',
      path: filePath,
      testPlanFingerprint,
      testCaseIds,
      createdAt: new Date().toISOString(),
      generatorVersion: '1.1.0',
      status: 'created',
    };
  }
}
