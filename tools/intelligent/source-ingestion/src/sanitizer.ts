import type { SanitizedMetadataValue } from './models.js';

const SAFE_KEYS = new Set([
  'displayName',
  'extension',
  'mediaType',
  'headingLevel',
  'lineStart',
  'lineEnd',
  'blockIndex',
  'sheetName',
  'sheetIndex',
  'range',
  'chunkType',
  'byteLength',
]);

const UNSAFE_KEY =
  /(path|url|link|password|secret|token|api.?key|auth|cookie|header|credential|private)/i;

export function sanitizeMetadata(
  metadata: Record<string, unknown>,
): Record<string, SanitizedMetadataValue> {
  const output: Record<string, SanitizedMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_KEYS.has(key) || UNSAFE_KEY.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    }
  }
  return output;
}

export function assertNoRawCredentials(value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawCredentials(item);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key)) {
      throw new Error(`Raw connector credential or private metadata key is not allowed: ${key}`);
    }
    assertNoRawCredentials(child);
  }
}
