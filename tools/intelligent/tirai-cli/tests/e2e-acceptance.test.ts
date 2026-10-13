import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');

function run(args: string[], cwd: string): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

describe('Phase 8: End-to-end acceptance', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('full source-free plan and multi-output flow', async () => {
    // 1. Initialize
    let r = await run(['init'], tmp);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'config.json'))).toBe(true);

    // 2. Add spec (create a valid xlsx)
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Order Validation');
    ws.getCell('A1').value = 'Order Validation Rule';
    ws.getCell('A2').value = 'If quantity is greater than availableStock then reject the order.';
    ws.getCell('A3').value = 'Inputs: quantity, availableStock';
    ws.getCell('A4').value = 'Expected: valid=false, reason=INSUFFICIENT_STOCK';
    await wb.xlsx.writeFile(path.join(tmp, 'spec.xlsx'));

    r = await run(['spec', 'add', './spec.xlsx', '--name', 'Order Spec'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Spec registered:');

    // 3. List specs
    r = await run(['spec', 'list'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1');

    // 4. Add target
    r = await run(['target', 'add', 'web', 'staging', '--url', 'https://staging.example.com'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Added web target: staging');

    // 5. List targets
    r = await run(['target', 'list'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('web:');

    // 6. Ingest (deterministic: raw context artifacts only; host agent supplies canonical artifacts)
    r = await run(['ingest', './spec.xlsx'], tmp);
    expect(r.code, r.err || r.out).toBe(0);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'artifacts', 'ai-input.json'))).toBe(true);

    // 6b. Host agent produces canonical artifacts; import them
    const hostDir = path.join(tmp, 'host');
    fs.mkdirSync(hostDir, { recursive: true });
    const writeHost = (name: string, value: unknown) => {
      fs.writeFileSync(path.join(hostDir, name), JSON.stringify(value), 'utf8');
    };
    writeHost('semantic-ir.json', {
      schemaVersion: '1.0', status: 'complete', document: { title: 'Order Validation', provenance: [] },
      sections: [], entities: [], flows: [], rules: [], relationships: [], unresolved: [], analysis: {},
    });
    writeHost('requirements.json', {
      schemaVersion: '1.0', document: { title: 'Order Validation', provenance: [] },
      requirements: [], unresolved: [], conflicts: [], quality: {},
    });
    writeHost('test-plan.json', {
      schemaVersion: '1.0',
      scope: { requirementIds: [], objective: 'Verify order validation', assumptions: [], exclusions: [] },
      requirementCoverage: [], scenarios: [{ id: 'SCN-1', title: 'Insufficient stock' }],
      testCases: [{ id: 'TC-1', title: 'Reject order when quantity exceeds availableStock' }],
      dataNeeds: [], unresolved: [],
      quality: {
        requirementsTotal: 0, requirementsCovered: 0, requirementsPartiallyCovered: 0,
        requirementsNotCovered: 0, coverageRate: 0, scenarios: 1, testCases: 1,
        positiveCases: 0, negativeCases: 0, boundaryCases: 0, validationCases: 0,
        unresolved: 0, automationReady: 1, provenanceCoverage: 1,
      },
    });
    writeHost('testcases.json', [{
      id: 'TC-1', scenarioId: 'SCN-1', title: 'Reject order when quantity exceeds availableStock',
      objective: 'Submit an order with quantity above stock', type: 'api', priority: 'high',
      requirementIds: ['REQ-1'], preconditions: [], inputs: [], dataNeeds: [],
      steps: [{ order: 1, action: 'Submit order', target: 'order service' }],
      expectedResults: [{ description: 'Rejected with INSUFFICIENT_STOCK', verificationType: 'state' }],
      cleanup: [], automation: { status: 'ready', reasons: [] }, provenance: [], confidence: 1,
    }]);
    writeHost('contract.json', {
      schemaVersion: '1.0', contractId: 'contract-e2e', contractVersion: 1,
      project: { id: 'proj-e2e', name: 'E2E Test' }, document: { title: 'Order Validation' },
      sources: [], rawContexts: [], requirements: [], businessFlows: [], ui: [], apis: [],
      entities: [], modules: [], scenarios: [],
      testCases: [{ id: 'TC-1', kind: 'test-case', title: 'Reject order when quantity exceeds availableStock', relatedIds: [], provenance: [], confidence: 1 }],
      artifacts: [], unresolved: [], conflicts: [],
      quality: { requirements: 0, requirementsCovered: 0, scenarios: 0, testCases: 1, automationReady: 0, unresolved: 0, conflicts: 0, provenanceCoverage: 1 },
      metadata: { contractFingerprint: 'pending', generatedAt: '2026-01-01T00:00:00.000Z', generatorVersion: 'test', promptVersions: [] },
    });
    for (const kind of ['semantic-ir', 'requirements', 'test-plan', 'testcases', 'contract']) {
      r = await run(['artifact', 'import', kind, '--file', `host/${kind}.json`], tmp);
      expect(r.code, `artifact import ${kind}: ${r.err || r.out}`).toBe(0);
    }
    expect(fs.existsSync(path.join(tmp, '.tirai', 'artifacts', 'testcases.json'))).toBe(true);

    // 7. Export all formats
    r = await run(['export', '--format', 'all'], tmp);
    expect(r.code, r.err || r.out).toBe(0);

    // Verify outputs exist
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'json', 'test-cases.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'excel', 'test-cases.xlsx'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'markdown', 'test-cases.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'pdf', 'test-cases.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'docx', 'test-cases.docx'))).toBe(true);

    // 8. Status
    r = await run(['status'], tmp);
    expect(r.code, r.err || r.out).toBe(0);
    expect(r.out).toContain('Specs:');
    expect(r.out).toContain('TestCases:');

    // 9. Help
    r = await run(['--help'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tirai');
    expect(r.out).toContain('export');
    expect(r.out).toContain('execute');
  }, 120000);
});
