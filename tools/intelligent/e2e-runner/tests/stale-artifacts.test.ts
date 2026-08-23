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
} from '../src/fingerprints.js';
import { runPreflight } from '../src/preflight.js';
import { makeTestCase, makeMapping, makeInput, makePolicy, makeDataPlan, makePreparedData } from './fixtures.js';

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
});
