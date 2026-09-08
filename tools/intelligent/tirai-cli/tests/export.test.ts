import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { JSONExporter } from '../src/export/json-exporter.js';
import { ExcelExporter } from '../src/export/excel-exporter.js';
import { MarkdownExporter } from '../src/export/markdown-exporter.js';
import { PDFExporter } from '../src/export/pdf-exporter.js';
import { DOCXExporter } from '../src/export/docx-exporter.js';
import type { TestPlanIR, TestCase } from 'test-planner';

function createTestPlan(): TestPlanIR {
  const tc: TestCase = {
    id: 'TC-001',
    scenarioId: 'SC-001',
    requirementIds: ['REQ-001'],
    title: 'Login with valid credentials',
    objective: 'Verify successful login',
    type: 'ui',
    priority: 'high',
    preconditions: [],
    inputs: [{ name: 'username', value: 'testuser', valueStrategy: 'fixed' }],
    dataNeeds: [{ id: 'dn-1', description: 'Test user account', type: 'account', constraints: [], relatedRequirementIds: ['REQ-001'] }],
    steps: [
      { order: 1, action: 'Open login page', target: '/login' },
      { order: 2, action: 'Enter credentials' },
      { order: 3, action: 'Click submit' },
    ],
    expectedResults: [
      { description: 'Redirected to dashboard', verificationType: 'ui' },
      { description: 'Welcome message visible', verificationType: 'ui' },
    ],
    cleanup: [],
    automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
    provenance: [],
    confidence: 0.95,
  };

  return {
    schemaVersion: '1.0',
    scope: { requirementIds: ['REQ-001'], objective: 'Test login flow', assumptions: [], exclusions: [] },
    requirementCoverage: [],
    scenarios: [{
      id: 'SC-001',
      title: 'Login flow',
      objective: 'Test login',
      category: 'happy-path',
      requirementIds: ['REQ-001'],
      preconditions: [],
      dataNeeds: [],
      expectedBehavior: [],
      priority: 'high',
      provenance: [],
      confidence: 0.95,
    }],
    testCases: [tc],
    dataNeeds: [],
    unresolved: [],
    quality: {
      requirementsTotal: 1,
      requirementsCovered: 1,
      requirementsPartiallyCovered: 0,
      requirementsNotCovered: 0,
      coverageRate: 1,
      scenarios: 1,
      testCases: 1,
      positiveCases: 1,
      negativeCases: 0,
      boundaryCases: 0,
      validationCases: 0,
      unresolved: 0,
      automationReady: 1,
      provenanceCoverage: 1,
    },
  };
}

describe('JSONExporter', () => {
  let tmp: string;
  let testPlan: TestPlanIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-export-'));
    testPlan = createTestPlan();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports to JSON with correct structure', async () => {
    const exporter = new JSONExporter();
    const artifact = await exporter.export({
      testPlan,
      testCases: testPlan.testCases,
      options: { outDir: tmp },
    });
    expect(artifact.format).toBe('json');
    expect(fs.existsSync(artifact.path)).toBe(true);
    const content = JSON.parse(fs.readFileSync(artifact.path, 'utf8'));
    expect(content.testCases).toHaveLength(1);
    expect(content.testCaseIds).toContain('TC-001');
  });
});

describe('ExcelExporter', () => {
  let tmp: string;
  let testPlan: TestPlanIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-export-'));
    testPlan = createTestPlan();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports to xlsx', async () => {
    const exporter = new ExcelExporter();
    const artifact = await exporter.export({
      testPlan,
      testCases: testPlan.testCases,
      options: { outDir: tmp },
    });
    expect(artifact.format).toBe('xlsx');
    expect(fs.existsSync(artifact.path)).toBe(true);
  });
});

describe('MarkdownExporter', () => {
  let tmp: string;
  let testPlan: TestPlanIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-export-'));
    testPlan = createTestPlan();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports to markdown', async () => {
    const exporter = new MarkdownExporter();
    const artifact = await exporter.export({
      testPlan,
      testCases: testPlan.testCases,
      options: { outDir: tmp },
    });
    expect(artifact.format).toBe('markdown');
    expect(fs.existsSync(artifact.path)).toBe(true);
    const content = fs.readFileSync(artifact.path, 'utf8');
    expect(content).toContain('TC-001');
  });
});

describe('PDFExporter', () => {
  let tmp: string;
  let testPlan: TestPlanIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-export-'));
    testPlan = createTestPlan();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports to PDF', async () => {
    const exporter = new PDFExporter();
    const artifact = await exporter.export({
      testPlan,
      testCases: testPlan.testCases,
      options: { outDir: tmp },
    });
    expect(artifact.format).toBe('pdf');
    expect(fs.existsSync(artifact.path)).toBe(true);
  });
});

describe('DOCXExporter', () => {
  let tmp: string;
  let testPlan: TestPlanIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-export-'));
    testPlan = createTestPlan();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports to DOCX', async () => {
    const exporter = new DOCXExporter();
    const artifact = await exporter.export({
      testPlan,
      testCases: testPlan.testCases,
      options: { outDir: tmp },
    });
    expect(artifact.format).toBe('docx');
    expect(fs.existsSync(artifact.path)).toBe(true);
  });
});
