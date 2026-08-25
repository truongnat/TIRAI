import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from '../src/runtime/base-url.js';

describe('normalizeBaseUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com/app', 'https://example.com/app/'],
    ['https://example.com/app/', 'https://example.com/app/'],
  ])('canonicalizes %s as %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });

  it('preserves query and hash semantics', () => {
    expect(normalizeBaseUrl('https://example.com/app?tenant=1#/login'))
      .toBe('https://example.com/app/?tenant=1#/login');
  });

  it('rejects missing and unsafe URLs', () => {
    expect(() => normalizeBaseUrl('')).toThrow('required');
    expect(() => normalizeBaseUrl('javascript:alert(1)')).toThrow('not allowed');
  });
});
