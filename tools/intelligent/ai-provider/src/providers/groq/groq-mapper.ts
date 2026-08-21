// ---------------------------------------------------------------------------
// Groq Provider – response mapper
// ---------------------------------------------------------------------------
// Converts Groq SDK response objects into the generic AIGenerationResponse.
// Provider-specific property names are never exposed to the caller.

import type { AIGenerationResponse, AIUsage } from '../../models.js';

/**
 * Minimal shape of a Groq chat completion response.
 * We only reference the fields we need – the SDK type is not imported
 * into the core layer to prevent type leakage.
 */
export interface GroqRawResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Map a Groq raw response to the generic response contract. */
export function mapGroqResponse<T>(
  raw: GroqRawResponse,
  data: T,
  rawText: string,
): AIGenerationResponse<T> {
  const choice = raw.choices?.[0];
  const usage = mapUsage(raw.usage);

  return {
    provider: 'groq',
    model: raw.model ?? 'unknown',
    data,
    rawText,
    usage,
    finishReason: choice?.finish_reason,
    requestId: raw.id,
  };
}

function mapUsage(raw?: GroqRawResponse['usage']): AIUsage | undefined {
  if (!raw) return undefined;
  return {
    inputTokens: raw.prompt_tokens,
    outputTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
}
