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

const UNSAFE_KEY = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|header|credential|private|absolute|path|url|link)/i;

export function sanitizeMetadata(input: Record<string, unknown>): Record<string, SanitizedMetadataValue> {
  const output: Record<string, SanitizedMetadataValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_KEYS.has(key) || UNSAFE_KEY.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      if (typeof value === 'string' && value.length > 256) {
        output[key] = value.slice(0, 256);
      } else {
        output[key] = value;
      }
    }
  }
  return output;
}

export function assertNoRawCredentialMetadata(metadata: Record<string, unknown>): void {
  for (const key of Object.keys(metadata)) {
    if (UNSAFE_KEY.test(key)) {
      throw new Error(`SOURCE_METADATA_UNSAFE_KEY:${key}`);
    }
  }
}
