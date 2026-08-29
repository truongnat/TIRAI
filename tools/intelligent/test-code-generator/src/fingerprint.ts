// Deterministic fingerprinting helpers (spec §13, §14).
//
// All fingerprints are content hashes; no timestamps, random IDs, or
// machine-specific absolute paths are included.

import { createHash } from 'node:crypto';

/** Deterministic JSON serialization that ignores key ordering. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Short, stable, human-readable id used for artifact traceability. */
export function artifactIdFrom(seed: string): string {
  return `tirai-gen-${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}
