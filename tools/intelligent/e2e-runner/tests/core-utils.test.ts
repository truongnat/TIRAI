// Selection, fingerprint, loader, and core utility tests.
// Spec §17-21, §25-27, §53, §131-135, §169-174.

import { describe, it, expect } from 'vitest';
import { selectTests, sortByTestId, applyMaxTests } from '../src/selection.js';
import { computeHash, computeObjectHash, computeInputHashes, isMappingStale, isDataPlanStale } from '../src/fingerprints.js';
import { assertWithinRoot } from '../src/loader.js';
import { EndToEndRunnerError } from '../src/errors.js';
import { createWarning } from '../src/warnings.js';
import { makeTestCase, makeInputHashes } from './fixtures.js';

// ---- Selection (§25-27, §29-35) -------------------------------------------

describe('selection — selectTests', () => {
  it('returns all tests sorted by ID when no selection', () => {
    const cases = [makeTestCase({ id: 'TC-B' }), makeTestCase({ id: 'TC-A' })];
    const result = selectTests(cases);
    expect(result.map((t) => t.id)).toEqual(['TC-A', 'TC-B']);
  });

  it('filters by testCaseIds (§29)', () => {
    const cases = [makeTestCase({ id: 'TC-1' }), makeTestCase({ id: 'TC-2' }), makeTestCase({ id: 'TC-3' })];
    const result = selectTests(cases, { testCaseIds: ['TC-2'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TC-2');
  });

  it('filters by scenarioIds (§30)', () => {
    const cases = [
      makeTestCase({ id: 'TC-1', scenarioId: 'SCN-A' }),
      makeTestCase({ id: 'TC-2', scenarioId: 'SCN-B' }),
    ];
    const result = selectTests(cases, { scenarioIds: ['SCN-A'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TC-1');
  });

  it('filters by requirementIds (§31)', () => {
    const cases = [
      makeTestCase({ id: 'TC-1', provenance: [{ requirementId: 'REQ-001' }] }),
      makeTestCase({ id: 'TC-2', provenance: [{ requirementId: 'REQ-002' }] }),
    ];
    const result = selectTests(cases, { requirementIds: ['REQ-002'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TC-2');
  });

  it('combines multiple filters (§33)', () => {
    const cases = [
      makeTestCase({ id: 'TC-1', scenarioId: 'SCN-A', provenance: [{ requirementId: 'REQ-001' }] }),
      makeTestCase({ id: 'TC-2', scenarioId: 'SCN-A', provenance: [{ requirementId: 'REQ-002' }] }),
      makeTestCase({ id: 'TC-3', scenarioId: 'SCN-B', provenance: [{ requirementId: 'REQ-001' }] }),
    ];
    const result = selectTests(cases, { scenarioIds: ['SCN-A'], requirementIds: ['REQ-001'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TC-1');
  });

  it('returns empty for no matches (§34)', () => {
    const cases = [makeTestCase({ id: 'TC-1' })];
    const result = selectTests(cases, { testCaseIds: ['TC-999'] });
    expect(result).toHaveLength(0);
  });

  it('deterministic ordering by test case ID (§35)', () => {
    const cases = [
      makeTestCase({ id: 'TC-C' }),
      makeTestCase({ id: 'TC-A' }),
      makeTestCase({ id: 'TC-B' }),
    ];
    const r1 = selectTests(cases);
    const r2 = selectTests(cases);
    expect(r1.map((t) => t.id)).toEqual(r2.map((t) => t.id));
  });
});

describe('selection — sortByTestId', () => {
  it('sorts alphabetically', () => {
    const cases = [makeTestCase({ id: 'Z' }), makeTestCase({ id: 'A' }), makeTestCase({ id: 'M' })];
    expect(sortByTestId(cases).map((t) => t.id)).toEqual(['A', 'M', 'Z']);
  });
  it('does not mutate original', () => {
    const cases = [makeTestCase({ id: 'B' }), makeTestCase({ id: 'A' })];
    sortByTestId(cases);
    expect(cases[0].id).toBe('B');
  });
});

describe('selection — applyMaxTests (§27)', () => {
  it('limits to max', () => {
    const cases = [makeTestCase({ id: 'TC-1' }), makeTestCase({ id: 'TC-2' }), makeTestCase({ id: 'TC-3' })];
    expect(applyMaxTests(cases, 2)).toHaveLength(2);
  });
  it('returns all when max is undefined', () => {
    const cases = [makeTestCase({ id: 'TC-1' })];
    expect(applyMaxTests(cases, undefined)).toHaveLength(1);
  });
  it('returns all when max is 0', () => {
    const cases = [makeTestCase({ id: 'TC-1' })];
    expect(applyMaxTests(cases, 0)).toHaveLength(1);
  });
});

// ---- Fingerprints (§19-21, §134, §172-174) --------------------------------

describe('fingerprints — computeHash', () => {
  it('returns SHA-256 hex string', () => {
    const hash = computeHash('hello');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('deterministic for same input', () => {
    expect(computeHash('test')).toBe(computeHash('test'));
  });
  it('different for different inputs', () => {
    expect(computeHash('a')).not.toBe(computeHash('b'));
  });
});

describe('fingerprints — computeObjectHash', () => {
  it('hashes objects deterministically', () => {
    const obj = { b: 2, a: 1 };
    expect(computeObjectHash(obj)).toBe(computeObjectHash(obj));
  });
  it('same hash regardless of key order', () => {
    const h1 = computeObjectHash({ a: 1, b: 2 });
    const h2 = computeObjectHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });
});

describe('fingerprints — computeInputHashes', () => {
  it('includes profile fingerprint', () => {
    const hashes = computeInputHashes('fp-123', [], {});
    expect(hashes.profileFingerprint).toBe('fp-123');
  });
  it('includes test cases hash', () => {
    const hashes = computeInputHashes('fp', [{ id: 'TC-1' }], {});
    expect(hashes.testCasesHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('includes mapping hash', () => {
    const hashes = computeInputHashes('fp', [], { testMappings: [] });
    expect(hashes.mappingHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('includes optional data plan hash', () => {
    const hashes = computeInputHashes('fp', [], {}, { items: [] });
    expect(hashes.dataPlanHash).toBeDefined();
  });
  it('omits data plan hash when not provided', () => {
    const hashes = computeInputHashes('fp', [], {});
    expect(hashes.dataPlanHash).toBeUndefined();
  });
});

describe('fingerprints — isMappingStale (§20)', () => {
  it('returns false when no expected hash', () => {
    expect(isMappingStale(makeInputHashes())).toBe(false);
  });
  it('returns false when hashes match', () => {
    const hashes = makeInputHashes({ mappingHash: 'abc' });
    expect(isMappingStale(hashes, 'abc')).toBe(false);
  });
  it('returns true when hashes differ', () => {
    const hashes = makeInputHashes({ mappingHash: 'abc' });
    expect(isMappingStale(hashes, 'xyz')).toBe(true);
  });
});

describe('fingerprints — isDataPlanStale (§21)', () => {
  it('returns false when no expected hash', () => {
    expect(isDataPlanStale(makeInputHashes())).toBe(false);
  });
  it('returns false when no current data plan hash', () => {
    const hashes = makeInputHashes({ dataPlanHash: undefined });
    expect(isDataPlanStale(hashes, 'expected')).toBe(false);
  });
  it('returns true when hashes differ', () => {
    const hashes = makeInputHashes({ dataPlanHash: 'current' });
    expect(isDataPlanStale(hashes, 'expected')).toBe(true);
  });
  it('returns false when hashes match', () => {
    const hashes = makeInputHashes({ dataPlanHash: 'same' });
    expect(isDataPlanStale(hashes, 'same')).toBe(false);
  });
});

// ---- Path safety (§53, §129, §169-170) ------------------------------------

describe('loader — assertWithinRoot', () => {
  it('allows paths within root', () => {
    expect(() => assertWithinRoot('/root/sub/file.json', '/root')).not.toThrow();
  });
  it('rejects path traversal', () => {
    expect(() => assertWithinRoot('/root/../etc/passwd', '/root')).toThrow(EndToEndRunnerError);
  });
  it('rejects absolute path outside root', () => {
    expect(() => assertWithinRoot('/etc/passwd', '/root')).toThrow(EndToEndRunnerError);
  });
});

// ---- Errors ---------------------------------------------------------------

describe('errors — EndToEndRunnerError', () => {
  it('has code and message', () => {
    const err = new EndToEndRunnerError('RUNNER_INPUT_MISSING', 'File not found', '/path');
    expect(err.code).toBe('RUNNER_INPUT_MISSING');
    expect(err.message).toBe('File not found');
    expect(err.path).toBe('/path');
    expect(err.name).toBe('EndToEndRunnerError');
  });
  it('is an Error', () => {
    const err = new EndToEndRunnerError('RUNNER_INTERNAL_ERROR', 'oops');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---- Warnings -------------------------------------------------------------

describe('warnings — createWarning', () => {
  it('creates structured warning', () => {
    const w = createWarning('RUNNER_PARTIAL_MAPPING', 'Some mappings partial');
    expect(w.code).toBe('RUNNER_PARTIAL_MAPPING');
    expect(w.message).toBe('Some mappings partial');
    expect(w.path).toBeUndefined();
  });
  it('includes optional path', () => {
    const w = createWarning('RUNNER_COMMAND_UNSAFE', 'Unsafe', 'commands.cmd1');
    expect(w.path).toBe('commands.cmd1');
  });
});
