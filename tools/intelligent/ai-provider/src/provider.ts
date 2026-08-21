// ---------------------------------------------------------------------------
// AI Provider – core interface
// ---------------------------------------------------------------------------

import type {
  AIGenerationRequest,
  AIGenerationResponse,
  AIProviderCapabilities,
} from './models.js';

/**
 * Provider-agnostic interface for AI generation.
 *
 * All higher-level code (Semantic Analyzer, Requirement Generator, etc.)
 * depends ONLY on this interface – never on a concrete provider class.
 */
export interface AIProvider {
  /** Stable provider identifier (e.g. "groq", "gemini"). */
  readonly name: string;

  /** Declared capabilities – callers use this instead of provider name checks. */
  readonly capabilities: AIProviderCapabilities;

  /**
   * Generate a structured response from the model.
   *
   * If `request.responseSchema` is provided, the provider:
   * 1. Instructs the model to produce conforming JSON.
   * 2. Parses the response text.
   * 3. Validates against the schema.
   * 4. Returns the parsed object as `response.data`.
   *
   * Throws `AIProviderError` on any failure.
   */
  generate<T>(
    request: AIGenerationRequest<T>,
  ): Promise<AIGenerationResponse<T>>;
}
