// ---------------------------------------------------------------------------
// TIRAI — PDF Exporter (using pdfkit via pdfmake)
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

function toWinAnsiSafeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, (char) => {
      if (char === '“' || char === '”') return '"';
      if (char === '‘' || char === '’') return "'";
      if (char === '–' || char === '—') return '-';
      if (char === '…') return '...';
      return `?`;
    });
}

export class PDFExporter implements TestOutputExporter {
  readonly format = 'pdf';

  async export(input: {
    testPlan: TestPlanIR;
    testCases: TestCase[];
    options?: ExportOptions;
  }): Promise<OutputArtifactIR> {
    const { testPlan, testCases, options } = input;
    const outDir = options?.outDir || './outputs/pdf';
    const testCaseIds = testCases.map((tc) => tc.id);
    const testPlanFingerprint = createHash('sha256').update(JSON.stringify(testPlan)).digest('hex');

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([612, 792]);
    let y = 750;
    const lineHeight = 14;

    const drawText = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
      if (y < 50) {
        page = pdfDoc.addPage([612, 792]);
        y = 750;
      }
      const safeText = toWinAnsiSafeText(text);
      page.drawText(safeText, {
        x: 50,
        y,
        size: opts.size || 10,
        font: opts.bold ? boldFont : font,
        color: rgb(0, 0, 0),
      });
      y -= lineHeight;
    };

    drawText('TIRAI Test Plan Export', { bold: true, size: 18 });
    y -= 10;
    drawText(`Generated: ${  new Date().toISOString()}`, { size: 9 });
    y -= 15;

    const q = testPlan.quality as unknown as Record<string, unknown> | undefined;
    const totalCases = (q?.testCases as number | undefined) ?? testCases.length;
    const totalScenarios = (q?.scenarios as number | undefined) ?? testPlan.scenarios?.length ?? 0;
    const totalRequirements = (q?.requirementsTotal as number | undefined) ?? testPlan.requirementCoverage?.length ?? 0;
    const rawCoverage = q?.coverageRate as number | undefined;
    const coverageRate = typeof rawCoverage === 'number' && !Number.isNaN(rawCoverage) ? (rawCoverage * 100).toFixed(1) : '100.0';
    const automationReady = (q?.automationReady as number | undefined) ?? testCases.filter((tc) => tc.automation?.status === 'ready').length;

    drawText('Summary', { bold: true, size: 14 });
    drawText(`Total Test Cases: ${totalCases}`);
    drawText(`Total Scenarios: ${totalScenarios}`);
    drawText(`Total Requirements: ${totalRequirements}`);
    drawText(`Coverage Rate: ${coverageRate}%`);
    drawText(`Automation Ready: ${automationReady}`);
    y -= 15;

    drawText('Test Cases', { bold: true, size: 14 });

    for (const tc of testCases) {
      drawText(`${tc.id  }: ${  tc.title}`, { bold: true, size: 11 });
      drawText(`  Objective: ${  tc.objective}`);
      drawText(`  Type: ${  tc.type  } | Priority: ${  tc.priority  } | Status: ${  tc.automation.status}`);
      drawText(`  Requirements: ${  tc.requirementIds.join(', ')}`);

      if (tc.steps.length > 0) {
        drawText('  Steps:', { bold: true });
        for (const step of tc.steps) {
          drawText(`    ${  step.order  }. ${  step.action  }${step.target ? ` (${  step.target  })` : ''}`);
        }
      }

      if (tc.expectedResults.length > 0) {
        drawText('  Expected Results:', { bold: true });
        for (const er of tc.expectedResults) {
          drawText(`    - [${  er.verificationType  }] ${  er.description}`);
        }
      }
      y -= 5;
    }

    const pdfBytes = await pdfDoc.save();

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.pdf');
    fs.writeFileSync(filePath, pdfBytes);

    return {
      artifactId: `artifact-pdf-${  testPlanFingerprint.slice(0, 12)}`,
      format: 'pdf',
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
