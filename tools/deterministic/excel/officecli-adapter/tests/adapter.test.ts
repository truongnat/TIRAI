import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/process.js';
import { compareSnapshots } from '../src/normalize.js';
import { inspectWorkbook, probeCell } from '../src/officecli.js';
import type { NativeWorkbook } from '../src/native-types.js';

async function fakeOfficeCli(): Promise<{ dir: string; command: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tirai-officecli-'));
  const file = path.join(dir, '日本語 path [safe] ✓.xlsx');
  await writeFile(file, 'fixture');
  const command = path.join(dir, 'fake-officecli.mjs');
  await writeFile(command, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('1.0.test'); process.exit(0); }
if (args[0] === 'close') process.exit(0);
if (args[0] === 'view') { console.log(JSON.stringify({ success:true, data:{ sheets:[{name:'表紙',rows:10,cols:4}] } })); process.exit(0); }
if (args[0] === 'raw') { console.log(JSON.stringify({ success:true, data:'<x:worksheet><x:mergeCell ref="C21:H22" /></x:worksheet>' })); process.exit(0); }
if (args[0] === 'get' && args[2] === '/表紙/D21') { console.log(JSON.stringify({success:true,data:{results:[{path:'/表紙/D21',type:'cell',text:'',format:{type:'Number',empty:true,merge:'C21:H22'}}]}})); process.exit(0); }
if (args[0] === 'get') { console.log(JSON.stringify({success:true,data:{results:[{path:'/表紙',type:'sheet',format:{},children:[{path:'/表紙/row[2]',type:'row',children:[{path:'/表紙/A2',type:'cell',text:'ok',format:{type:'SharedString'}}]}]}]}})); process.exit(0); }
process.stderr.write('bad command'); process.exit(2);
`);
  await chmod(command, 0o755);
  return { dir, command, file };
}

describe('OfficeCLI adapter process safety', () => {
  it('passes Unicode and shell-special paths as argv without a shell', async () => {
    const fixture = await fakeOfficeCli();
    try {
      const result = await inspectWorkbook(fixture.file, { binary: fixture.command });
      expect(result.file.unchanged).toBe(true);
      expect(result.sheets[0]?.cells[0]?.address).toBe('A2');
      expect(result.sheets[0]?.mergedRanges).toEqual(['C21:H22']);
      expect(result.officeCliVersion).toBe('1.0.test');
      await expect(inspectWorkbook(fixture.file, { binary: fixture.command, expectedVersion: '1.0.144' })).rejects.toThrow('OFFICECLI_VERSION_MISMATCH');
    } finally { await rm(fixture.dir, { recursive: true, force: true }); }
  });

  it('probes an empty merged cell without fabricating it in sheet enumeration', async () => {
    const fixture = await fakeOfficeCli();
    try {
      const cell = await probeCell(fixture.file, '表紙', 'D21', { binary: fixture.command });
      expect(cell.text).toBe('');
      expect(cell.format.merge).toBe('C21:H22');
      expect(cell.format.empty).toBe(true);
    } finally { await rm(fixture.dir, { recursive: true, force: true }); }
  });

  it('returns structured non-zero and timeout results', async () => {
    const nonZero = await runCommand({ command: process.execPath, args: ['-e', 'process.stderr.write("bad"); process.exit(7)'] });
    expect(nonZero.exitCode).toBe(7);
    expect(nonZero.stderr).toBe('bad');
    const timeout = await runCommand({ command: process.execPath, args: ['-e', 'setTimeout(()=>{}, 10000)'], timeoutMs: 20 });
    expect(timeout.timedOut).toBe(true);
  });

  it('rejects malformed OfficeCLI JSON instead of accepting partial output', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tirai-officecli-malformed-'));
    const file = path.join(dir, 'input.xlsx');
    const command = path.join(dir, 'malformed.mjs');
    await writeFile(file, 'fixture');
    await writeFile(command, `#!/usr/bin/env node\nif (process.argv[2] === '--version') console.log('1.0.test'); else if (process.argv[2] !== 'close') console.log('{bad');\n`);
    await chmod(command, 0o755);
    try { await expect(inspectWorkbook(file, { binary: command })).rejects.toThrow('OFFICECLI_INVALID_JSON'); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('OfficeCLI parity normalization', () => {
  it('records exact agreement, native-only styled-empty support, and conflicts', () => {
    const native: NativeWorkbook = { file: { name: 'fixture.xlsx' }, sheets: [{ name: '表紙', cells: [{ address: 'A1', rawValue: 'A', displayValue: 'A', styleId: 's1', formula: null, hyperlink: null }, { address: 'D21', rawValue: null, displayValue: null, styleId: 's2', formula: null, hyperlink: null }], mergedRanges: [{ range: 'C21:H22' }], annotations: [], validations: [], tables: [], conditionalFormatting: [], pageSetup: null, objects: [] }] };
    const office = { schemaVersion: 'officecli-evaluation-1.0' as const, backend: 'officecli' as const, officeCliVersion: '1.0.test', file: { path: 'fixture.xlsx', name: 'fixture.xlsx', sizeBytes: 1, sha256Before: 'a', sha256After: 'a', unchanged: true }, sheets: [{ name: '表紙', rowCount: 10, columnCount: 4, visibility: null, cells: [{ address: 'A1', text: 'different', type: 'SharedString', empty: false, formula: null, merge: null, mergeAnchor: false, format: { type: 'SharedString' }, source: { backend: 'officecli' as const, workbook: 'fixture.xlsx', sheet: '表紙', address: 'A1' } }], mergedRanges: ['C21:H22'], metadata: {}, warnings: [] }], capabilities: { styledEmptyCells: 'UNSUPPORTED' as const }, warnings: [] };
    const report = compareSnapshots(native, office, 'fixture');
    expect(report.conflicts).toHaveLength(1);
    expect(report.capabilities.styledEmptyCells.agreement).toBe('NATIVE_ONLY');
    expect(report.metrics['表紙.mergedRanges'].agreement).toBe('EXACT');
  });
});
