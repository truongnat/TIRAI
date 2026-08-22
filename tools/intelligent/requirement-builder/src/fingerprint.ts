// ---------------------------------------------------------------------------
// Fingerprint – deterministic hash for resume support
// ---------------------------------------------------------------------------

import * as crypto from 'node:crypto';

/**
 * Compute a SHA-256 fingerprint for the requirement build inputs.
 *
 * Includes: semantic IR content hash + prompt version + model.
 * Does NOT include API keys or sensitive data.
 */
export function computeFingerprint(
  semanticIRContent: string,
  promptVersion: string,
  model: string,
): string {
  const data = `${semanticIRContent}|||${promptVersion}|||${model}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
