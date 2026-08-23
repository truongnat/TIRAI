// Execution Mapping Builder — Persistence (output writer).
//
// Writes the final ExecutionMappingIR and supporting artifacts to disk.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExecutionMappingResult,
} from '../models.js';

// ---- Output manifest -------------------------------------------------------

export interface OutputManifest {
  schemaVersion: string;
  generatedAt: string;
  builderVersion: string;
  files: string[];
  aiCalls: number;
  tokensUsed: number;
  repairs: number;
  checkpointReused: boolean;
}

// ---- Write output to directory ---------------------------------------------

export function writeOutput(
  outputDir: string,
  result: ExecutionMappingResult,
): void {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'intermediate'), { recursive: true });

  const files: string[] = [];

  // Main mapping IR
  const mappingPath = join(outputDir, 'execution-mapping-ir.json');
  writeFileSync(mappingPath, JSON.stringify(result.mapping, null, 2));
  files.push('execution-mapping-ir.json');

  // Quality report
  const qualityPath = join(outputDir, 'quality-report.json');
  writeFileSync(qualityPath, JSON.stringify(result.mapping.quality, null, 2));
  files.push('quality-report.json');

  // Catalog references
  if (result.mapping.catalogs.uiCatalog) {
    const catalogPath = join(outputDir, 'ui-catalog-used.json');
    writeFileSync(catalogPath, JSON.stringify(result.mapping.catalogs.uiCatalog, null, 2));
    files.push('ui-catalog-used.json');
  }

  // Manifest
  const manifest: OutputManifest = {
    schemaVersion: result.mapping.schemaVersion,
    generatedAt: new Date().toISOString(),
    builderVersion: '1.0.0',
    files,
    aiCalls: result.aiCalls,
    tokensUsed: result.tokensUsed,
    repairs: result.repairs,
    checkpointReused: result.checkpointReused,
  };

  const manifestPath = join(outputDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  files.push('manifest.json');
}
