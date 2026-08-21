// ---------------------------------------------------------------------------
// Core tests – errors, models, error codes
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  AIProviderError,
  AIProviderErrorCode,
} from '../src/errors.js';

describe('AIProviderErrorCode', () => {
  it('defines all required error codes', () => {
    const codes = Object.values(AIProviderErrorCode);
    expect(codes).toContain('AI_PROVIDER_CONFIG_ERROR');
    expect(codes).toContain('AI_AUTH_ERROR');
    expect(codes).toContain('AI_BAD_REQUEST');
    expect(codes).toContain('AI_RATE_LIMITED');
    expect(codes).toContain('AI_TIMEOUT');
    expect(codes).toContain('AI_NETWORK_ERROR');
    expect(codes).toContain('AI_PROVIDER_UNAVAILABLE');
    expect(codes).toContain('AI_RESPONSE_EMPTY');
    expect(codes).toContain('AI_RESPONSE_PARSE_ERROR');
    expect(codes).toContain('AI_RESPONSE_SCHEMA_ERROR');
    expect(codes).toContain('AI_UNKNOWN_ERROR');
  });
});

describe('AIProviderError', () => {
  it('creates error with correct properties', () => {
    const err = new AIProviderError({
      code: AIProviderErrorCode.AUTH_ERROR,
      provider: 'groq',
      message: 'Invalid API key',
      statusCode: 401,
      requestId: 'req-123',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AIProviderError');
    expect(err.code).toBe('AI_AUTH_ERROR');
    expect(err.provider).toBe('groq');
    expect(err.message).toBe('Invalid API key');
    expect(err.statusCode).toBe(401);
    expect(err.requestId).toBe('req-123');
  });

  it('marks retryable codes correctly', () => {
    const retryable = new AIProviderError({
      code: AIProviderErrorCode.RATE_LIMITED,
      provider: 'groq',
      message: 'Rate limited',
    });
    expect(retryable.retryable).toBe(true);

    const timeout = new AIProviderError({
      code: AIProviderErrorCode.TIMEOUT,
      provider: 'groq',
      message: 'Timeout',
    });
    expect(timeout.retryable).toBe(true);

    const network = new AIProviderError({
      code: AIProviderErrorCode.NETWORK_ERROR,
      provider: 'groq',
      message: 'Network error',
    });
    expect(network.retryable).toBe(true);
  });

  it('marks non-retryable codes correctly', () => {
    const auth = new AIProviderError({
      code: AIProviderErrorCode.AUTH_ERROR,
      provider: 'groq',
      message: 'Auth failed',
    });
    expect(auth.retryable).toBe(false);

    const badReq = new AIProviderError({
      code: AIProviderErrorCode.BAD_REQUEST,
      provider: 'groq',
      message: 'Bad request',
    });
    expect(badReq.retryable).toBe(false);

    const parseErr = new AIProviderError({
      code: AIProviderErrorCode.RESPONSE_PARSE_ERROR,
      provider: 'groq',
      message: 'Invalid JSON',
    });
    expect(parseErr.retryable).toBe(false);
  });

  it('preserves retryAfterMs when set', () => {
    const err = new AIProviderError({
      code: AIProviderErrorCode.RATE_LIMITED,
      provider: 'groq',
      message: 'Rate limited',
      retryAfterMs: 5000,
    });
    expect(err.retryAfterMs).toBe(5000);
  });

  it('preserves cause when set', () => {
    const original = new Error('original');
    const err = new AIProviderError({
      code: AIProviderErrorCode.UNKNOWN_ERROR,
      provider: 'groq',
      message: 'Wrapped',
      cause: original,
    });
    expect(err.cause).toBe(original);
  });
});
