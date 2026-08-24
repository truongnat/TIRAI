// ---------------------------------------------------------------------------
// Output writer – persists Semantic IR, manifest, and intermediate results
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SemanticIR, AnalysisManifest, ChunkSemanticResult, ConsolidationResult } from '../models.js';
import { hashSemanticResult } from '../fingerprint.js';

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
  intermediateResults: Array<{ contextId: string; result: ChunkSemanticResult; provider: string; model: string; usage: Record<string, unknown>; fingerprint?: string; promptVersion?: string }>,
): void {
  const absDir = path.resolve(outputDir);
  fs.mkdirSync(absDir, { recursive: true });

  // Write semantic-ir.json
  atomicWrite(path.join(absDir, 'semantic-ir.json'), JSON.stringify(semanticIR, null, 2));

  // Write manifest.json
  atomicWrite(path.join(absDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Write intermediate analysis files
  const analysisDir = path.join(absDir, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  for (const item of intermediateResults) {
    atomicWrite(path.join(analysisDir, `${item.contextId}.json`), JSON.stringify({
      contextId: item.contextId,
      provider: item.provider,
      model: item.model,
      promptVersion: item.promptVersion,
      fingerprint: item.fingerprint,
      resultHash: hashSemanticResult(item.result),
      result: item.result,
      usage: item.usage,
    }, null, 2));
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
  fingerprint: string,
  promptVersion: string,
): void {
  const analysisDir = path.join(path.resolve(outputDir), 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  atomicWrite(path.join(analysisDir, `${contextId}.json`), JSON.stringify({
    contextId,
    provider,
    model,
    promptVersion,
    fingerprint,
    resultHash: hashSemanticResult(result),
    result,
    usage,
  }, null, 2));
}

/**
 * Read a cached intermediate result if it exists and fingerprint matches.
 */
export function readIntermediateResult(
  outputDir: string,
  contextId: string,
  expectedFingerprint: string,
  expectedProvider?: string,
  expectedModel?: string,
  expectedPromptVersion?: string,
): { result: ChunkSemanticResult; usage: Record<string, unknown> } | null {
  const filePath = path.join(path.resolve(outputDir), 'analysis', `${contextId}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (data.fingerprint !== expectedFingerprint) return null;
    if (expectedProvider && data.provider !== expectedProvider) return null;
    if (expectedModel && data.model !== expectedModel) return null;
    if (expectedPromptVersion && data.promptVersion !== expectedPromptVersion) return null;
    if (data.resultHash !== hashSemanticResult(data.result)) return null;
    return { result: data.result, usage: data.usage ?? {} };
  } catch {
    return null;
  }
}

export function writeConsolidationCheckpoint(
  outputDir: string,
  fingerprint: string,
  result: ConsolidationResult,
  provider: string,
  model: string,
  promptVersion: string,
): void {
  const absDir = path.resolve(outputDir);
  fs.mkdirSync(absDir, { recursive: true });
  atomicWrite(path.join(absDir, 'consolidation-checkpoint.json'), JSON.stringify({
    fingerprint,
    provider,
    model,
    promptVersion,
    resultHash: hashSemanticResult(result),
    result,
  }, null, 2));
}

export function readConsolidationCheckpoint(
  outputDir: string,
  fingerprint: string,
  provider: string,
  model: string,
  promptVersion: string,
): ConsolidationResult | null {
  const filePath = path.join(path.resolve(outputDir), 'consolidation-checkpoint.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    if (data.fingerprint !== fingerprint || data.provider !== provider || data.model !== model || data.promptVersion !== promptVersion) return null;
    if (data.resultHash !== hashSemanticResult(data.result)) return null;
    return data.result as ConsolidationResult;
  } catch {
    return null;
  }
}

function atomicWrite(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content, 'utf-8');
  fs.renameSync(temporaryPath, filePath);
}
