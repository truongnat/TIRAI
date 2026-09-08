import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');

function run(args: string[], cwd: string, env?: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => resolve({ code, out, err }));
  });
}

describe('tirai CLI', () => {
  it('shows help', async () => {
    const r = await run(['--help'], REPO);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tirai');
    expect(r.out).toContain('init');
  });

  it('shows version', async () => {
    const r = await run(['--version'], REPO);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tirai');
  });

  it('workspace resolution and config validation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-test-'));
    try {
      // No workspace -> generate should fail with WORKSPACE_NOT_FOUND
      let r = await run(['generate'], tmp);
      expect(r.code).toBe(2);
      expect(r.err).toContain('WORKSPACE_NOT_FOUND');

      // Init should create workspace
      r = await run(['init'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmp, '.tirai/state/workspace.json'))).toBe(true);
      const cfg = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/config.json'), 'utf8'));
      expect(cfg.version).toBe(2);
      expect(cfg.workspaceVersion).toBe(1);
      expect(cfg.ai.provider).toBe('fake');

      // Second init without --force should fail
      r = await run(['init'], tmp);
      expect(r.code).toBe(2);
      expect(r.err).toContain('WORKSPACE_ALREADY_EXISTS');

      // Init with --force should succeed
      r = await run(['init', '--force'], tmp);
      expect(r.code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reads canonical test plan and writes a summary', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-plan-'));
    try {
      expect((await run(['init'], tmp)).code).toBe(0);
      const artifacts = path.join(tmp, '.tirai', 'artifacts');
      fs.writeFileSync(path.join(artifacts, 'test-plan.json'), JSON.stringify({
        scenarios: [{ id: 'SCN-1' }], testCases: [{ id: 'TC-1' }], quality: { coverageRate: 1 }, metadata: { promptVersion: 'test' },
      }));
      const result = await run(['plan', '--json'], tmp);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out).testCases).toBe(1);
      expect(fs.existsSync(path.join(artifacts, 'plan-summary.json'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exit code mapping for missing source', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-test-'));
    try {
      await run(['init'], tmp);
      const r = await run(['ingest', './nope.xlsx'], tmp);
      expect(r.code).toBe(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('ingest pdf via CLI and full pipeline', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-pdf-'));
    try {
      // Create PDF fixture dynamically using pdf-lib
      const { PDFDocument, rgb } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([600, 400]);
      page.drawText('Order Validation\nIf quantity > availableStock then INSUFFICIENT_STOCK', { x: 50, y: 300, size: 12, color: rgb(0, 0, 0) });
      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(path.join(tmp, 'spec.pdf'), pdfBytes);
      fs.cpSync(path.join(REPO, 'tools/intelligent/source-to-testcase/fixtures/order-app'), path.join(tmp, 'order-app'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test-pdf', private: true, type: 'module' }, null, 2));

      let r = await run(['init'], tmp);
      expect(r.code).toBe(0);

      r = await run(['ingest', './spec.pdf'], tmp);
      expect(r.code).toBe(0);
      expect(r.out).toContain('TIRAI ingest complete');
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/testcases.json'))).toBe(true);
      const tcsPdf = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/artifacts/testcases.json'), 'utf8'));
      const tcPdf = Array.isArray(tcsPdf) ? tcsPdf[0] : tcsPdf.testCases[0];
      expect(tcPdf).toBeDefined();

      // Create mappings same as xlsx happy path but with PDF-derived TestCase
      const catalogPdf = {
        environmentId: 'order-app',
        pages: [{ id: 'order', route: '/', elements: [
          { logicalName: 'quantity', locator: { strategy: 'test-id', value: 'quantity' } },
          { logicalName: 'availableStock', locator: { strategy: 'test-id', value: 'availableStock' } },
          { logicalName: 'submit', locator: { strategy: 'test-id', value: 'submit' } },
          { logicalName: 'result', locator: { strategy: 'test-id', value: 'result' } },
        ]}]
      };
      const e2eMappingPdf = {
        schemaVersion: '1.0',
        testMappings: [{ testCaseId: tcPdf.id, status: 'ready', ui: {
          testCaseId: tcPdf.id, executorType: 'ui',
          stepMappings: [
            { stepOrder: 1, action: 'navigate', valueLiteral: '/' },
            { stepOrder: 2, action: 'fill', targetLogicalName: 'quantity', valueLiteral: '10' },
            { stepOrder: 3, action: 'fill', targetLogicalName: 'availableStock', valueLiteral: '5' },
            { stepOrder: 4, action: 'click', targetLogicalName: 'submit' },
          ],
          assertionMappings: [{ expectedResultIndex: 0, assertionType: 'text-contains', targetLogicalName: 'result', expectedValue: 'INSUFFICIENT_STOCK' }],
        }}],
        unresolved: [],
        catalogs: { uiCatalog: catalogPdf },
        quality: { testCasesTotal: 1, ready: 1, partial: 0, manual: 0, unresolved: 0, uiMappings: 1, apiMappings: 0, databaseMappings: 0, integrationMappings: 0, stepsTotal: 4, stepsMapped: 4, assertionsTotal: 1, assertionsMapped: 1, bindingsRequired: 0, bindingsResolved: 0, catalogReferenceValidity: 1, provenanceCoverage: 1 },
      };
      fs.writeFileSync(path.join(tmp, '.tirai/mappings/e2e.json'), JSON.stringify(e2eMappingPdf, null, 2));
      const contentPdf = fs.readFileSync(path.join(tmp, 'order-app/order-validation.ts'), 'utf8');
      function stableStringifyPdf(v: unknown): string {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return `[${(v as unknown[]).map(stableStringifyPdf).join(',')}]`;
        const keys = Object.keys(v as Record<string, unknown>).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringifyPdf((v as Record<string, unknown>)[k])}`).join(',')}}`;
      }
      const cryptoPdf = await import('node:crypto');
      const fpPdf = cryptoPdf.createHash('sha256').update(stableStringifyPdf(contentPdf)).digest('hex');
      const unitMappingPdf = { mappings: [{ testCaseId: tcPdf.id, symbolRef: { sourceFile: 'order-validation.ts', symbolName: 'validateOrder' }, argumentInputNames: ['quantity','availableStock'], expectedResultIndex: 0, assertionType: 'primitive-equal', targetFingerprint: fpPdf }] };
      fs.writeFileSync(path.join(tmp, '.tirai/mappings/unit.json'), JSON.stringify(unitMappingPdf, null, 2));
      const cfgPdf = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/config.json'), 'utf8'));
      cfgPdf.unit.projectRoot = path.join(tmp, 'order-app');
      cfgPdf.e2e.startCommand = 'node order-app/server.mjs';
      fs.writeFileSync(path.join(tmp, '.tirai/config.json'), JSON.stringify(cfgPdf, null, 2));

      r = await run(['generate', '--target', 'playwright'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/generated/e2e/TC-0001.spec.ts'))).toBe(true);

      r = await run(['generate', '--target', 'vitest', '--source-mapping', path.join(tmp, '.tirai/mappings/unit.json')], tmp);
      expect(r.code).toBe(0);

      r = await run(['run'], tmp);
      expect(r.code).toBe(0);
      const e2eResPdf = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/results/e2e-run-result-ir.json'), 'utf8'));
      expect(e2eResPdf.status).toBe('passed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  it('ingest docx via CLI and full pipeline', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-docx-'));
    try {
      const { Document, Packer, Paragraph, TextRun } = await import('docx');
      const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Order Validation If quantity > availableStock then INSUFFICIENT_STOCK')] })] }] });
      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(path.join(tmp, 'spec.docx'), buffer);
      fs.cpSync(path.join(REPO, 'tools/intelligent/source-to-testcase/fixtures/order-app'), path.join(tmp, 'order-app'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test-docx', private: true, type: 'module' }, null, 2));
      let r = await run(['init'], tmp);
      expect(r.code).toBe(0);
      r = await run(['ingest', './spec.docx'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/testcases.json'))).toBe(true);
      const tcsDocx = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/artifacts/testcases.json'), 'utf8'));
      const tcDocx = Array.isArray(tcsDocx) ? tcsDocx[0] : tcsDocx.testCases[0];
      expect(tcDocx).toBeDefined();
      const catalogDocx = { environmentId: 'order-app', pages: [{ id: 'order', route: '/', elements: [
        { logicalName: 'quantity', locator: { strategy: 'test-id', value: 'quantity' } },
        { logicalName: 'availableStock', locator: { strategy: 'test-id', value: 'availableStock' } },
        { logicalName: 'submit', locator: { strategy: 'test-id', value: 'submit' } },
        { logicalName: 'result', locator: { strategy: 'test-id', value: 'result' } },
      ]}] };
      const e2eMappingDocx = { schemaVersion: '1.0', testMappings: [{ testCaseId: tcDocx.id, status: 'ready', ui: {
        testCaseId: tcDocx.id, executorType: 'ui',
        stepMappings: [
          { stepOrder: 1, action: 'navigate', valueLiteral: '/' },
          { stepOrder: 2, action: 'fill', targetLogicalName: 'quantity', valueLiteral: '10' },
          { stepOrder: 3, action: 'fill', targetLogicalName: 'availableStock', valueLiteral: '5' },
          { stepOrder: 4, action: 'click', targetLogicalName: 'submit' },
        ],
        assertionMappings: [{ expectedResultIndex: 0, assertionType: 'text-contains', targetLogicalName: 'result', expectedValue: 'INSUFFICIENT_STOCK' }],
      }}], unresolved: [], catalogs: { uiCatalog: catalogDocx }, quality: { testCasesTotal: 1, ready: 1 } };
      fs.writeFileSync(path.join(tmp, '.tirai/mappings/e2e.json'), JSON.stringify(e2eMappingDocx, null, 2));
      const contentDocx = fs.readFileSync(path.join(tmp, 'order-app/order-validation.ts'), 'utf8');
      function stableStringifyDocx(v: unknown): string {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return `[${(v as unknown[]).map(stableStringifyDocx).join(',')}]`;
        const keys = Object.keys(v as Record<string, unknown>).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringifyDocx((v as Record<string, unknown>)[k])}`).join(',')}}`;
      }
      const cryptoDocx = await import('node:crypto');
      const fpDocx = cryptoDocx.createHash('sha256').update(stableStringifyDocx(contentDocx)).digest('hex');
      const unitMappingDocx = { mappings: [{ testCaseId: tcDocx.id, symbolRef: { sourceFile: 'order-validation.ts', symbolName: 'validateOrder' }, argumentInputNames: ['quantity','availableStock'], expectedResultIndex: 0, assertionType: 'primitive-equal', targetFingerprint: fpDocx }] };
      fs.writeFileSync(path.join(tmp, '.tirai/mappings/unit.json'), JSON.stringify(unitMappingDocx, null, 2));
      const cfgDocx = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/config.json'), 'utf8'));
      cfgDocx.unit.projectRoot = path.join(tmp, 'order-app');
      cfgDocx.e2e.startCommand = 'node order-app/server.mjs';
      fs.writeFileSync(path.join(tmp, '.tirai/config.json'), JSON.stringify(cfgDocx, null, 2));
      r = await run(['generate', '--target', 'playwright'], tmp);
      expect(r.code).toBe(0);
      r = await run(['generate', '--target', 'vitest', '--source-mapping', path.join(tmp, '.tirai/mappings/unit.json')], tmp);
      expect(r.code).toBe(0);
      r = await run(['run'], tmp);
      expect(r.code).toBe(0);
      const e2eResDocx = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/results/e2e-run-result-ir.json'), 'utf8'));
      expect(e2eResDocx.status).toBe('passed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  it('ingest + generate + run happy path via CLI (no custom orchestration)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-e2e-'));
    try {
      fs.cpSync(path.join(REPO, 'tools/intelligent/source-to-testcase/fixtures/order-app'), path.join(tmp, 'order-app'), { recursive: true });
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Order Validation');
      ws.getCell('A1').value = 'Order Validation Rule';
      ws.getCell('A2').value = 'If quantity is greater than availableStock then reject the order.';
      ws.getCell('A3').value = 'Inputs: quantity, availableStock';
      ws.getCell('A4').value = 'Expected: valid=false, reason=INSUFFICIENT_STOCK';
      ws.getCell('A5').value = 'Otherwise the order is accepted with valid=true.';
      await wb.xlsx.writeFile(path.join(tmp, 'spec.xlsx'));
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, type: 'module' }, null, 2));

      let r = await run(['init'], tmp);
      expect(r.code).toBe(0);

      r = await run(['ingest', './spec.xlsx'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/testcases.json'))).toBe(true);

      // Create mappings
      const tcs = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/artifacts/testcases.json'), 'utf8'));
      const tc = Array.isArray(tcs) ? tcs[0] : tcs.testCases[0];
      const catalog = {
        environmentId: 'order-app',
        pages: [{ id: 'order', route: '/', elements: [
          { logicalName: 'quantity', locator: { strategy: 'test-id', value: 'quantity' } },
          { logicalName: 'availableStock', locator: { strategy: 'test-id', value: 'availableStock' } },
          { logicalName: 'submit', locator: { strategy: 'test-id', value: 'submit' } },
          { logicalName: 'result', locator: { strategy: 'test-id', value: 'result' } },
        ]}]
      };
      const e2eMapping = {
        schemaVersion: '1.0',
        testMappings: [{ testCaseId: tc.id, status: 'ready', ui: {
          testCaseId: tc.id, executorType: 'ui',
          stepMappings: [
            { stepOrder: 1, action: 'navigate', valueLiteral: '/' },
            { stepOrder: 2, action: 'fill', targetLogicalName: 'quantity', valueLiteral: '10' },
            { stepOrder: 3, action: 'fill', targetLogicalName: 'availableStock', valueLiteral: '5' },
            { stepOrder: 4, action: 'click', targetLogicalName: 'submit' },
          ],
          assertionMappings: [{ expectedResultIndex: 0, assertionType: 'text-contains', targetLogicalName: 'result', expectedValue: 'INSUFFICIENT_STOCK' }],
        }}],
        unresolved: [],
        catalogs: { uiCatalog: catalog },
        quality: { testCasesTotal: 1, ready: 1, partial: 0, manual: 0, unresolved: 0, uiMappings: 1, apiMappings: 0, databaseMappings: 0, integrationMappings: 0, stepsTotal: 4, stepsMapped: 4, assertionsTotal: 1, assertionsMapped: 1, bindingsRequired: 0, bindingsResolved: 0, catalogReferenceValidity: 1, provenanceCoverage: 1 },
      };
      fs.writeFileSync(path.join(tmp, '.tirai/mappings/e2e.json'), JSON.stringify(e2eMapping, null, 2));

      // Unit mapping fingerprint
      const content = fs.readFileSync(path.join(tmp, 'order-app/order-validation.ts'), 'utf8');
      function stableStringify(v: unknown): string {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return `[${(v as unknown[]).map(stableStringify).join(',')}]`;
        const keys = Object.keys(v as Record<string, unknown>).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
      }
      const crypto = await import('node:crypto');
      const fp = crypto.createHash('sha256').update(stableStringify(content)).digest('hex');
      const unitMapping = { mappings: [{ testCaseId: tc.id, symbolRef: { sourceFile: 'order-validation.ts', symbolName: 'validateOrder' }, argumentInputNames: ['quantity','availableStock'], expectedResultIndex: 0, assertionType: 'primitive-equal', targetFingerprint: fp }] };
      fs.writeFileSync(path.join(tmp, '.tirai/mappings/unit.json'), JSON.stringify(unitMapping, null, 2));

      const cfg = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/config.json'), 'utf8'));
      cfg.unit.projectRoot = path.join(tmp, 'order-app');
      cfg.e2e.startCommand = 'node order-app/server.mjs';
      fs.writeFileSync(path.join(tmp, '.tirai/config.json'), JSON.stringify(cfg, null, 2));

      r = await run(['generate', '--target', 'playwright'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/generated/e2e/TC-0001.spec.ts'))).toBe(true);

      r = await run(['generate', '--target', 'vitest', '--source-mapping', path.join(tmp, '.tirai/mappings/unit.json')], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/generated/unit/TC-0001.spec.ts'))).toBe(true);

      r = await run(['run'], tmp);
      expect(r.code).toBe(0);
      const e2eRes = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/results/e2e-run-result-ir.json'), 'utf8'));
      const unitRes = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/results/unit-run-result-ir.json'), 'utf8'));
      expect(e2eRes.status).toBe('passed');
      expect(unitRes.status).toBe('passed');
      expect(e2eRes.summary.testsTotal).toBe(1);
      expect(unitRes.summary.testsTotal).toBe(1);

      r = await run(['report'], tmp);
      expect(r.code).toBe(0);
      expect(r.out).toContain('TIRAI run summary');
      expect(fs.existsSync(path.join(tmp, '.tirai/reports/latest-summary.md'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  it('ingest → generate --target vitest → run from TestCase JSON without source mapping', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-standalone-'));
    try {
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Order Validation');
      ws.getCell('A1').value = 'Order Validation Rule';
      ws.getCell('A2').value = 'If quantity is greater than availableStock then reject the order.';
      ws.getCell('A3').value = 'Inputs: quantity, availableStock';
      ws.getCell('A4').value = 'Expected: valid=false, reason=INSUFFICIENT_STOCK';
      await wb.xlsx.writeFile(path.join(tmp, 'spec.xlsx'));
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'standalone-unit', private: true, type: 'module' }, null, 2));

      let r = await run(['init'], tmp);
      expect(r.code).toBe(0);
      r = await run(['ingest', './spec.xlsx'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/testcases.json'))).toBe(true);

      r = await run(['generate', '--target', 'vitest'], tmp);
      expect(r.code).toBe(2); // Blocked: no source mapping
      expect(r.err).toContain('MAPPING_MISSING');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);
});
