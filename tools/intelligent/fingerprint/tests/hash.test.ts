import { describe, it, expect } from 'vitest';
import { sha256, stableId, canonicalJson, objectHash, contentHash } from '../src/hash.js';

describe('hash — sha256', () => {
  it('returns SHA-256 hex string', () => {
    const hash = sha256('hello');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deterministic for same input', () => {
    expect(sha256('test')).toBe(sha256('test'));
  });

  it('different for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });

  it('handles Buffer input', () => {
    const hash = sha256(Buffer.from('hello'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('hash — stableId', () => {
  it('returns prefix_truncated-hash format', () => {
    const id = stableId('src', 'test-value');
    expect(id).toMatch(/^src_[a-f0-9]{24}$/);
  });

  it('deterministic for same inputs', () => {
    expect(stableId('src', 'test')).toBe(stableId('src', 'test'));
  });

  it('different for different values', () => {
    expect(stableId('src', 'a')).not.toBe(stableId('src', 'b'));
  });

  it('different for different prefixes', () => {
    expect(stableId('a', 'test')).not.toBe(stableId('b', 'test'));
  });
});

describe('hash — canonicalJson', () => {
  it('produces deterministic output regardless of key order', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });

  it('handles nested objects recursively', () => {
    const obj1 = { c: { b: 2, a: 1 }, d: [3, 4] };
    const obj2 = { c: { a: 1, b: 2 }, d: [3, 4] };
    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });

  it('converts undefined to null', () => {
    const obj = { a: undefined, b: 1 };
    expect(canonicalJson(obj)).toContain('null');
  });

  it('preserves array order', () => {
    const obj1 = { a: [1, 2, 3] };
    const obj2 = { a: [3, 2, 1] };
    expect(canonicalJson(obj1)).not.toBe(canonicalJson(obj2));
  });
});

describe('hash — objectHash', () => {
  it('returns SHA-256 hex string', () => {
    const hash = objectHash({ a: 1 });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('same hash regardless of key order', () => {
    const h1 = objectHash({ a: 1, b: 2 });
    const h2 = objectHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('different for different values', () => {
    expect(objectHash({ a: 1 })).not.toBe(objectHash({ a: 2 }));
  });
});

describe('hash — contentHash', () => {
  it('returns SHA-256 hex string', () => {
    const hash = contentHash('test');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashes multiple fields together', () => {
    const h1 = contentHash('a', 'b');
    const h2 = contentHash('b', 'a');
    expect(h1).not.toBe(h2);
  });

  it('deterministic for same fields', () => {
    expect(contentHash('a', 'b')).toBe(contentHash('a', 'b'));
  });
});
