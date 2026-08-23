// ---------------------------------------------------------------------------
// DeepSeek Provider – response mapper
// ---------------------------------------------------------------------------
// Converts DeepSeek HTTP response objects into the generic AIGenerationResponse.
// Provider-specific property names are never exposed to the caller.

import type { AIGenerationResponse, AIUsage } from '../../models.js';

/**
 * Minimal shape of a DeepSeek chat completion response.
 * DeepSeek uses OpenAI-compatible format.
 */
export interface DeepSeekRawResponse {
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

/** Map a DeepSeek raw response to the generic response contract. */
export function mapDeepSeekResponse<T>(
  raw: DeepSeekRawResponse,
  data: T,
  rawText: string,
): AIGenerationResponse<T> {
  const choice = raw.choices?.[0];
  const usage = mapUsage(raw.usage);

  return {
    provider: 'deepseek',
    model: raw.model ?? 'unknown',
    data,
    rawText,
    usage,
    finishReason: choice?.finish_reason,
    requestId: raw.id,
  };
}

function mapUsage(raw?: DeepSeekRawResponse['usage']): AIUsage | undefined {
  if (!raw) return undefined;
  return {
    inputTokens: raw.prompt_tokens,
    outputTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
}
