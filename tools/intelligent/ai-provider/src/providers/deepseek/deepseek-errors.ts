// ---------------------------------------------------------------------------
// DeepSeek Provider – error mapper
// ---------------------------------------------------------------------------
// Maps DeepSeek HTTP errors to normalized AIProviderError.
// DeepSeek uses an OpenAI-compatible API, so error shapes follow the
// standard { status, message, type } pattern.

import { AIProviderError, AIProviderErrorCode } from '../../errors.js';

/**
 * Map a raw HTTP/fetch error from DeepSeek into a normalized AIProviderError.
 */
export function mapDeepSeekError(err: unknown, providerName: string): AIProviderError {
  const status = extractStatus(err);
  const message = extractMessage(err) ?? 'Unknown DeepSeek API error';
  const requestId = extractRequestId(err);
  const retryAfter = extractRetryAfter(err);

  if (status === 401 || status === 403) {
    return new AIProviderError({
      code: AIProviderErrorCode.AUTH_ERROR,
      provider: providerName,
      message: `Authentication failed: ${message}`,
      statusCode: status,
      requestId,
      cause: err,
    });
  }

  if (status === 400 || status === 402) {
    return new AIProviderError({
      code: AIProviderErrorCode.BAD_REQUEST,
      provider: providerName,
      message: `Bad request (${status}): ${message}`,
      statusCode: status,
      requestId,
      cause: err,
    });
  }

  if (status === 429) {
    return new AIProviderError({
      code: AIProviderErrorCode.RATE_LIMITED,
      provider: providerName,
      message: `Rate limited: ${message}`,
      statusCode: status,
      requestId,
      retryAfterMs: retryAfter,
      cause: err,
    });
  }

  if (status === 502 || status === 503 || status === 504) {
    return new AIProviderError({
      code: AIProviderErrorCode.PROVIDER_UNAVAILABLE,
      provider: providerName,
      message: `Provider unavailable (${status}): ${message}`,
      statusCode: status,
      requestId,
      cause: err,
    });
  }

  if (status && status >= 500) {
    return new AIProviderError({
      code: AIProviderErrorCode.PROVIDER_UNAVAILABLE,
      provider: providerName,
      message: `Server error (${status}): ${message}`,
      statusCode: status,
      requestId,
      cause: err,
    });
  }

  // Network / timeout errors
  if (isTimeoutError(err)) {
    return new AIProviderError({
      code: AIProviderErrorCode.TIMEOUT,
      provider: providerName,
      message: `Request timed out: ${message}`,
      cause: err,
    });
  }

  if (isNetworkError(err)) {
    return new AIProviderError({
      code: AIProviderErrorCode.NETWORK_ERROR,
      provider: providerName,
      message: `Network error: ${message}`,
      cause: err,
    });
  }

  // Fallback
  return new AIProviderError({
    code: AIProviderErrorCode.UNKNOWN_ERROR,
    provider: providerName,
    message,
    statusCode: status,
    requestId,
    cause: err,
  });
}

// ---- Extraction helpers ---------------------------------------------------

function extractStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
    if (typeof e.error === 'object' && e.error !== null) {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.status === 'number') return inner.status;
    }
  }
  return undefined;
}

function extractMessage(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.error === 'object' && e.error !== null) {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.message === 'string') return inner.message;
    }
    if (typeof e.message === 'string') return e.message;
  }
  if (err instanceof Error) return err.message;
  return undefined;
}

function extractRequestId(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.request_id === 'string') return e.request_id;
    if (typeof e.requestId === 'string') return e.requestId;
  }
  return undefined;
}

function extractRetryAfter(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.retryAfter === 'number') return e.retryAfter * 1000;
    if (typeof e['retry-after'] === 'number') return e['retry-after'] * 1000;
  }
  return undefined;
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message.includes('timeout') || err.message.includes('aborted');
  }
  return false;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('fetch failed');
  }
  return false;
}
