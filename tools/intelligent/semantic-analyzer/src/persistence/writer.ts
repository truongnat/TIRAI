// ---------------------------------------------------------------------------
// Output writer – persists Semantic IR, manifest, and intermediate results
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SemanticIR, AnalysisManifest, ChunkSemanticResult } from '../models.js';

/**
 * Write the complete analysis output to disk.
 *
 * Structure:
 *   outputDir/
 *   ├── semantic-ir.json
 *   ├── manifest.json
 *   └── analysis/
 *       ├── ctx-s000-c000.json
 *       └── ...
 */
export function writeOutput(
  outputDir: string,
  semanticIR: SemanticIR,
  manifest: AnalysisManifest,
  intermediateResults: Array<{ contextId: string; result: ChunkSemanticResult; provider: string; model: string; usage: Record<string, unknown> }>,
): void {
  const absDir = path.resolve(outputDir);
  fs.mkdirSync(absDir, { recursive: true });

  // Write semantic-ir.json
  fs.writeFileSync(
    path.join(absDir, 'semantic-ir.json'),
    JSON.stringify(semanticIR, null, 2),
    'utf-8',
  );

  // Write manifest.json
  fs.writeFileSync(
    path.join(absDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // Write intermediate analysis files
  const analysisDir = path.join(absDir, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  for (const item of intermediateResults) {
    fs.writeFileSync(
      path.join(analysisDir, `${item.contextId}.json`),
      JSON.stringify(
        {
          contextId: item.contextId,
          provider: item.provider,
          model: item.model,
          result: item.result,
          usage: item.usage,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }
}

/**
 * Write a single intermediate result (for incremental/resume support).
 */
export function writeIntermediateResult(
  outputDir: string,
  contextId: string,
  result: ChunkSemanticResult,
  provider: string,
  model: string,
  usage: Record<string, unknown>,
): void {
  const analysisDir = path.join(path.resolve(outputDir), 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  fs.writeFileSync(
    path.join(analysisDir, `${contextId}.json`),
    JSON.stringify({ contextId, provider, model, result, usage }, null, 2),
    'utf-8',
  );
}

/**
 * Read a cached intermediate result if it exists and fingerprint matches.
 */
export function readIntermediateResult(
  outputDir: string,
  contextId: string,
  expectedFingerprint: string,
): { result: ChunkSemanticResult; usage: Record<string, unknown> } | null {
  const filePath = path.join(path.resolve(outputDir), 'analysis', `${contextId}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (data.fingerprint && data.fingerprint !== expectedFingerprint) return null;
    return { result: data.result, usage: data.usage ?? {} };
  } catch {
    return null;
  }
}
