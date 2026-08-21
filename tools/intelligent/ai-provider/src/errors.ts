// ---------------------------------------------------------------------------
// AI Provider – normalized error model
// ---------------------------------------------------------------------------
// All provider-specific errors are mapped to these codes before reaching
// the caller. The caller never sees Groq/OpenAI/Gemini error shapes.

export const AIProviderErrorCode = {
  /** Missing or invalid configuration (API key, base URL, etc.). */
  CONFIG_ERROR: 'AI_PROVIDER_CONFIG_ERROR',
  /** 401 – invalid or expired credentials. */
  AUTH_ERROR: 'AI_AUTH_ERROR',
  /** 400 – malformed request body or parameters. */
  BAD_REQUEST: 'AI_BAD_REQUEST',
  /** 429 – rate limit exceeded. */
  RATE_LIMITED: 'AI_RATE_LIMITED',
  /** Request exceeded the configured timeout. */
  TIMEOUT: 'AI_TIMEOUT',
  /** TCP/DNS failure or connection reset. */
  NETWORK_ERROR: 'AI_NETWORK_ERROR',
  /** 502/503 – provider cannot be reached. */
  PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  /** Response body was empty. */
  RESPONSE_EMPTY: 'AI_RESPONSE_EMPTY',
  /** Response could not be parsed as JSON. */
  RESPONSE_PARSE_ERROR: 'AI_RESPONSE_PARSE_ERROR',
  /** Parsed JSON did not conform to the requested schema. */
  RESPONSE_SCHEMA_ERROR: 'AI_RESPONSE_SCHEMA_ERROR',
  /** Catch-all for unexpected failures. */
  UNKNOWN_ERROR: 'AI_UNKNOWN_ERROR',
} as const;

export type AIProviderErrorCodeKey =
  (typeof AIProviderErrorCode)[keyof typeof AIProviderErrorCode];

/** Codes that are eligible for automatic retry. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  AIProviderErrorCode.RATE_LIMITED,
  AIProviderErrorCode.TIMEOUT,
  AIProviderErrorCode.NETWORK_ERROR,
  AIProviderErrorCode.PROVIDER_UNAVAILABLE,
]);

export class AIProviderError extends Error {
  public readonly code: AIProviderErrorCodeKey;
  public readonly provider: string;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly requestId?: string;
  public readonly retryAfterMs?: number;
  public override readonly cause?: unknown;

  constructor(opts: {
    code: AIProviderErrorCodeKey;
    provider: string;
    message: string;
    statusCode?: number;
    requestId?: string;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'AIProviderError';
    this.code = opts.code;
    this.provider = opts.provider;
    this.retryable = RETRYABLE_CODES.has(opts.code);
    this.statusCode = opts.statusCode;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
    this.cause = opts.cause;
  }
}
