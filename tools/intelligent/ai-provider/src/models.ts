// ---------------------------------------------------------------------------
// AI Provider – generic request/response models
// ---------------------------------------------------------------------------
// These types are provider-agnostic. No Groq, OpenAI, or Gemini types
// may leak into this layer.

/** A single message in a conversation turn. */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * JSON Schema fragment used for structured output enforcement.
 * Accepts any valid JSON Schema object.
 */
export type JSONSchema = Record<string, unknown>;

/** Generic generation request. `T` is the expected parsed response type. */
export interface AIGenerationRequest<T = unknown> {
  /** Override the provider's default model. */
  model?: string;

  /** Conversation messages (system + user + optional assistant turns). */
  messages: AIMessage[];

  /**
   * If provided, the provider MUST return JSON conforming to this schema.
   * The parsed object is available as `response.data`.
   */
  responseSchema?: JSONSchema;

  /** Sampling temperature (0–2). Provider may clamp to its valid range. */
  temperature?: number;

  /** Maximum tokens in the response. */
  maxOutputTokens?: number;

  /** Per-request timeout in milliseconds. Overrides provider default. */
  timeoutMs?: number;

  /** Arbitrary metadata forwarded to the provider (e.g. request tracing). */
  metadata?: Record<string, string>;
}

/** Token usage breakdown returned by the provider. */
export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Generic generation response. `T` matches the request's expected type. */
export interface AIGenerationResponse<T = unknown> {
  /** Provider identifier (e.g. "groq"). */
  provider: string;

  /** Model actually used (may differ from request if provider defaulted). */
  model: string;

  /** Parsed response data. If `responseSchema` was set, this is validated. */
  data: T;

  /** Raw text returned by the model (useful for debugging). */
  rawText?: string;

  /** Token usage metadata. */
  usage?: AIUsage;

  /** Why the model stopped (e.g. "stop", "length"). */
  finishReason?: string;

  /** Provider-assigned request identifier for support/tracing. */
  requestId?: string;
}

/** Declared capabilities of a provider/model combination. */
export interface AIProviderCapabilities {
  /** Provider can produce structured JSON output. */
  structuredOutput: boolean;
  /** Provider enforces JSON Schema server-side (not just json_object mode). */
  strictStructuredOutput: boolean;
  /** Provider supports streaming responses. */
  streaming: boolean;
}
