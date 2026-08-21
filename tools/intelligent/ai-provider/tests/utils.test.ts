// ---------------------------------------------------------------------------
// Utility tests – retry + JSON validation
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/utils/retry.js';
import { parseAndValidate } from '../src/utils/json.js';
import { AIProviderError, AIProviderErrorCode } from '../src/errors.js';

// ---- Retry ----------------------------------------------------------------

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, providerName: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new AIProviderError({
        code: AIProviderErrorCode.RATE_LIMITED,
        provider: 'test',
        message: 'Rate limited',
      }))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, providerName: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new AIProviderError({
      code: AIProviderErrorCode.BAD_REQUEST,
      provider: 'test',
      message: 'Bad request',
    }));

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1, providerName: 'test' }))
      .rejects.toThrow('Bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all retries and throws final error', async () => {
    const fn = vi.fn().mockRejectedValue(new AIProviderError({
      code: AIProviderErrorCode.PROVIDER_UNAVAILABLE,
      provider: 'test',
      message: 'Down',
    }));

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1, providerName: 'test' }))
      .rejects.toThrow('Down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects retryAfterMs from error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new AIProviderError({
        code: AIProviderErrorCode.RATE_LIMITED,
        provider: 'test',
        message: 'Rate limited',
        retryAfterMs: 1, // 1ms for fast test
      }))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, providerName: 'test' });
    expect(result).toBe('ok');
  });
});

// ---- JSON validation ------------------------------------------------------

describe('parseAndValidate', () => {
  it('parses valid JSON without schema', () => {
    const result = parseAndValidate<{ status: string }>('{"status":"ok"}', undefined, 'test');
    expect(result).toEqual({ status: 'ok' });
  });

  it('throws PARSE_ERROR on invalid JSON', () => {
    expect(() => parseAndValidate('not json', undefined, 'test'))
      .toThrow(/not valid JSON/);

    try {
      parseAndValidate('not json', undefined, 'test');
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.RESPONSE_PARSE_ERROR);
    }
  });

  it('validates against schema – success', () => {
    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    };
    const result = parseAndValidate<{ status: string }>('{"status":"ok"}', schema, 'test');
    expect(result).toEqual({ status: 'ok' });
  });

  it('throws SCHEMA_ERROR on schema mismatch', () => {
    const schema = {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    };

    expect(() => parseAndValidate('{"wrong":"field"}', schema, 'test'))
      .toThrow(/does not match schema/);

    try {
      parseAndValidate('{"wrong":"field"}', schema, 'test');
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe(AIProviderErrorCode.RESPONSE_SCHEMA_ERROR);
    }
  });

  it('validates nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'string' } },
          },
          required: ['items'],
        },
      },
      required: ['data'],
    };

    const valid = '{"data":{"items":["a","b"]}}';
    expect(() => parseAndValidate(valid, schema, 'test')).not.toThrow();

    const invalid = '{"data":{"items":[1,2]}}';
    expect(() => parseAndValidate(invalid, schema, 'test')).toThrow(/does not match schema/);
  });
});
