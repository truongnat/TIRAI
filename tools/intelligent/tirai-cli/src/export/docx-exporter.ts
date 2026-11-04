// ---------------------------------------------------------------------------
// TIRAI — Professional DOCX Exporter
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
} from 'docx';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

const TABLE_BORDER_STYLE = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'EBEBEB' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'EBEBEB' },
};

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

    const children: (Paragraph | Table)[] = [];

    // Title
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: 'TIRAI Test Specification & Execution Plan',
            bold: true,
            size: 32,
            color: '1F4E79',
          }),
        ],
        spacing: { after: 120 },
      }),
    );

    // Metadata line
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Generated At: ', bold: true, size: 18 }),
          new TextRun({ text: `${new Date().toISOString()}  |  `, size: 18 }),
          new TextRun({ text: 'Fingerprint: ', bold: true, size: 18 }),
          new TextRun({ text: `${testPlanFingerprint.slice(0, 16)}...`, size: 18, color: '595959' }),
        ],
        spacing: { after: 240 },
      }),
    );

    // -------------------------------------------------------------------------
    // Summary Section
    // -------------------------------------------------------------------------
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({ text: '1. Executive Quality Summary', bold: true, size: 24, color: '1F4E79' }),
        ],
        spacing: { before: 200, after: 120 },
      }),
    );

    const q = testPlan.quality as unknown as Record<string, unknown> | undefined;
    const totalCases = (q?.testCases as number | undefined) ?? testCases.length;
    const totalScenarios = (q?.scenarios as number | undefined) ?? testPlan.scenarios?.length ?? 0;
    const totalRequirements = (q?.requirementsTotal as number | undefined) ?? testPlan.requirementCoverage?.length ?? 0;
    const rawCoverage = q?.coverageRate as number | undefined;
    const coverageRate = typeof rawCoverage === 'number' && !Number.isNaN(rawCoverage) ? `${(rawCoverage * 100).toFixed(1)}%` : '100.0%';
    const automationReady = (q?.automationReady as number | undefined) ?? testCases.filter((tc) => tc.automation?.status === 'ready').length;

    const summaryTableRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            width: { size: 4000, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: '1F4E79' },
            children: [new Paragraph({ children: [new TextRun({ text: 'Metric', bold: true, color: 'FFFFFF' })] })],
          }),
          new TableCell({
            width: { size: 5000, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: '1F4E79' },
            children: [new Paragraph({ children: [new TextRun({ text: 'Value', bold: true, color: 'FFFFFF' })] })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Total Test Cases')] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(totalCases), bold: true })] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Total Scenarios')] }),
          new TableCell({ children: [new Paragraph(String(totalScenarios))] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Requirements Covered')] }),
          new TableCell({ children: [new Paragraph(String(totalRequirements))] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Coverage Rate')] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: coverageRate, bold: true, color: '385723' })] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Automation Ready')] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${automationReady} / ${totalCases}`, bold: true })] })] }),
        ],
      }),
    ];

    children.push(
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        borders: TABLE_BORDER_STYLE,
        rows: summaryTableRows,
      }),
    );

    // Spacing
    children.push(new Paragraph({ spacing: { after: 300 } }));

    // -------------------------------------------------------------------------
    // Test Cases Section
    // -------------------------------------------------------------------------
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({ text: '2. Detailed Test Cases Matrix', bold: true, size: 24, color: '1F4E79' }),
        ],
        spacing: { before: 240, after: 160 },
      }),
    );

    for (const [index, tc] of testCases.entries()) {
      // Header Banner Table for each Test Case
      children.push(
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          borders: TABLE_BORDER_STYLE,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 9000, type: WidthType.DXA },
                  shading: { type: ShadingType.CLEAR, fill: 'D9E1F2' },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: `#${index + 1} - ${tc.id}: ${tc.title}`, bold: true, size: 22, color: '1F4E79' }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      );

      // Meta attributes
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Objective: ', bold: true }),
            new TextRun(tc.objective),
          ],
          spacing: { before: 60, after: 40 },
        }),
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Priority: ', bold: true }),
            new TextRun({ text: tc.priority.toUpperCase(), bold: true, color: tc.priority === 'high' ? 'C00000' : '262626' }),
            new TextRun('  |  '),
            new TextRun({ text: 'Type: ', bold: true }),
            new TextRun(tc.type.toUpperCase()),
            new TextRun('  |  '),
            new TextRun({ text: 'Status: ', bold: true }),
            new TextRun({ text: tc.automation.status.toUpperCase(), bold: true, color: '385723' }),
            new TextRun('  |  '),
            new TextRun({ text: 'Requirements: ', bold: true }),
            new TextRun(tc.requirementIds.join(', ') || '-'),
          ],
          spacing: { after: 80 },
        }),
      );

      if (tc.preconditions.length > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Preconditions: ', bold: true, color: '595959' }),
              new TextRun(tc.preconditions.map((p) => p.description).join('; ')),
            ],
            spacing: { after: 60 },
          }),
        );
      }

      // Detailed Steps & Expected Table
      if (tc.steps.length > 0) {
        const stepRows: TableRow[] = [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({
                width: { size: 800, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
                children: [new Paragraph({ children: [new TextRun({ text: 'Step', bold: true, size: 18 })] })],
              }),
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
                children: [new Paragraph({ children: [new TextRun({ text: 'Action / Execution Target', bold: true, size: 18 })] })],
              }),
              new TableCell({
                width: { size: 3700, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
                children: [new Paragraph({ children: [new TextRun({ text: 'Expected Outcome', bold: true, size: 18 })] })],
              }),
            ],
          }),
        ];

        tc.steps.forEach((step, sIdx) => {
          const correspondingExpected = tc.expectedResults[sIdx]?.description || (sIdx === tc.steps.length - 1 ? tc.expectedResults.map((e) => e.description).join('\n') : '-');
          stepRows.push(
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(String(step.order))] })],
                }),
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: step.action, bold: true }),
                        step.target ? new TextRun({ text: ` [${step.target}]`, color: '1F4E79' }) : new TextRun(''),
                        step.input ? new TextRun({ text: ` (input: "${step.input}")`, color: '595959' }) : new TextRun(''),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: correspondingExpected, color: '385723' })] })],
                }),
              ],
            }),
          );
        });

        children.push(
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            borders: TABLE_BORDER_STYLE,
            rows: stepRows,
          }),
        );
      }

      // Spacing between cases
      children.push(new Paragraph({ spacing: { after: 240 } }));
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.docx');
    fs.writeFileSync(filePath, buffer);

    return {
      artifactId: `artifact-docx-${testPlanFingerprint.slice(0, 12)}`,
      format: 'docx',
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
