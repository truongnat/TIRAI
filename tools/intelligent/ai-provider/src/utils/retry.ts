// ---------------------------------------------------------------------------
// Retry utility – generic, provider-agnostic
// ---------------------------------------------------------------------------
// Exponential backoff with jitter. Only retries on errors flagged retryable.

import { AIProviderError, AIProviderErrorCode } from '../errors.js';

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3. */
  maxRetries: number;
  /** Base delay in ms. Actual delay = base * 2^attempt + jitter. */
  baseDelayMs: number;
  /** Maximum delay cap in ms. */
  maxDelayMs: number;
  /** Provider name for error context. */
  providerName: string;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  providerName: 'unknown',
};

/**
 * Execute an async operation with exponential backoff retry.
 *
 * Only retries when the thrown error is an `AIProviderError` with
 * `retryable === true`. All other errors propagate immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: AIProviderError | undefined;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AIProviderError && err.retryable) {
        lastError = err;

        // Respect retry-after header if the provider supplied one
        const delay = err.retryAfterMs ?? computeBackoff(attempt, opts);
        await sleep(delay);
        continue;
      }
      // Non-retryable error – propagate immediately
      throw err;
    }
  }

  // All retries exhausted – re-throw the last error to preserve its code
  if (lastError) {
    throw lastError;
  }
  throw new AIProviderError({
    code: AIProviderErrorCode.PROVIDER_UNAVAILABLE,
    provider: opts.providerName,
    message: `All ${opts.maxRetries} attempts failed with unknown error.`,
  });
}

function computeBackoff(attempt: number, opts: RetryOptions): number {
  const exponential = opts.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * opts.baseDelayMs * 0.3;
  return Math.min(exponential + jitter, opts.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
