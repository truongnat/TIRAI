// ---------------------------------------------------------------------------
// Fingerprint – deterministic hash for resume support
// ---------------------------------------------------------------------------

import * as crypto from 'node:crypto';

/**
 * Compute a SHA-256 fingerprint for the test planning inputs.
 *
 * Includes: requirement IR content hash + prompt version + model.
 * Does NOT include API keys or sensitive data.
 */
export function computeFingerprint(
  requirementIRContent: string,
  promptVersion: string,
  model: string,
): string {
  const data = `${requirementIRContent}|||${promptVersion}|||${model}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
