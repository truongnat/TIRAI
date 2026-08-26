// Fingerprint – content-addressable identity, canonical diff, and revision snapshots.
//
// Single source of truth for:
// - SHA-256 hashing and content-addressable IDs
// - Canonical JSON serialization
// - Source-agnostic revision diff
// - Revision snapshot creation

export { sha256, stableId, canonicalJson, objectHash, contentHash } from './hash.js';
export { computeDiff, mergeDiffResults } from './diff.js';
export { createSnapshot, createSnapshotWithTrace } from './snapshot.js';

export type { ChangeClassification, DiffItem, DiffResult } from './diff.js';
export type { RevisionSnapshot, RevisionSnapshotMetadata } from './snapshot.js';
