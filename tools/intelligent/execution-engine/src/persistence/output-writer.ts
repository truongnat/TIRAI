// ---------------------------------------------------------------------------
// Execution Engine – output writer
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExecutionResultIR, ExecutionManifest } from '../models.js';

/** Write execution result, manifest, and audit trail to output directory. */
export function writeOutput(
  outputDir: string,
  result: ExecutionResultIR,
  manifest: ExecutionManifest,
): void {
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(
    path.join(outputDir, 'execution-result-ir.json'),
    JSON.stringify(result, null, 2),
  );

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  fs.writeFileSync(
    path.join(outputDir, 'audit-trail.json'),
    JSON.stringify(result.auditTrail, null, 2),
  );

  fs.writeFileSync(
    path.join(outputDir, 'quality-report.json'),
    JSON.stringify(result.quality, null, 2),
  );
}

/** Load a previously written execution result from disk. */
export function loadOutput(outputDir: string): ExecutionResultIR {
  const content = fs.readFileSync(path.join(outputDir, 'execution-result-ir.json'), 'utf-8');
  return JSON.parse(content) as ExecutionResultIR;
}
