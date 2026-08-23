// ---------------------------------------------------------------------------
// Persistence – output writer
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ExecutableDataPreparationIR,
  DataResolverManifest,
} from '../models.js';

/**
 * Write resolution output to disk.
 *
 * Creates:
 * - executable-data-preparation-ir.json
 * - manifest.json
 * - quality-report.json
 */
export function writeOutput(
  outputDir: string,
  ir: ExecutableDataPreparationIR,
  manifest: DataResolverManifest,
): void {
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(
    path.join(outputDir, 'executable-data-preparation-ir.json'),
    JSON.stringify(ir, null, 2),
  );

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  fs.writeFileSync(
    path.join(outputDir, 'quality-report.json'),
    JSON.stringify(ir.quality, null, 2),
  );
}

/**
 * Load an existing ExecutableDataPreparationIR from disk.
 */
export function loadOutput(outputDir: string): ExecutableDataPreparationIR {
  const irPath = path.join(outputDir, 'executable-data-preparation-ir.json');
  const content = fs.readFileSync(irPath, 'utf-8');
  return JSON.parse(content) as ExecutableDataPreparationIR;
}
