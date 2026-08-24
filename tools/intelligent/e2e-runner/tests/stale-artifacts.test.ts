// Stale artifact regression tests (§9-11, §186-192).
//
// Verify that the runner blocks execution when:
// - Execution mappings reference test cases not in the current set
// - Data plan references test cases not in the current set
// - Prepared data plan environment mismatches
// - Canonical fingerprints detect content changes

import { describe, it, expect } from 'vitest';
import {
  computeHash,
  computeObjectHash,
  canonicalJson,
  isMappingStale,
  isDataPlanStale,
  isPreparedDataStale,
  verifyMappingTestCaseConsistency,
  verifyDataPlanTestCaseConsistency,
  verifyPreparedDataConsistency,
  computeTestCasesSemanticHash,
} from '../src/fingerprints.js';
import { runPreflight } from '../src/preflight.js';
import { EndToEndRunner } from '../src/runner.js';
import { makeTestCase, makeMapping, makeInput, makePolicy, makeExecutePolicy, makeDataPlan, makePreparedData } from './fixtures.js';

// ---- Canonical JSON (§2-3) ------------------------------------------------

describe('canonical JSON serialization', () => {
  it('sorts top-level keys', () => {
    const a = canonicalJson({ b: 2, a: 1 });
    const b = canonicalJson({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('sorts nested object keys recursively', () => {
    const a = canonicalJson({ x: { b: 2, a: 1 } });
    const b = canonicalJson({ x: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    const a = canonicalJson([1, 2, 3]);
    const b = canonicalJson([1, 2, 3]);
    expect(a).toBe(b);
    const c = canonicalJson([3, 2, 1]);
    expect(a).not.toBe(c);
  });

  it('handles null and undefined consistently', () => {
    expect(canonicalJson(null)).toBe(canonicalJson(undefined));
  });

  it('handles deeply nested structures', () => {
    const obj = { z: { y: { x: { a: 1, b: 2 } } }, a: [1, { c: 3, d: 4 }] };
    const result = canonicalJson(obj);
    expect(result).toContain('"a"');
    expect(JSON.parse(result)).toBeDefined();
  });
});

// ---- Fingerprint hashes (§2-3) -------------------------------------------

describe('canonical object hash', () => {
  it('produces same hash regardless of key order', () => {
    const h1 = computeObjectHash({ b: 2, a: 1 });
    const h2 = computeObjectHash({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('produces different hash for different content', () => {
    const h1 = computeObjectHash({ a: 1 });
    const h2 = computeObjectHash({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it('produces SHA-256 hex string', () => {
    const h = computeObjectHash({ test: true });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeHash produces SHA-256 of string', () => {
    const h = computeHash('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('semantic Test Case fingerprint', () => {
  it('excludes volatile metadata but detects semantic changes', () => {
    const base = makeTestCase({ id: 'TC-SEM', expectedResults: [{ description: 'A', verificationType: 'visual' }] });
    const withVolatile = { ...base, generatedAt: 'different', outputPath: '/tmp/other', quality: { score: 0 } } as typeof base;
    const changed = makeTestCase({ id: 'TC-SEM', expectedResults: [{ description: 'B', verificationType: 'visual' }] });
    expect(computeTestCasesSemanticHash([base])).toBe(computeTestCasesSemanticHash([withVolatile]));
    expect(computeTestCasesSemanticHash([base])).not.toBe(computeTestCasesSemanticHash([changed]));
  });
});

// ---- Stale mapping detection (§4, §9, §186-187) --------------------------

describe('stale mapping detection', () => {
  it('blocks when mapping references a test case not in current set', () => {
    const _tcA = makeTestCase({ id: 'TC-A' });
    const mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });
    // Current test cases: only TC-B (TC-A was removed)
    const tcB = makeTestCase({ id: 'TC-B' });
    const input = {
      profile: makeInput({ testCases: [tcB], mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never } }).profile,
      testCases: [tcB],
      mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never },
    };
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map' };
    const result = runPreflight(input, policy, hashes);
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_MAPPING_STALE')).toBe(true);
  });

  it('passes when all mapping testCaseIds exist in current set', () => {
    const tc = makeTestCase({ id: 'TC-A' });
    const mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });
    const input = makeInput({ testCases: [tc], mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never } });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map' };
    const result = runPreflight(input, policy, hashes);
    expect(result.blockers.some((b) => b.code === 'RUNNER_MAPPING_STALE')).toBe(false);
  });

  it('detects stale mapping when test case content changes', () => {
    const tcOriginal = makeTestCase({ id: 'TC-A', title: 'Original' });
    const _mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });

    // Same ID but different content
    const tcModified = makeTestCase({ id: 'TC-A', title: 'Modified' });
    const h1 = computeObjectHash([tcOriginal]);
    const h2 = computeObjectHash([tcModified]);
    expect(h1).not.toBe(h2);
  });

  it('isMappingStale detects hash mismatch', () => {
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'hash-A' };
    expect(isMappingStale(hashes, 'hash-B')).toBe(true);
    expect(isMappingStale(hashes, 'hash-A')).toBe(false);
    expect(isMappingStale(hashes, undefined)).toBe(false);
  });
});

// ---- Stale data plan detection (§5, §10, §188-189) -----------------------

describe('stale data plan detection', () => {
  it('blocks when data plan references test case not in current set', () => {
    const tcA = makeTestCase({ id: 'TC-A' });
    const tcB = makeTestCase({ id: 'TC-B' });
    const mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });
    const dataPlan = makeDataPlan({
      testCases: [
        { testCaseId: 'TC-A', requiredDataItemIds: [], setupItemIds: [], cleanupItemIds: [], reusableDataSetIds: [], unresolvedIds: [] },
        { testCaseId: 'TC-GONE', requiredDataItemIds: [], setupItemIds: [], cleanupItemIds: [], reusableDataSetIds: [], unresolvedIds: [] },
      ],
    });
    const input = makeInput({
      testCases: [tcA, tcB],
      mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never },
      dataPlan,
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map', dataPlanHash: 'dp' };
    const result = runPreflight(input, policy, hashes);
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_DATA_PLAN_STALE')).toBe(true);
  });

  it('passes when data plan testCaseIds all exist in current set', () => {
    const tcA = makeTestCase({ id: 'TC-A' });
    const mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });
    const dataPlan = makeDataPlan({
      testCases: [
        { testCaseId: 'TC-A', requiredDataItemIds: [], setupItemIds: [], cleanupItemIds: [], reusableDataSetIds: [], unresolvedIds: [] },
      ],
    });
    const input = makeInput({
      testCases: [tcA],
      mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never },
      dataPlan,
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map', dataPlanHash: 'dp' };
    const result = runPreflight(input, policy, hashes);
    expect(result.blockers.some((b) => b.code === 'RUNNER_DATA_PLAN_STALE')).toBe(false);
  });

  it('isDataPlanStale detects hash mismatch', () => {
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map', dataPlanHash: 'dp-A' };
    expect(isDataPlanStale(hashes, 'dp-B')).toBe(true);
    expect(isDataPlanStale(hashes, 'dp-A')).toBe(false);
  });
});

// ---- Stale prepared data detection (§6, §11, §190-191) --------------------

describe('stale prepared data detection', () => {
  it('blocks when prepared data environment mismatches current profile', () => {
    const tcA = makeTestCase({ id: 'TC-A' });
    const mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });
    const preparedData = makePreparedData({ environmentProfileId: 'wrong-env' });
    const input = makeInput({
      testCases: [tcA],
      mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never },
      dataPlan: makeDataPlan(),
      preparedData,
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map' };
    const result = runPreflight(input, policy, hashes);
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_PREPARED_DATA_STALE')).toBe(true);
  });

  it('passes when prepared data environment matches current profile', () => {
    const tcA = makeTestCase({ id: 'TC-A' });
    const mapping = makeMapping({ testCaseId: 'TC-A', status: 'ready' });
    const preparedData = makePreparedData({ environmentProfileId: 'local' });
    const input = makeInput({
      testCases: [tcA],
      mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never },
      dataPlan: makeDataPlan(),
      preparedData,
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map' };
    const result = runPreflight(input, policy, hashes);
    expect(result.blockers.some((b) => b.code === 'RUNNER_PREPARED_DATA_STALE')).toBe(false);
  });

  it('isPreparedDataStale detects hash mismatch', () => {
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map', preparedDataHash: 'pd-A' };
    expect(isPreparedDataStale(hashes, 'pd-B')).toBe(true);
    expect(isPreparedDataStale(hashes, 'pd-A')).toBe(false);
  });

  it('verifyPreparedDataConsistency checks hash match', () => {
    expect(verifyPreparedDataConsistency('hash-A', 'hash-A')).toBe(true);
    expect(verifyPreparedDataConsistency('hash-A', 'hash-B')).toBe(false);
  });
});

// ---- Preflight side-effect zero (§8, §192) --------------------------------

describe('preflight side-effect zero on stale artifact', () => {
  it('produces zero executor calls when mapping is stale', () => {
    const mapping = makeMapping({ testCaseId: 'TC-GONE', status: 'ready' });
    const tcA = makeTestCase({ id: 'TC-A' });
    const input = makeInput({
      testCases: [tcA],
      mappings: { schemaVersion: '1.0' as const, testMappings: [mapping], unresolved: [], catalogs: {}, quality: {} as never },
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const hashes = { profileFingerprint: 'fp', testCasesHash: 'tc', mappingHash: 'map' };
    const result = runPreflight(input, policy, hashes);
    expect(result.status).toBe('blocked');
    // No executor calls — preflight is pure.
  });

  it('verifyMappingTestCaseConsistency returns orphans', () => {
    expect(verifyMappingTestCaseConsistency(['TC-A', 'TC-B'], ['TC-A', 'TC-B', 'TC-C'])).toEqual([]);
    expect(verifyMappingTestCaseConsistency(['TC-A', 'TC-GONE'], ['TC-A'])).toEqual(['TC-GONE']);
  });

  it('verifyDataPlanTestCaseConsistency returns orphans', () => {
    expect(verifyDataPlanTestCaseConsistency(['TC-A'], ['TC-A', 'TC-B'])).toEqual([]);
    expect(verifyDataPlanTestCaseConsistency(['TC-A', 'TC-MISSING'], ['TC-A'])).toEqual(['TC-MISSING']);
  });

  it('blocks same-ID Test Case semantic changes before orchestration', async () => {
    const original = makeTestCase({ id: 'TC-0001', expectedResults: [{ description: 'A', verificationType: 'visual' }] });
    const changed = makeTestCase({ id: 'TC-0001', expectedResults: [{ description: 'B', verificationType: 'visual' }] });
    const input = makeInput({ testCases: [changed], mappings: {
      ...makeInput({ testCases: [original] }).mappings,
    } });
    let orchestratorCalls = 0;
    const runner = new EndToEndRunner({
      policy: makeExecutePolicy(),
      orchestrator: { run: async () => { orchestratorCalls++; throw new Error('must not execute'); } } as never,
    });
    const result = await runner.run(input);
    expect(result.status).toBe('blocked');
    expect(result.preflight.blockers.some((b) => b.code === 'RUNNER_MAPPING_STALE')).toBe(true);
    expect(orchestratorCalls).toBe(0);
  });

  it('blocks a mapping built against a different Project Profile', () => {
    const tc = makeTestCase({ id: 'TC-PROFILE' });
    const input = makeInput({ testCases: [tc], mappings: {
      ...makeInput({ testCases: [tc] }).mappings,
      sourceProjectFingerprint: 'old-project-profile',
    } });
    const result = runPreflight(input, makeExecutePolicy(), {
      profileFingerprint: input.profile.fingerprint,
      testCasesSemanticHash: 'unused', testCasesHash: 'unused',
      mappingArtifactHash: 'unused', mappingHash: 'unused',
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_MAPPING_STALE')).toBe(true);
  });

  it('blocks legacy execute artifacts with no source compatibility metadata', () => {
    const tc = makeTestCase({ id: 'TC-LEGACY' });
    const input = makeInput({ testCases: [tc], mappings: {
      schemaVersion: '1.0', testMappings: [makeMapping({ testCaseId: tc.id })], unresolved: [], catalogs: {}, quality: {} as never,
    } });
    delete (input.mappings as { sourceTestCasesHash?: string; sourceProjectFingerprint?: string }).sourceTestCasesHash;
    delete (input.mappings as { sourceTestCasesHash?: string; sourceProjectFingerprint?: string }).sourceProjectFingerprint;
    const result = runPreflight(input, makeExecutePolicy(), {
      profileFingerprint: input.profile.fingerprint,
      testCasesSemanticHash: 'unused', testCasesHash: 'unused',
      mappingArtifactHash: 'unused', mappingHash: 'unused',
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_MAPPING_STALE')).toBe(true);
  });

  it('blocks same-ID Test Case semantic changes for a reused data plan', () => {
    const original = makeTestCase({ id: 'TC-DP', expectedResults: [{ description: 'A', verificationType: 'visual' }] });
    const originalInput = makeInput({ testCases: [original], dataPlan: makeDataPlan() });
    const changed = makeTestCase({ id: 'TC-DP', expectedResults: [{ description: 'B', verificationType: 'visual' }] });
    const input = makeInput({ testCases: [changed], dataPlan: originalInput.dataPlan });
    const result = runPreflight(input, makeExecutePolicy(), {
      profileFingerprint: input.profile.fingerprint,
      testCasesSemanticHash: 'unused', testCasesHash: 'unused',
      mappingArtifactHash: 'unused', mappingHash: 'unused',
      dataPlanArtifactHash: 'unused', dataPlanHash: 'unused',
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_DATA_PLAN_STALE')).toBe(true);
  });

  it('blocks prepared data reused with a different data plan', () => {
    const tc = makeTestCase({ id: 'TC-PREP' });
    const planA = makeDataPlan({ dataItems: [{ id: 'DI-A', name: 'A', description: 'A', type: 'account', lifecycle: 'temporary', strategy: 'create-new' }] });
    const prepared = makePreparedData({ environmentProfileId: 'local' });
    const source = makeInput({ testCases: [tc], dataPlan: planA, preparedData: prepared });
    const planB = makeDataPlan({ dataItems: [{ id: 'DI-B', name: 'B', description: 'B', type: 'account', lifecycle: 'temporary', strategy: 'create-new' }] });
    const input = makeInput({ testCases: [tc], dataPlan: planB, preparedData: source.preparedData });
    const result = runPreflight(input, makeExecutePolicy(), {
      profileFingerprint: input.profile.fingerprint,
      testCasesSemanticHash: 'unused', testCasesHash: 'unused',
      mappingArtifactHash: 'unused', mappingHash: 'unused',
      dataPlanArtifactHash: 'unused', dataPlanHash: 'unused',
      preparedDataArtifactHash: 'unused', preparedDataHash: 'unused',
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_PREPARED_DATA_STALE')).toBe(true);
  });
});
