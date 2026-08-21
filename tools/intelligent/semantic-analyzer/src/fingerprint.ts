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
): string {
  const data = `${chunkContent}|||${promptVersion}|||${model}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
