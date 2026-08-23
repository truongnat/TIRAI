// Persistence — writes run artifacts to output directory (spec §52-54).
//
// Creates isolated artifact directory per run. Validates paths.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type {
  EndToEndRunResultIR,
  EndToEndRunManifest,
  RunnerAuditEvent,
} from '../models.js';
import { generateJUnit, generateSummaryMd, generateSummaryJson } from '../reporting/index.js';
import { EndToEndRunnerError } from '../errors.js';

function safePath(filePath: string, root: string): string {
  const resolved = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new EndToEndRunnerError('RUNNER_PATH_ESCAPE', `Path escapes output root: ${filePath}`);
  }
  return resolved;
}

export interface WriteRunOutputOptions {
  outputDir: string;
  result: EndToEndRunResultIR;
  manifest: EndToEndRunManifest;
  auditEvents: RunnerAuditEvent[];
  pretty?: boolean;
}

export async function writeRunOutput(opts: WriteRunOutputOptions): Promise<void> {
  const { outputDir, result, manifest, auditEvents, pretty } = opts;
  const indent = pretty ? 2 : undefined;

  await mkdir(outputDir, { recursive: true });

  // run-result-ir.json
  await writeFile(
    safePath(resolve(outputDir, 'run-result-ir.json'), outputDir),
    JSON.stringify(result, null, indent),
    'utf-8',
  );

  // manifest.json
  await writeFile(
    safePath(resolve(outputDir, 'manifest.json'), outputDir),
    JSON.stringify(manifest, null, indent),
    'utf-8',
  );

  // summary.json
  await writeFile(
    safePath(resolve(outputDir, 'summary.json'), outputDir),
    JSON.stringify(generateSummaryJson(result), null, indent),
    'utf-8',
  );

  // summary.md
  await writeFile(
    safePath(resolve(outputDir, 'summary.md'), outputDir),
    generateSummaryMd(result),
    'utf-8',
  );

  // junit.xml
  await writeFile(
    safePath(resolve(outputDir, 'junit.xml'), outputDir),
    generateJUnit(result.tests),
    'utf-8',
  );

  // audit-trail.json
  await writeFile(
    safePath(resolve(outputDir, 'audit-trail.json'), outputDir),
    JSON.stringify(auditEvents, null, indent),
    'utf-8',
  );
}
