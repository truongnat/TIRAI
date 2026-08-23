// ---------------------------------------------------------------------------
// Test Data Planner – deterministic hash for resume support
// ---------------------------------------------------------------------------

import * as crypto from 'node:crypto';

/**
 * Compute a SHA-256 fingerprint for the test data planning inputs.
 *
 * Includes: test case IR content hash + test plan IR hash (if relevant) +
 * prompt version + model + schema version.
 */
export function computeFingerprint(
  testCaseIRContent: string,
  promptVersion: string,
  model: string,
  testPlanIRContent?: string,
): string {
  const parts = [testCaseIRContent, promptVersion, model];
  if (testPlanIRContent) {
    parts.push(testPlanIRContent);
  }
  const data = parts.join('|||');
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
