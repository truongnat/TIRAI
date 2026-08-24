// ---------------------------------------------------------------------------
// DeepSeekProvider – AIProvider implementation for DeepSeek
// ---------------------------------------------------------------------------
// Responsibilities:
// 1. Validate config
// 2. Map generic request → DeepSeek API request (OpenAI-compatible)
// 3. Execute request via fetch (with timeout + retry)
// 4. Handle structured output (json_object mode + local schema validation)
// 5. Parse + validate response
// 6. Normalize errors
// 7. Return generic response
//
// Uses native fetch – no DeepSeek/OpenAI SDK dependency.

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
import { resolveDeepSeekConfig, type DeepSeekProviderConfig } from './deepseek-config.js';
import { mapDeepSeekError } from './deepseek-errors.js';
import { mapDeepSeekResponse, type DeepSeekRawResponse } from './deepseek-mapper.js';

/**
 * DeepSeek AI provider.
 *
 * Uses DeepSeek's OpenAI-compatible chat completions endpoint via native fetch.
 * Structured output is enforced via `response_format: { type: "json_object" }`
 * plus local JSON Schema validation using Ajv.
 */
export class DeepSeekProvider implements AIProvider {
  public readonly name = 'deepseek';
  public readonly capabilities: AIProviderCapabilities = {
    structuredOutput: true,
    // DeepSeek supports json_object mode but not arbitrary JSON Schema enforcement
    strictStructuredOutput: false,
    streaming: false,
  };

  private readonly config: DeepSeekProviderConfig;

  constructor(config?: Partial<DeepSeekProviderConfig>) {
    this.config = resolveDeepSeekConfig(config);
  }

  async generate<T>(
    request: AIGenerationRequest<T>,
  ): Promise<AIGenerationResponse<T>> {
    const model = request.model ?? this.config.model;
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;

    // Build the DeepSeek API request body
    const body = this.buildRequestBody(model, request);

    // Execute with retry for transient errors
    const response = await withRetry(
      async () => {
        const raw = await this.executeRequest(body, timeoutMs);
        return { raw, rawText: this.extractContent(raw, Boolean(request.responseSchema)) };
      },
      {
        maxRetries: this.config.maxRetries,
        providerName: this.name,
      },
    );

    // Parse and validate
    const data = parseAndValidate<T>(response.rawText, request.responseSchema, this.name);

    return mapDeepSeekResponse(response.raw, data, response.rawText);
  }

  /**
   * Check whether a given model supports structured output on DeepSeek.
   * All current DeepSeek chat models support json_object mode.
   */
  supportsStructuredOutput(_model?: string): boolean {
    return true;
  }

  // ---- Private helpers ----------------------------------------------------

  private buildRequestBody<T>(
    model: string,
    request: AIGenerationRequest<T>,
  ): Record<string, unknown> {
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

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0,
    };

    const deepseekOptions = request.providerOptions?.deepseek;
    if (isDeepSeekOptions(deepseekOptions) && deepseekOptions.thinking) {
      body.thinking = { type: deepseekOptions.thinking };
    }

    if (request.maxOutputTokens) {
      body.max_tokens = request.maxOutputTokens;
    }

    if (request.responseSchema) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  private mapMessage(msg: AIMessage): Record<string, string> {
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  /**
   * Build a system message that instructs the model to output JSON
   * conforming to the provided schema.
   *
   * DeepSeek's json_object mode guarantees valid JSON output, but the schema
   * must be communicated in the prompt since DeepSeek does not support
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
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<DeepSeekRawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `${this.config.baseUrl}/v1/chat/completions`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = { message: response.statusText };
        }
        // eslint-disable-next-line no-throw-literal
        throw {
          status: response.status,
          error: errorBody,
        };
      }

      const raw = await response.json() as DeepSeekRawResponse;
      return raw;
    } catch (err) {
      // Re-throw AIProviderError as-is (from non-OK response)
      if (err instanceof AIProviderError) throw err;
      throw mapDeepSeekError(err, this.name);
    } finally {
      clearTimeout(timer);
    }
  }

  private extractContent(raw: DeepSeekRawResponse, jsonMode: boolean): string {
    if (!Array.isArray(raw.choices) || raw.choices.length === 0) {
      throw new AIProviderError({
        code: AIProviderErrorCode.MALFORMED_PROVIDER_RESPONSE,
        provider: this.name,
        message: 'DeepSeek returned a response without choices.',
        requestId: raw.id,
      });
    }

    const choice = raw.choices[0];
    if (choice?.finish_reason === 'length') {
      const msgContent = choice.message?.content;
      const msgReasoning = choice.message?.reasoning_content;
      const contentPresent = typeof msgContent === 'string' && msgContent.length > 0;
      const contentLength = contentPresent ? (msgContent as string).length : 0;
      const reasoningPresent = typeof msgReasoning === 'string' && msgReasoning.length > 0;
      const usageInfo = raw.usage
        ? `prompt=${raw.usage.prompt_tokens ?? '?'}, completion=${raw.usage.completion_tokens ?? '?'}, total=${raw.usage.total_tokens ?? '?'}`
        : '<no usage>';
      throw new AIProviderError({
        code: AIProviderErrorCode.OUTPUT_LIMIT_EXCEEDED,
        provider: this.name,
        message: `DeepSeek reached the configured output token limit. Usage: ${usageInfo}. contentPresent=${contentPresent}, contentLength=${contentLength}, reasoningPresent=${reasoningPresent}, finishReason=length`,
        requestId: raw.id,
      });
    }

    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AIProviderError({
        code: AIProviderErrorCode.RESPONSE_EMPTY,
        provider: this.name,
        message: 'DeepSeek returned empty content.',
        requestId: raw.id,
        retryable: jsonMode,
      });
    }
    return content.trim();
  }
}

function isDeepSeekOptions(value: unknown): value is { thinking?: 'enabled' | 'disabled' } {
  if (!value || typeof value !== 'object') return false;
  const thinking = (value as { thinking?: unknown }).thinking;
  return thinking === undefined || thinking === 'enabled' || thinking === 'disabled';
}
