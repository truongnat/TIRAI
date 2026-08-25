import { describe, expect, it } from 'vitest';
import { verifyCrossLayer, type RawEvidence, type VerificationNeed, type VerificationRuntime, type VerificationSource } from '../src/verification.js';

const testCase = { id: 'TC-VERIFY', expectedResults: [], steps: [] } as never;
const binding = { resolve: (name: string) => name === 'runtime.order.id' ? { value: 'ORD-123', sensitive: false } : undefined };

function need(overrides: Partial<VerificationNeed> = {}): VerificationNeed {
  return { id: 'order-status', subject: { entityType: 'order', bindingRef: 'runtime.order.id' }, property: 'status', expectation: { kind: 'equals', value: 'CANCELLED' }, ...overrides };
}

function source(sourceName: VerificationSource, value: unknown, options: Partial<RawEvidence> = {}) {
  return { source: sourceName, readOnly: true as const, acquire: async () => [{ source: sourceName, acquisitionRef: `${sourceName}-read`, entityKey: 'runtime.order.id', property: 'status', rawValue: value, normalizedValue: value, mappingKnown: true, provenance: { kind: sourceName.toLowerCase(), reference: `${sourceName}-fixture` }, ...options }] };
}

function runtime(needs: VerificationNeed[], sources: Partial<Record<VerificationSource, ReturnType<typeof source>>>): VerificationRuntime {
  return { plan: { needs, acquisitions: Object.keys(sources) as VerificationSource[] }, sources };
}

describe('Phase 2E cross-layer verification', () => {
  it('verifies UI/API agreement', async () => {
    const report = await verifyCrossLayer(testCase, runtime([need()], { UI: source('UI', 'Cancelled', { normalizedValue: 'CANCELLED' }), API: source('API', 'CANCELLED') }), binding);
    expect(report.status).toBe('VERIFIED');
    expect(report.evidence).toHaveLength(2);
  });

  it('verifies UI/DB and three-layer agreement', async () => {
    const report = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['UI', 'API', 'DATABASE'] })], { UI: source('UI', 'CANCELLED', { normalizedValue: 'CANCELLED' }), API: source('API', 'CANCELLED'), DATABASE: source('DATABASE', 'CANCELLED') }), binding);
    expect(report.status).toBe('VERIFIED');
  });

  it('fails on authoritative backend contradiction instead of majority voting', async () => {
    const report = await verifyCrossLayer(testCase, runtime([need({ authority: 'DATABASE' })], { UI: source('UI', 'CANCELLED'), API: source('API', 'CANCELLED'), DATABASE: source('DATABASE', 'ACTIVE') }), binding);
    expect(report.status).toBe('CONTRADICTED');
    expect(report.conflicts).toHaveLength(1);
  });

  it('uses UI-only evidence without backend calls', async () => {
    let backendCalls = 0;
    const api = { source: 'API' as const, readOnly: true as const, acquire: async () => { backendCalls++; return []; } };
    const report = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['UI'] })], { UI: source('UI', 'CANCELLED'), API: api }), binding);
    expect(report.status).toBe('VERIFIED');
    expect(backendCalls).toBe(0);
  });

  it('blocks when required backend evidence is unavailable', async () => {
    const report = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['UI', 'DATABASE'] })], { UI: source('UI', 'CANCELLED') }), binding);
    expect(report.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('maps acquisition failure to ERROR semantics', async () => {
    const failing = { source: 'API' as const, readOnly: true as const, acquire: async () => { throw new Error('temporary API failure'); } };
    const report = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['API'] })], { API: failing }), binding);
    expect(report.status).toBe('ACQUISITION_ERROR');
  });

  it('keeps unknown database mappings insufficient', async () => {
    const report = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['DATABASE'] })], { DATABASE: source('DATABASE', 9, { normalizedValue: undefined, mappingKnown: false }) }), binding);
    expect(report.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('rejects wrong and ambiguous entity correlation', async () => {
    const wrong = source('DATABASE', 'CANCELLED', { entityKey: 'ORD-124' });
    const wrongReport = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['DATABASE'] })], { DATABASE: wrong }), binding);
    expect(wrongReport.status).toBe('INSUFFICIENT_EVIDENCE');
    const ambiguous = { source: 'DATABASE' as const, readOnly: true as const, acquire: async () => [
      { source: 'DATABASE' as const, acquisitionRef: 'a', entityKey: 'runtime.order.id', property: 'status', rawValue: 'CANCELLED', normalizedValue: 'CANCELLED', provenance: { kind: 'db', reference: 'a' } },
      { source: 'DATABASE' as const, acquisitionRef: 'b', entityKey: 'runtime.other.id', property: 'status', rawValue: 'CANCELLED', normalizedValue: 'CANCELLED', provenance: { kind: 'db', reference: 'b' } },
    ] };
    const ambiguousReport = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['DATABASE'] })], { DATABASE: ambiguous }), binding);
    expect(ambiguousReport.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('evaluates delta and negative existence deterministically', async () => {
    const deltaAdapter = { source: 'DATABASE' as const, readOnly: true as const, acquire: async () => [
      { source: 'DATABASE' as const, acquisitionRef: 'before', entityKey: 'runtime.order.id', property: 'quantity', rawValue: 100, normalizedValue: 100, phase: 'before' as const, provenance: { kind: 'db', reference: 'before' } },
      { source: 'DATABASE' as const, acquisitionRef: 'after', entityKey: 'runtime.order.id', property: 'quantity', rawValue: 90, normalizedValue: 90, phase: 'after' as const, provenance: { kind: 'db', reference: 'after' } },
    ] };
    const delta = await verifyCrossLayer(testCase, runtime([need({ id: 'quantity-delta', property: 'quantity', expectation: { kind: 'delta', value: -10 }, requiredSources: ['DATABASE'] })], { DATABASE: deltaAdapter }), binding);
    expect(delta.status).toBe('VERIFIED');
    const absent = await verifyCrossLayer(testCase, runtime([need({ id: 'absent', expectation: { kind: 'absent' }, requiredSources: ['API'] })], { API: source('API', 'ABSENT') }), binding);
    expect(absent.status).toBe('VERIFIED');
  });

  it('boundedly resolves eventual consistency without hiding a persistent defect', async () => {
    let reads = 0;
    const api = { source: 'API' as const, readOnly: true as const, acquire: async () => [{ source: 'API' as const, acquisitionRef: 'poll', entityKey: 'runtime.order.id', property: 'status', rawValue: ++reads === 1 ? 'PROCESSING' : 'CANCELLED', normalizedValue: reads === 1 ? 'PROCESSING' : 'CANCELLED', provenance: { kind: 'api', reference: 'poll' } }] };
    const resolved = await verifyCrossLayer(testCase, runtime([need({ consistency: { maxAttempts: 2, intervalMs: 1 } })], { API: api }), binding);
    expect(resolved.status).toBe('VERIFIED');
    expect(reads).toBe(2);
  });

  it('rejects verification mutations', async () => {
    const mutation = { source: 'API' as const, readOnly: false as true, acquire: async () => [] };
    const report = await verifyCrossLayer(testCase, runtime([need({ requiredSources: ['API'] })], { API: mutation as never }), binding);
    expect(report.status).toBe('INSUFFICIENT_EVIDENCE');
  });
});
