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

    // 6. Ingest (creates canonical artifacts)
    r = await run(['ingest', './spec.xlsx'], tmp);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'artifacts', 'testcases.json'))).toBe(true);

    // 7. Export all formats
    r = await run(['export', '--format', 'all'], tmp);
    expect(r.code).toBe(0);

    // Verify outputs exist
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'json', 'test-cases.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'excel', 'test-cases.xlsx'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'markdown', 'test-cases.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'pdf', 'test-cases.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.tirai', 'outputs', 'docx', 'test-cases.docx'))).toBe(true);

    // 8. Execute
    r = await run(['execute', '--platform', 'web', '--environment', 'staging'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('execute complete');

    // 9. Status
    r = await run(['status'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Specs:');
    expect(r.out).toContain('TestCases:');

    // 10. Help
    r = await run(['--help'], tmp);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tirai');
    expect(r.out).toContain('export');
    expect(r.out).toContain('execute');
  }, 120000);
});
