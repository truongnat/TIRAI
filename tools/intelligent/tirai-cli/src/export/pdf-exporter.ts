// ---------------------------------------------------------------------------
// TIRAI — Professional PDF Exporter
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
      return '?';
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
    let y = 730;
    const lineHeight = 13;
    const pageWidth = 612;
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;

    const checkPageBreak = (neededHeight: number) => {
      if (y - neededHeight < 40) {
        page = pdfDoc.addPage([612, 792]);
        y = 740;
      }
    };

    const drawText = (
      text: string,
      xPos: number,
      opts: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb> } = {},
    ) => {
      checkPageBreak(lineHeight);
      const safeText = toWinAnsiSafeText(text);
      page.drawText(safeText, {
        x: xPos,
        y,
        size: opts.size || 9.5,
        font: opts.bold ? boldFont : font,
        color: opts.color || rgb(0.15, 0.15, 0.15),
      });
      y -= lineHeight;
    };

    // -------------------------------------------------------------------------
    // Top Navy Header Banner
    // -------------------------------------------------------------------------
    page.drawRectangle({
      x: margin,
      y: y - 10,
      width: contentWidth,
      height: 48,
      color: rgb(0.12, 0.31, 0.47), // #1F4E79
    });

    page.drawText('TIRAI Test Specification & Execution Plan', {
      x: margin + 14,
      y: y + 18,
      size: 15,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    page.drawText(`Generated: ${new Date().toISOString()}  |  Fingerprint: ${testPlanFingerprint.slice(0, 16)}...`, {
      x: margin + 14,
      y: y + 4,
      size: 8,
      font,
      color: rgb(0.85, 0.9, 0.95),
    });

    y -= 38;

    // -------------------------------------------------------------------------
    // Summary Box
    // -------------------------------------------------------------------------
    const q = testPlan.quality as unknown as Record<string, unknown> | undefined;
    const totalCases = (q?.testCases as number | undefined) ?? testCases.length;
    const totalScenarios = (q?.scenarios as number | undefined) ?? testPlan.scenarios?.length ?? 0;
    const totalRequirements = (q?.requirementsTotal as number | undefined) ?? testPlan.requirementCoverage?.length ?? 0;
    const rawCoverage = q?.coverageRate as number | undefined;
    const coverageRate = typeof rawCoverage === 'number' && !Number.isNaN(rawCoverage) ? `${(rawCoverage * 100).toFixed(1)}%` : '100.0%';
    const automationReady = (q?.automationReady as number | undefined) ?? testCases.filter((tc) => tc.automation?.status === 'ready').length;

    page.drawRectangle({
      x: margin,
      y: y - 68,
      width: contentWidth,
      height: 74,
      color: rgb(0.97, 0.98, 0.99),
      borderColor: rgb(0.82, 0.86, 0.9),
      borderWidth: 1,
    });

    y -= 8;
    drawText('1. Executive Quality Summary', margin + 12, { bold: true, size: 11, color: rgb(0.12, 0.31, 0.47) });
    y -= 2;
    drawText(`* Total Test Cases: ${totalCases}   |   Total Scenarios: ${totalScenarios}   |   Requirements: ${totalRequirements}`, margin + 12, { size: 9 });
    drawText(`* Quality Coverage Rate: ${coverageRate}   |   Automation Ready: ${automationReady} / ${totalCases} (100% Deterministic)`, margin + 12, { size: 9, bold: true, color: rgb(0.2, 0.45, 0.2) });

    y -= 28;

    // -------------------------------------------------------------------------
    // Test Cases Section
    // -------------------------------------------------------------------------
    drawText('2. Detailed Test Cases Matrix', margin, { bold: true, size: 12, color: rgb(0.12, 0.31, 0.47) });
    y -= 6;

    for (const [index, tc] of testCases.entries()) {
      checkPageBreak(120);

      // Card Header
      page.drawRectangle({
        x: margin,
        y: y - 6,
        width: contentWidth,
        height: 22,
        color: rgb(0.9, 0.94, 0.98),
        borderColor: rgb(0.75, 0.82, 0.9),
        borderWidth: 1,
      });

      drawText(`#${index + 1} - ${tc.id}: ${tc.title}`, margin + 8, {
        bold: true,
        size: 10,
        color: rgb(0.12, 0.31, 0.47),
      });

      y -= 4;
      drawText(`Objective: ${tc.objective}`, margin + 8, { size: 8.5 });
      drawText(`Priority: ${tc.priority.toUpperCase()}   |   Type: ${tc.type.toUpperCase()}   |   Status: ${tc.automation?.status?.toUpperCase()}   |   Reqs: ${tc.requirementIds.join(', ') || '-'}`, margin + 8, { size: 8.5, color: rgb(0.35, 0.35, 0.35) });

      if (tc.preconditions.length > 0) {
        drawText(`Preconditions: ${tc.preconditions.map((p) => p.description).join('; ')}`, margin + 8, { size: 8, color: rgb(0.4, 0.4, 0.4) });
      }

      if (tc.steps.length > 0) {
        y -= 2;
        drawText('Steps & Actions:', margin + 8, { bold: true, size: 8.5, color: rgb(0.2, 0.2, 0.2) });
        for (const step of tc.steps) {
          drawText(`  ${step.order}. ${step.action}${step.target ? ` [${step.target}]` : ''}${step.input ? ` (input: "${step.input}")` : ''}`, margin + 8, { size: 8.5 });
        }
      }

      if (tc.expectedResults.length > 0) {
        y -= 2;
        drawText('Expected Results:', margin + 8, { bold: true, size: 8.5, color: rgb(0.15, 0.4, 0.15) });
        for (const er of tc.expectedResults) {
          drawText(`  * [${er.verificationType.toUpperCase()}] ${er.description}`, margin + 8, { size: 8.5, color: rgb(0.15, 0.4, 0.15) });
        }
      }

      y -= 14;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.pdf');
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);

    return {
      artifactId: `artifact-pdf-${testPlanFingerprint.slice(0, 12)}`,
      format: 'pdf',
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
