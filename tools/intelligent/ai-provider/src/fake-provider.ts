// ---------------------------------------------------------------------------
// Fake AI Provider – for offline testing
// ---------------------------------------------------------------------------
// Supports single response or queued responses. Enables full offline testing
// of Semantic Analyzer and other higher-level components.

import type { AIProvider } from './provider.js';
import type {
  AIGenerationRequest,
  AIGenerationResponse,
  AIProviderCapabilities,
} from './models.js';
import { parseAndValidate } from './utils/json.js';

export interface FakeProviderOptions {
  /** Provider name (default: "fake"). */
  name?: string;
  /** Static response data. Used when no queue is provided. */
  response?: unknown;
  /** Queue of responses – consumed in order. */
  responses?: unknown[];
  /** Simulated model name. */
  model?: string;
  /** Simulated usage metadata. */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** Capabilities to report. */
  capabilities?: AIProviderCapabilities;
  /** Simulate a thrown error on next call. */
  error?: Error;
}

export class FakeAIProvider implements AIProvider {
  public readonly name: string;
  public readonly capabilities: AIProviderCapabilities;

  private readonly responses: unknown[];
  private readonly model: string;
  private readonly usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  private readonly error?: Error;

  /** Record of all requests received (for assertion in tests). */
  public readonly requestLog: AIGenerationRequest[] = [];

  constructor(options: FakeProviderOptions = {}) {
    this.name = options.name ?? 'fake';
    this.model = options.model ?? 'fake-model';
    this.usage = options.usage;
    this.error = options.error;
    this.capabilities = options.capabilities ?? {
      structuredOutput: true,
      strictStructuredOutput: true,
      streaming: false,
    };

    // Build response queue
    if (options.responses && options.responses.length > 0) {
      this.responses = [...options.responses];
    } else if (options.response !== undefined) {
      this.responses = [options.response];
    } else {
      this.responses = [];
    }
  }

  async generate<T>(
    request: AIGenerationRequest<T>,
  ): Promise<AIGenerationResponse<T>> {
    this.requestLog.push(request);

    if (this.error) {
      throw this.error;
    }

    if (this.responses.length === 0) {
      throw new Error('FakeAIProvider: no more responses in queue');
    }

    const data = this.responses.shift();
    const rawText = JSON.stringify(data);

    // Validate against schema if provided
    if (request.responseSchema) {
      parseAndValidate<T>(rawText, request.responseSchema, this.name);
    }

    return {
      provider: this.name,
      model: this.model,
      data: data as T,
      rawText,
      usage: this.usage,
      finishReason: 'stop',
      requestId: `fake-${this.requestLog.length}`,
    };
  }
}
