// Static validation (spec §17).
//
// Before execution, a generated file must:
//   1. parse as TypeScript (no syntax errors), and
//   2. be discoverable by the Playwright test runner.
//
// A syntactically invalid file is NEVER allowed to proceed to execution.

import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';

import type { ValidationOutcome } from './models.js';

const execFileAsync = promisify(execFile);

export interface ValidationOptions {
  /** Playwright config used for discovery; if omitted discovery is skipped. */
  configPath?: string;
  playwrightBin?: string;
}

function parseOk(source: string): { ok: boolean; errors: string[] } {
  const sf = ts.createSourceFile('generated.spec.ts', source, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  const errors = diags.map((d) => {
    const pos = d.start ?? 0;
    const { line, character } = sf.getLineAndCharacterOfPosition(pos);
    return `Line ${line + 1}:${character + 1} — ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  });
  return { ok: errors.length === 0, errors };
}

async function discoverable(
  filePath: string,
  opts: ValidationOptions,
): Promise<{ ok: boolean; errors: string[] }> {
  if (!opts.configPath) return { ok: true, errors: [] };
  try {
    const bin = opts.playwrightBin ?? 'npx';
    const args =
      bin === 'npx'
        ? ['playwright', 'test', '--list', '--config', opts.configPath]
        : ['test', '--list', '--config', opts.configPath];
    const { stdout } = await execFileAsync(bin, args, { timeout: 120_000 });
    const base = filePath.split(/[\\/]/).pop() ?? filePath;
    const ok = stdout.includes(base);
    return {
      ok,
      errors: ok ? [] : [`File '${base}' was not discovered by Playwright`],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`Playwright discovery failed: ${message.split('\n')[0]}`] };
  }
}

export async function validateGeneratedSource(
  filePath: string,
  opts: ValidationOptions = {},
): Promise<ValidationOutcome> {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      filePath,
      status: 'invalid',
      parseOk: false,
      discoverable: false,
      formattedWith: 'prettier',
      errors: [`Cannot read file: ${err instanceof Error ? err.message : String(err)}`],
      blockedReason: 'file-unreadable',
    };
  }

  const parsed = parseOk(source);
  const discovered = await discoverable(filePath, opts);

  const ok = parsed.ok && discovered.ok;
  const errors = [...parsed.errors, ...discovered.errors];

  return {
    filePath,
    status: ok ? 'valid' : 'invalid',
    parseOk: parsed.ok,
    discoverable: discovered.ok,
    formattedWith: 'prettier',
    errors,
    blockedReason: ok ? undefined : 'static-validation-failed',
  };
}
