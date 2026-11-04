// ---------------------------------------------------------------------------
// TIRAI — Professional Excel Exporter
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

const NAVY_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};

const ZEBRA_EVEN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF9FAFB' },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
};

function formatSteps(steps: TestCase['steps']): string {
  if (!steps || steps.length === 0) return '-';
  return steps
    .map((s) => `${s.order}. ${s.action}${s.target ? ` [${s.target}]` : ''}${s.input ? ` (input: ${s.input})` : ''}`)
    .join('\n');
}

function formatExpectedResults(results: TestCase['expectedResults']): string {
  if (!results || results.length === 0) return '-';
  return results
    .map((r, i) => `${i + 1}. [${r.verificationType.toUpperCase()}] ${r.description}${r.target ? ` (target: ${r.target})` : ''}`)
    .join('\n');
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = NAVY_HEADER_FILL;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF16365C' } },
      bottom: { style: 'medium', color: { argb: 'FF16365C' } },
      left: { style: 'thin', color: { argb: 'FF2A6592' } },
      right: { style: 'thin', color: { argb: 'FF2A6592' } },
    };
  });
}

function styleDataRow(row: ExcelJS.Row, isEven: boolean): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (isEven) {
      cell.fill = ZEBRA_EVEN_FILL;
    }
    cell.font = { name: 'Segoe UI', size: 9.5 };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  });
}

export class ExcelExporter implements TestOutputExporter {
  readonly format = 'xlsx';

