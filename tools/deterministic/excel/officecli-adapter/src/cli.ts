#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectWorkbook, probeCell } from './officecli.js';
import { compareSnapshots } from './normalize.js';
import type { NativeWorkbook } from './native-types.js';

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const command = args[0];
  if (command === 'inspect') {
    const input = required('--input');
    const output = required('--output');
    const snapshot = await inspectWorkbook(input, { binary: value('--binary'), expectedVersion: value('--expected-version'), timeoutMs: numberValue('--timeout-ms', 120_000), sheets: values('--sheet'), rawParts: values('--raw-part') });
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (args.includes('--quiet')) {
      process.stdout.write(`${JSON.stringify({ sheets: snapshot.sheets.length, cells: snapshot.sheets.reduce((count, sheet) => count + sheet.cells.length, 0), mergedRanges: snapshot.sheets.reduce((count, sheet) => count + sheet.mergedRanges.length, 0), warnings: snapshot.warnings.length })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    }
    return;
  }
  if (command === 'compare') {
    const native = JSON.parse(readFileSync(required('--native'), 'utf8')) as NativeWorkbook;
    const office = JSON.parse(readFileSync(required('--officecli'), 'utf8'));
    const report = compareSnapshots(native, office, value('--scope') ?? 'unknown');
    const output = value('--output');
    if (output) { mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (command === 'probe-cell') {
    const result = await probeCell(required('--input'), required('--sheet'), required('--address'), { binary: value('--binary'), timeoutMs: numberValue('--timeout-ms', 120_000) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new Error('Usage: officecli-adapter inspect --input <xlsx> --output <json> | compare --native <json> --officecli <json>');
}

function values(flag: string): string[] { const result: string[] = []; for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) result.push(args[++i]); return result; }
function value(flag: string): string | undefined { return values(flag)[0]; }
function required(flag: string): string { const result = value(flag); if (!result) throw new Error(`${flag} is required`); return result; }
function numberValue(flag: string, fallback: number): number { const parsed = Number(value(flag)); return Number.isFinite(parsed) ? parsed : fallback; }

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
