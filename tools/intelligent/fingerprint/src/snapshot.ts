// ---------------------------------------------------------------------------
// Revision Snapshot – pipeline stage output with canonical IR hash
// ---------------------------------------------------------------------------
// Every pipeline stage produces a snapshot that carries the canonical IR hash
// and trace graph, enabling cross-revision comparison.

import { canonicalJson, sha256 } from './hash.js';

export interface RevisionSnapshotMetadata {
  /** ISO-8601 timestamp of snapshot creation. */
  createdAt: string;
  /** Pipeline stage that produced this snapshot. */
  stage: string;
  /** Source revision ID. */
  revisionId: string;
  /** Source content hash at time of snapshot. */
  sourceContentHash: string;
}

export interface RevisionSnapshot<T = unknown> {
  /** Schema version for forward compatibility. */
  schemaVersion: '1.0';
  /** Snapshot metadata. */
  metadata: RevisionSnapshotMetadata;
  /** Canonical hash of the IR content (deterministic, content-addressable). */
  irHash: string;
  /** The actual IR payload. */
  ir: T;
  /** Trace graph at this snapshot point. */
  traceHash?: string;
}

/**
 * Create a revision snapshot from an IR payload.
 * The irHash is computed deterministically from the canonical JSON of the IR.
 */
export function createSnapshot<T>(
  ir: T,
  metadata: Omit<RevisionSnapshotMetadata, 'createdAt'>,
): RevisionSnapshot<T> {
  return {
    schemaVersion: '1.0',
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
    },
    irHash: sha256(canonicalJson(ir)),
    ir,
  };
}

/**
 * Create a revision snapshot with an explicit trace hash.
 */
export function createSnapshotWithTrace<T>(
  ir: T,
  metadata: Omit<RevisionSnapshotMetadata, 'createdAt'>,
  trace: unknown,
): RevisionSnapshot<T> {
  return {
    schemaVersion: '1.0',
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
    },
    irHash: sha256(canonicalJson(ir)),
    ir,
    traceHash: sha256(canonicalJson(trace)),
  };
}
