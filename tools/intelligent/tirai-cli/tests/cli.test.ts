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
      expect(cfg.version).toBe(1);
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

  it('ingest + generate + run happy path via CLI (no custom orchestration)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-e2e-'));
    try {
      // Copy fixture
      fs.cpSync(path.join(REPO, 'tools/intelligent/source-to-testcase/fixtures/order-app'), path.join(tmp, 'order-app'), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'output/phase-5-4-full-core/source/acceptance.xlsx'), path.join(tmp, 'spec.xlsx'));
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

      r = await run(['generate'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/generated/e2e/TC-0001.spec.ts'))).toBe(true);
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
});
