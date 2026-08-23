// ---------------------------------------------------------------------------
// DeepSeek Provider – configuration
// ---------------------------------------------------------------------------

import { AIProviderError, AIProviderErrorCode } from '../../errors.js';

export interface DeepSeekProviderConfig {
  /** DeepSeek API key. Must come from env or secure config – never hardcode. */
  apiKey: string;
  /** Model identifier. Default: "deepseek-v4-pro". */
  model: string;
  /** Optional custom base URL (e.g. proxy). */
  baseUrl?: string;
  /** Request timeout in ms. Default: 60000. */
  timeoutMs: number;
  /** Maximum retry attempts for transient errors. Default: 3. */
  maxRetries: number;
}

const DEFAULTS = {
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
  timeoutMs: 60_000,
  maxRetries: 3,
} as const;

/**
 * Resolve DeepSeek config from explicit values + environment variables.
 * Explicit values take precedence over env vars.
 */
export function resolveDeepSeekConfig(overrides?: Partial<DeepSeekProviderConfig>): DeepSeekProviderConfig {
  const apiKey = overrides?.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AIProviderError({
      code: AIProviderErrorCode.CONFIG_ERROR,
      provider: 'deepseek',
      message: 'DEEPSEEK_API_KEY is required. Set it via environment variable or pass apiKey in config.',
    });
  }

  return {
    apiKey,
    model: overrides?.model ?? process.env.DEEPSEEK_MODEL ?? DEFAULTS.model,
    baseUrl: overrides?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULTS.baseUrl,
    timeoutMs: overrides?.timeoutMs ?? parseEnvInt('DEEPSEEK_TIMEOUT_MS', DEFAULTS.timeoutMs),
    maxRetries: overrides?.maxRetries ?? parseEnvInt('DEEPSEEK_MAX_RETRIES', DEFAULTS.maxRetries),
  };
}

function parseEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
