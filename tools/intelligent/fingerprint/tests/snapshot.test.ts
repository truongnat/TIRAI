import { describe, it, expect } from 'vitest';
import { createSnapshot, createSnapshotWithTrace } from '../src/snapshot.js';
import { sha256 } from '../src/hash.js';

describe('snapshot — createSnapshot', () => {
  it('creates a snapshot with irHash', () => {
    const ir = { requirements: [{ id: 'REQ-0001', title: 'Test' }] };
    const snapshot = createSnapshot(ir, {
      stage: 'REQUIREMENT_BUILDING',
      revisionId: 'rev-001',
      sourceContentHash: 'abc123',
    });
    expect(snapshot.schemaVersion).toBe('1.0');
    expect(snapshot.irHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.ir).toEqual(ir);
    expect(snapshot.metadata.stage).toBe('REQUIREMENT_BUILDING');
    expect(snapshot.metadata.revisionId).toBe('rev-001');
    expect(snapshot.metadata.sourceContentHash).toBe('abc123');
    expect(snapshot.metadata.createdAt).toBeDefined();
  });

  it('produces deterministic irHash', () => {
    const ir = { a: 1, b: 2 };
    const s1 = createSnapshot(ir, { stage: 'test', revisionId: 'r1', sourceContentHash: 'h1' });
    const s2 = createSnapshot(ir, { stage: 'test', revisionId: 'r1', sourceContentHash: 'h1' });
    expect(s1.irHash).toBe(s2.irHash);
  });

  it('different ir for different irHash', () => {
    const s1 = createSnapshot({ a: 1 }, { stage: 'test', revisionId: 'r1', sourceContentHash: 'h1' });
    const s2 = createSnapshot({ a: 2 }, { stage: 'test', revisionId: 'r1', sourceContentHash: 'h1' });
    expect(s1.irHash).not.toBe(s2.irHash);
  });
});

describe('snapshot — createSnapshotWithTrace', () => {
  it('creates a snapshot with traceHash', () => {
    const ir = { requirements: [] };
    const trace = { nodes: [], edges: [] };
    const snapshot = createSnapshotWithTrace(ir, {
      stage: 'TEST_PLANNING',
      revisionId: 'rev-002',
      sourceContentHash: 'def456',
    }, trace);
    expect(snapshot.traceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deterministic traceHash', () => {
    const ir = {};
    const trace = { nodes: [{ id: 'n1' }] };
    const s1 = createSnapshotWithTrace(ir, { stage: 'test', revisionId: 'r1', sourceContentHash: 'h1' }, trace);
    const s2 = createSnapshotWithTrace(ir, { stage: 'test', revisionId: 'r1', sourceContentHash: 'h1' }, trace);
    expect(s1.traceHash).toBe(s2.traceHash);
  });
});
