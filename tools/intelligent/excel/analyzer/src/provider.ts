// ---------------------------------------------------------------------------
// AI Provider contract
// ---------------------------------------------------------------------------

import type { SemanticIR } from './models.js';

/**
 * Abstract interface for AI providers.
 * The analyzer sends context chunks + instructions, and receives Semantic IR.
 */
export interface AIProvider {
  /** Provider name for provenance. */
  readonly name: string;

  /**
   * Send a prompt with Excel context and receive structured Semantic IR.
   *
   * @param systemPrompt - System instructions defining the task
   * @param userContent - The Excel context to analyze
   * @returns Parsed Semantic IR
   */
  analyze(systemPrompt: string, userContent: string): Promise<SemanticIR>;
}

/** Error thrown when AI provider fails. */
export class AIProviderError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
  }
}
