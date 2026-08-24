// ---------------------------------------------------------------------------
// Fingerprint – deterministic hash for resume support
// ---------------------------------------------------------------------------

import * as crypto from 'node:crypto';

/**
 * Compute a SHA-256 fingerprint for a chunk + prompt version + model.
 *
 * Used to determine if a cached intermediate result is still valid.
 * Does NOT include API keys or sensitive data.
 */
export function computeFingerprint(
  chunkContent: string,
  promptVersion: string,
  model: string,
  analyzerVersion = 'semantic-analyzer@1.2',
  schemaVersion = '1.0',
): string {
  const data = `${chunkContent}|||${promptVersion}|||${model}|||${analyzerVersion}|||${schemaVersion}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export function hashSemanticResult(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function computeConsolidationFingerprint(
  results: unknown[],
  promptVersion: string,
  model: string,
  batchConfiguration: unknown,
): string {
  return hashSemanticResult({
    results: results.map(hashSemanticResult),
    promptVersion,
    model,
    batchConfiguration,
    analyzerVersion: 'semantic-analyzer@1.2',
  }).slice(0, 16);
}
