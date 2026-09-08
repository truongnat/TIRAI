// ---------------------------------------------------------------------------
// TIRAI — Excel Exporter
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { TestPlanIR, TestCase } from 'test-planner';
import type { OutputArtifactIR, TestOutputExporter, ExportOptions } from './exporter.js';

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

    // Test Cases sheet
    const tcSheet = workbook.addWorksheet('Test Cases');
    tcSheet.columns = [
      { header: 'ID', key: 'id', width: 20 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Objective', key: 'objective', width: 40 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Requirement IDs', key: 'reqIds', width: 25 },
    ];
    for (const tc of testCases) {
      tcSheet.addRow({
        id: tc.id,
        title: tc.title,
        objective: tc.objective,
        type: tc.type,
        priority: tc.priority,
        status: tc.automation.status,
        reqIds: tc.requirementIds.join(', '),
      });
    }

    // Steps sheet
    const stepsSheet = workbook.addWorksheet('Steps');
    stepsSheet.columns = [
      { header: 'TestCase ID', key: 'tcId', width: 20 },
      { header: 'Order', key: 'order', width: 8 },
      { header: 'Action', key: 'action', width: 60 },
      { header: 'Target', key: 'target', width: 30 },
    ];
    for (const tc of testCases) {
      for (const step of tc.steps) {
        stepsSheet.addRow({ tcId: tc.id, order: step.order, action: step.action, target: step.target || '' });
      }
    }

    // Expected Results sheet
    const erSheet = workbook.addWorksheet('Expected Results');
    erSheet.columns = [
      { header: 'TestCase ID', key: 'tcId', width: 20 },
      { header: 'Description', key: 'desc', width: 60 },
      { header: 'Verification Type', key: 'vtype', width: 20 },
    ];
    for (const tc of testCases) {
      for (const er of tc.expectedResults) {
        erSheet.addRow({ tcId: tc.id, desc: er.description, vtype: er.verificationType });
      }
    }

    // Data Needs sheet
    const dnSheet = workbook.addWorksheet('Data Needs');
    dnSheet.columns = [
      { header: 'TestCase ID', key: 'tcId', width: 20 },
      { header: 'Description', key: 'desc', width: 60 },
      { header: 'Type', key: 'type', width: 20 },
    ];
    for (const tc of testCases) {
      for (const dn of tc.dataNeeds) {
        dnSheet.addRow({ tcId: tc.id, desc: dn.description, type: dn.type });
      }
    }

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];
    summarySheet.addRow({ metric: 'Total Test Cases', value: testPlan.quality.testCases });
    summarySheet.addRow({ metric: 'Total Scenarios', value: testPlan.quality.scenarios });
    summarySheet.addRow({ metric: 'Total Requirements', value: testPlan.quality.requirementsTotal });
    summarySheet.addRow({ metric: 'Coverage Rate', value: (testPlan.quality.coverageRate * 100).toFixed(1) + '%' });
    summarySheet.addRow({ metric: 'Automation Ready', value: testPlan.quality.automationReady });

    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, 'test-cases.xlsx');
    await workbook.xlsx.writeFile(filePath);

    return {
      artifactId: 'artifact-xlsx-' + testPlanFingerprint.slice(0, 12),
      format: 'xlsx',
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