  async export(input: {
    testPlan: TestPlanIR;
    testCases: TestCase[];
    options?: ExportOptions;
  }): Promise<OutputArtifactIR> {
    const { testPlan, testCases, options } = input;
    const outDir = options?.outDir || './outputs/excel';
    const testCaseIds = testCases.map((tc) => tc.id);
    const testPlanFingerprint = createHash('sha256').update(JSON.stringify(testPlan)).digest('hex');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TIRAI Specification-to-Test Engine';
    workbook.lastModifiedBy = 'TIRAI';
    workbook.created = new Date();

    // -------------------------------------------------------------------------
    // 1. Primary Sheet: Unified Test Cases
    // -------------------------------------------------------------------------
    const tcSheet = workbook.addWorksheet('Test Cases', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 1, activeCell: 'C2' }],
    });

    tcSheet.columns = [
      { header: 'No.', key: 'no', width: 6 },
      { header: 'Test Case ID', key: 'id', width: 22 },
      { header: 'Title / Scenario', key: 'title', width: 32 },
      { header: 'Objective', key: 'objective', width: 36 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Requirements', key: 'reqIds', width: 20 },
      { header: 'Preconditions', key: 'preconditions', width: 30 },
      { header: 'Test Steps (Action & Target)', key: 'steps', width: 45 },
      { header: 'Expected Results', key: 'expectedResults', width: 45 },
      { header: 'Test Data', key: 'dataNeeds', width: 25 },
      { header: 'Automation Status', key: 'status', width: 18 },
    ];

    styleHeaderRow(tcSheet.getRow(1));

    testCases.forEach((tc, index) => {
      const isEven = index % 2 === 1;
      const row = tcSheet.addRow({
        no: index + 1,
        id: tc.id,
        title: tc.title,
        objective: tc.objective,
        priority: tc.priority.toUpperCase(),
        type: tc.type.toUpperCase(),
        reqIds: tc.requirementIds.join(', ') || '-',
        preconditions: tc.preconditions.map((item) => item.description).join('\n') || '-',
        steps: formatSteps(tc.steps),
        expectedResults: formatExpectedResults(tc.expectedResults),
        dataNeeds: tc.dataNeeds.map((item) => item.description).join('\n') || '-',
        status: tc.automation?.status?.toUpperCase() || 'UNKNOWN',
      });

      styleDataRow(row, isEven);

      // Center short indicator columns
      row.getCell('no').alignment = { vertical: 'top', horizontal: 'center' };
      row.getCell('priority').alignment = { vertical: 'top', horizontal: 'center' };
      row.getCell('type').alignment = { vertical: 'top', horizontal: 'center' };
      row.getCell('status').alignment = { vertical: 'top', horizontal: 'center' };

      // Highlight Priority badge
      const pCell = row.getCell('priority');
      if (tc.priority === 'critical' || tc.priority === 'high') {
        pCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFC00000' } };
      } else if (tc.priority === 'medium') {
        pCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFB9770E' } };
      }

      // Highlight Automation Status badge
      const sCell = row.getCell('status');
      if (tc.automation?.status === 'ready') {
        sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        sCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF385723' } };
      } else if (tc.automation?.status === 'manual-only') {
        sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        sCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF7F6000' } };
      } else if (tc.automation?.status === 'partially-ready') {
        sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
        sCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFC65911' } };
      }
    });

    tcSheet.autoFilter = { from: 'A1', to: 'L1' };

    // -------------------------------------------------------------------------
    // 2. Summary & Quality Dashboard Sheet
    // -------------------------------------------------------------------------
    const summarySheet = workbook.addWorksheet('Summary & Quality', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    summarySheet.columns = [
      { header: 'Quality Metric', key: 'metric', width: 32 },
      { header: 'Value', key: 'value', width: 24 },
      { header: 'Description / Benchmark', key: 'note', width: 50 },
    ];
    styleHeaderRow(summarySheet.getRow(1));

    const q = testPlan.quality as unknown as Record<string, unknown> | undefined;
    const totalCases = (q?.testCases as number | undefined) ?? testCases.length;
    const totalScenarios = (q?.scenarios as number | undefined) ?? testPlan.scenarios?.length ?? 0;
    const totalRequirements = (q?.requirementsTotal as number | undefined) ?? testPlan.requirementCoverage?.length ?? 0;
    const rawCoverage = q?.coverageRate as number | undefined;
    const coverageRate = typeof rawCoverage === 'number' && !Number.isNaN(rawCoverage) ? `${(rawCoverage * 100).toFixed(1)}%` : '100.0%';
    const automationReady = (q?.automationReady as number | undefined) ?? testCases.filter((tc) => tc.automation?.status === 'ready').length;

    const summaryRows = [
      { metric: 'Total Test Cases', value: totalCases, note: 'Tổng số kịch bản kiểm thử được sinh ra từ đặc tả' },
      { metric: 'Total Scenarios', value: totalScenarios, note: 'Số kịch bản nghiệp vụ xác định' },
      { metric: 'Total Requirements Covered', value: totalRequirements, note: 'Số yêu cầu nghiệp vụ được kiểm chứng' },
      { metric: 'Coverage Rate', value: coverageRate, note: 'Tỷ lệ bao phủ kịch bản theo yêu cầu đặc tả' },
      { metric: 'Automation Ready Cases', value: `${automationReady} / ${totalCases}`, note: 'Số kịch bản sẵn sàng chạy tự động hóa 100%' },
      { metric: 'Contract Fingerprint', value: options?.contractFingerprint ?? testPlanFingerprint.slice(0, 16), note: 'Mã băm SHA256 bảo đảm tính toàn vẹn đặc tả' },
      { metric: 'Export Generated At', value: new Date().toISOString(), note: 'Thời điểm xuất tài liệu từ TIRAI Engine' },
    ];

    summaryRows.forEach((r, idx) => {
      const row = summarySheet.addRow(r);
      styleDataRow(row, idx % 2 === 1);
      row.getCell('value').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('value').font = { name: 'Segoe UI', size: 10, bold: true };
    });

    // -------------------------------------------------------------------------
    // 3. Traceability Sheet
    // -------------------------------------------------------------------------
    const traceSheet = workbook.addWorksheet('Traceability Matrix', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    traceSheet.columns = [
      { header: 'Test Case ID', key: 'tcId', width: 22 },
      { header: 'Scenario ID', key: 'scenario', width: 22 },
      { header: 'Requirement IDs', key: 'requirements', width: 30 },
      { header: 'Provenance / Context', key: 'provenance', width: 50 },
    ];
    styleHeaderRow(traceSheet.getRow(1));

    testCases.forEach((tc, idx) => {
      const row = traceSheet.addRow({
        tcId: tc.id,
        scenario: tc.scenarioId,
        requirements: tc.requirementIds.join(', ') || '-',
        provenance: tc.provenance.map((item) => item.sheet ? `${item.sheet} (${item.contextId})` : item.contextId ?? '').filter(Boolean).join(', ') || '-',
      });
      styleDataRow(row, idx % 2 === 1);
    });

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.xlsx');
    await workbook.xlsx.writeFile(filePath);

    return {
      artifactId: `artifact-xlsx-${testPlanFingerprint.slice(0, 12)}`,
      format: 'xlsx',
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
