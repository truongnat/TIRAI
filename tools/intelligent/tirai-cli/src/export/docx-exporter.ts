// ---------------------------------------------------------------------------
// TIRAI — DOCX Exporter
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

export class DOCXExporter implements TestOutputExporter {
  readonly format = 'docx';

  async export(input: {
    testPlan: TestPlanIR;
    testCases: TestCase[];
    options?: ExportOptions;
  }): Promise<OutputArtifactIR> {
    const { testPlan, testCases, options } = input;
    const outDir = options?.outDir || './outputs/docx';
    const testCaseIds = testCases.map((tc) => tc.id);
    const testPlanFingerprint = createHash('sha256').update(JSON.stringify(testPlan)).digest('hex');

    const children: Paragraph[] = [];

    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('TIRAI Test Plan Export')] }));
    children.push(new Paragraph({ children: [new TextRun('Generated: ' + new Date().toISOString())] }));
    children.push(new Paragraph({ children: [new TextRun('Fingerprint: ' + testPlanFingerprint.slice(0, 16) + '...')] }));
    children.push(new Paragraph({ children: [new TextRun('')] }));

    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Summary')] }));
    children.push(new Paragraph({ children: [new TextRun('Total Test Cases: ' + testPlan.quality.testCases)] }));
    children.push(new Paragraph({ children: [new TextRun('Total Scenarios: ' + testPlan.quality.scenarios)] }));
    children.push(new Paragraph({ children: [new TextRun('Total Requirements: ' + testPlan.quality.requirementsTotal)] }));
    children.push(new Paragraph({ children: [new TextRun('Coverage Rate: ' + (testPlan.quality.coverageRate * 100).toFixed(1) + '%')] }));
    children.push(new Paragraph({ children: [new TextRun('Automation Ready: ' + testPlan.quality.automationReady)] }));
    children.push(new Paragraph({ children: [new TextRun('')] }));

    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Test Cases')] }));

    for (const tc of testCases) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(tc.id + ': ' + tc.title)] }));
      children.push(new Paragraph({ children: [new TextRun('Objective: ' + tc.objective)] }));
      children.push(new Paragraph({ children: [new TextRun('Type: ' + tc.type + ' | Priority: ' + tc.priority + ' | Status: ' + tc.automation.status)] }));
      children.push(new Paragraph({ children: [new TextRun('Requirements: ' + tc.requirementIds.join(', '))] }));

      if (tc.steps.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'Steps:', bold: true })] }));
        for (const step of tc.steps) {
          children.push(new Paragraph({ children: [new TextRun(step.order + '. ' + step.action + (step.target ? ' (' + step.target + ')' : ''))] }));
        }
      }

      if (tc.expectedResults.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'Expected Results:', bold: true })] }));
        for (const er of tc.expectedResults) {
          children.push(new Paragraph({ children: [new TextRun('- [' + er.verificationType + '] ' + er.description)] }));
        }
      }
      children.push(new Paragraph({ children: [new TextRun('')] }));
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.docx');
    fs.writeFileSync(filePath, buffer);

    return {
      artifactId: 'artifact-docx-' + testPlanFingerprint.slice(0, 12),
      format: 'docx',
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
