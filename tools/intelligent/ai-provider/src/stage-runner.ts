import type { AIGenerationRequest, AIGenerationResponse } from './models.js';
import type { AIProvider } from './provider.js';
import { withRetry, type RetryOptions } from './utils/retry.js';

export interface AIStageOptions { stage: string; promptVersion?: string; retry?: Partial<RetryOptions>; }

/** Shared provider boundary for semantic stages; adds stage metadata and retry policy. */
export async function runAIStage<T>(provider: AIProvider, request: AIGenerationRequest<T>, options: AIStageOptions): Promise<AIGenerationResponse<T>> {
  const metadata = { ...request.metadata, tiraiStage: options.stage, promptVersion: options.promptVersion ?? 'unspecified' };
  return withRetry(() => provider.generate({ ...request, metadata }), { providerName: provider.name, ...options.retry });
}
