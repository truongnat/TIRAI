// ---------------------------------------------------------------------------
// GroqProvider – AIProvider implementation for Groq
// ---------------------------------------------------------------------------
// Responsibilities:
// 1. Validate config
// 2. Map generic request → Groq API request
// 3. Execute request (with timeout + retry)
// 4. Handle structured output (json_object mode + local schema validation)
// 5. Parse + validate response
// 6. Normalize errors
// 7. Return generic response

import Groq, { type ClientOptions as GroqClientOptions } from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import type { AIProvider } from '../../provider.js';
import type {
  AIGenerationRequest,
  AIGenerationResponse,
  AIProviderCapabilities,
  AIMessage,
  JSONSchema,
} from '../../models.js';
import { AIProviderError, AIProviderErrorCode } from '../../errors.js';
import { withRetry } from '../../utils/retry.js';
import { parseAndValidate } from '../../utils/json.js';
import { resolveGroqConfig, type GroqProviderConfig } from './groq-config.js';
import { mapGroqError } from './groq-errors.js';
import { mapGroqResponse, type GroqRawResponse } from './groq-mapper.js';

/**
 * Groq AI provider.
 *
 * Uses Groq's OpenAI-compatible chat completions endpoint.
 * Structured output is enforced via `response_format: { type: "json_object" }`
 * plus local JSON Schema validation using Ajv.
 */
export class GroqProvider implements AIProvider {
  public readonly name = 'groq';
  public readonly capabilities: AIProviderCapabilities = {
    structuredOutput: true,
    // Groq supports json_object mode but not arbitrary JSON Schema enforcement
    strictStructuredOutput: false,
    streaming: false,
  };

  private readonly config: GroqProviderConfig;
  private readonly client: Groq;

  constructor(config?: Partial<GroqProviderConfig>) {
    this.config = resolveGroqConfig(config);

    const clientOpts: GroqClientOptions = {
      apiKey: this.config.apiKey,
    };
    if (this.config.baseUrl) {
      clientOpts.baseURL = this.config.baseUrl;
    }
    this.client = new Groq(clientOpts);
  }

  async generate<T>(
    request: AIGenerationRequest<T>,
  ): Promise<AIGenerationResponse<T>> {
    const model = request.model ?? this.config.model;
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;

    // Build the Groq API request body
    const body = this.buildRequestBody(model, request);

    // Execute with retry for transient errors
    const raw = await withRetry(
      () => this.executeRequest(body, timeoutMs),
      {
        maxRetries: this.config.maxRetries,
        providerName: this.name,
      },
    );

    // Extract the raw text content
    const rawText = this.extractContent(raw);

    // Parse and validate
    const data = parseAndValidate<T>(rawText, request.responseSchema, this.name);

    return mapGroqResponse(raw, data, rawText);
  }

  /**
   * Check whether a given model supports structured output on Groq.
   * Currently all chat models on Groq support json_object mode.
   */
  supportsStructuredOutput(_model?: string): boolean {
    // Groq's json_object mode is broadly supported across chat models
    return true;
  }

  // ---- Private helpers ----------------------------------------------------

  private buildRequestBody<T>(
    model: string,
    request: AIGenerationRequest<T>,
  ): ChatCompletionCreateParamsNonStreaming {
    const messages = request.messages.map((m) => this.mapMessage(m));

    // If a response schema is provided, inject a system instruction and
    // enable json_object response format.
    if (request.responseSchema) {
      const schemaInstruction = this.buildSchemaInstruction(request.responseSchema);
      messages.unshift({
        role: 'system',
        content: schemaInstruction,
      });
    }

    const body: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.maxOutputTokens,
    };

    if (request.responseSchema) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  private mapMessage(msg: AIMessage): ChatCompletionMessageParam {
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  /**
   * Build a system message that instructs the model to output JSON
   * conforming to the provided schema.
   *
   * Groq's json_object mode guarantees valid JSON output, but the schema
   * must be communicated in the prompt since Groq does not support
   * server-side schema enforcement like OpenAI's strict mode.
   */
  private buildSchemaInstruction(schema: JSONSchema): string {
    return [
      'You MUST respond with valid JSON that conforms to the following JSON Schema:',
      JSON.stringify(schema, null, 2),
      'Do not include any text outside the JSON object.',
    ].join('\n');
  }

  private async executeRequest(
    body: ChatCompletionCreateParamsNonStreaming,
    timeoutMs: number,
  ): Promise<GroqRawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.client.chat.completions.create(body, {
        signal: controller.signal,
      });
      return response as unknown as GroqRawResponse;
    } catch (err) {
      throw mapGroqError(err, this.name);
    } finally {
      clearTimeout(timer);
    }
  }

  private extractContent(raw: GroqRawResponse): string {
    const content = raw.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new AIProviderError({
        code: AIProviderErrorCode.RESPONSE_EMPTY,
        provider: this.name,
        message: 'Groq returned an empty response.',
        requestId: raw.id,
      });
    }
    return content.trim();
  }
}
