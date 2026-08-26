import { describe, it, expect } from 'vitest';
import { computeDiff, mergeDiffResults } from '../src/diff.js';
import { objectHash } from '../src/hash.js';

interface TestItem {
  id: string;
  name: string;
  value: number;
}

describe('diff — computeDiff', () => {
  const options = {
    extractId: (item: TestItem) => item.id,
    extractLabel: (item: TestItem) => item.name,
    computeFingerprint: (item: TestItem) => objectHash({ name: item.name, value: item.value }),
  };

  it('detects identical collections', () => {
    const base = [{ id: '1', name: 'A', value: 1 }];
    const target = [{ id: '1', name: 'A', value: 1 }];
    const result = computeDiff(base, target, options);
    expect(result.identical).toBe(true);
    expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 1 });
  });

  it('detects additions', () => {
    const base: TestItem[] = [];
    const target = [{ id: '1', name: 'A', value: 1 }];
    const result = computeDiff(base, target, options);
    expect(result.identical).toBe(false);
    expect(result.summary.added).toBe(1);
    expect(result.categories.default[0].classification).toBe('added');
  });

  it('detects removals', () => {
    const base = [{ id: '1', name: 'A', value: 1 }];
    const target: TestItem[] = [];
    const result = computeDiff(base, target, options);
    expect(result.identical).toBe(false);
    expect(result.summary.removed).toBe(1);
    expect(result.categories.default[0].classification).toBe('removed');
  });

  it('detects modifications', () => {
    const base = [{ id: '1', name: 'A', value: 1 }];
    const target = [{ id: '1', name: 'A', value: 2 }];
    const result = computeDiff(base, target, options);
    expect(result.identical).toBe(false);
    expect(result.summary.modified).toBe(1);
    expect(result.categories.default[0].classification).toBe('modified');
  });

  it('handles mixed changes', () => {
    const base = [
      { id: '1', name: 'A', value: 1 },
      { id: '2', name: 'B', value: 2 },
    ];
    const target = [
      { id: '1', name: 'A', value: 1 }, // unchanged
      { id: '3', name: 'C', value: 3 }, // added
    ];
    const result = computeDiff(base, target, options);
    expect(result.identical).toBe(false);
    expect(result.summary.unchanged).toBe(1);
    expect(result.summary.added).toBe(1);
    expect(result.summary.removed).toBe(1);
  });

  it('uses category grouping', () => {
    const base = [{ id: '1', name: 'A', value: 1 }];
    const target = [{ id: '1', name: 'A', value: 2 }];
    const result = computeDiff(base, target, { ...options, category: 'test' });
    expect(result.categories.test).toBeDefined();
    expect(result.categories.default).toBeUndefined();
  });
});

describe('diff — mergeDiffResults', () => {
  it('merges multiple results', () => {
    const r1 = {
      summary: { added: 1, removed: 0, modified: 0, unchanged: 0 },
      categories: { test: [] },
      identical: false,
    };
    const r2 = {
      summary: { added: 0, removed: 1, modified: 0, unchanged: 0 },
      categories: { test: [] },
      identical: false,
    };
    const merged = mergeDiffResults(r1, r2);
    expect(merged.summary.added).toBe(1);
    expect(merged.summary.removed).toBe(1);
    expect(merged.identical).toBe(false);
  });

  it('merges categories', () => {
    const r1 = {
      summary: { added: 0, removed: 0, modified: 0, unchanged: 1 },
      categories: { a: [{ id: '1', label: 'A', classification: 'unchanged' as const, before: null, after: null }] },
      identical: true,
    };
    const r2 = {
      summary: { added: 0, removed: 0, modified: 0, unchanged: 1 },
      categories: { a: [{ id: '2', label: 'B', classification: 'unchanged' as const, before: null, after: null }] },
      identical: true,
    };
    const merged = mergeDiffResults(r1, r2);
    expect(merged.categories.a).toHaveLength(2);
  });

  it('marks as not identical if any result is not identical', () => {
    const r1 = {
      summary: { added: 0, removed: 0, modified: 0, unchanged: 1 },
      categories: {},
      identical: true,
    };
    const r2 = {
      summary: { added: 1, removed: 0, modified: 0, unchanged: 0 },
      categories: {},
      identical: false,
    };
    const merged = mergeDiffResults(r1, r2);
    expect(merged.identical).toBe(false);
  });
});
