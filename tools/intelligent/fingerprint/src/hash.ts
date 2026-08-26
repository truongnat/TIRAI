// ---------------------------------------------------------------------------
// Hash primitives – SHA-256 content-addressable identity
// ---------------------------------------------------------------------------
// Single source of truth for all hashing in the TIRAI pipeline.
// Every module MUST import from here instead of using `crypto` directly.

import { createHash } from 'node:crypto';

/** SHA-256 hex digest of a string or Buffer. */
export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Content-addressable ID: prefix + truncated SHA-256. */
export function stableId(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

/** Canonical JSON serialization with recursively sorted keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

/** SHA-256 of the canonical JSON representation of any value. */
export function objectHash(obj: unknown): string {
  return sha256(canonicalJson(obj));
}

/**
 * Content-addressable identity for any pipeline artifact.
 * Hashes the canonical form of the object's content fields.
 */
export function contentHash(...fields: unknown[]): string {
  const canonical = canonicalJson(fields.length === 1 ? fields[0] : fields);
  return sha256(canonical);
}
