// ---------------------------------------------------------------------------
// Groq Provider – configuration
// ---------------------------------------------------------------------------

import { AIProviderError, AIProviderErrorCode } from '../../errors.js';

export interface GroqProviderConfig {
  /** Groq API key. Must come from env or secure config – never hardcode. */
  apiKey: string;
  /** Model identifier. Default: "openai/gpt-oss-120b". */
  model: string;
  /** Optional custom base URL (e.g. proxy). */
  baseUrl?: string;
  /** Request timeout in ms. Default: 60000. */
  timeoutMs: number;
  /** Maximum retry attempts for transient errors. Default: 3. */
  maxRetries: number;
}

const DEFAULTS = {
  model: 'openai/gpt-oss-120b',
  timeoutMs: 60_000,
  maxRetries: 3,
} as const;

/**
 * Resolve Groq config from explicit values + environment variables.
 * Explicit values take precedence over env vars.
 */
export function resolveGroqConfig(overrides?: Partial<GroqProviderConfig>): GroqProviderConfig {
  const apiKey = overrides?.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AIProviderError({
      code: AIProviderErrorCode.CONFIG_ERROR,
      provider: 'groq',
      message: 'GROQ_API_KEY is required. Set it via environment variable or pass apiKey in config.',
    });
  }

  return {
    apiKey,
    model: overrides?.model ?? process.env.GROQ_MODEL ?? DEFAULTS.model,
    baseUrl: overrides?.baseUrl ?? process.env.GROQ_BASE_URL,
    timeoutMs: overrides?.timeoutMs ?? parseEnvInt('GROQ_TIMEOUT_MS', DEFAULTS.timeoutMs),
    maxRetries: overrides?.maxRetries ?? parseEnvInt('GROQ_MAX_RETRIES', DEFAULTS.maxRetries),
  };
}

function parseEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
