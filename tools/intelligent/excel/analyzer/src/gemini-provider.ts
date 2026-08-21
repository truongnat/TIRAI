// ---------------------------------------------------------------------------
// Gemini AI Provider
// ---------------------------------------------------------------------------

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIProvider } from './provider.js';
import { AIProviderError } from './provider.js';
import type { SemanticIR } from './models.js';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
}

export class GeminiProvider implements AIProvider {
  public readonly name: string;
  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;
  private readonly maxTokens: number;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey);
    this.modelName = options.model ?? 'gemini-2.5-flash';
    this.maxTokens = options.maxOutputTokens ?? 16000;
    this.name = this.modelName;
  }

  async analyze(systemPrompt: string, userContent: string): Promise<SemanticIR> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: this.maxTokens,
        temperature: 0,
      },
      systemInstruction: systemPrompt,
    });

    let result;
    try {
      result = await model.generateContent(userContent);
    } catch (err) {
      throw new AIProviderError(
        'GEMINI_API_ERROR',
        `Gemini API call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = result.response.text();
    if (!text) {
      throw new AIProviderError('EMPTY_RESPONSE', 'Gemini returned empty response');
    }

    let parsed: SemanticIR;
    try {
      parsed = JSON.parse(text) as SemanticIR;
    } catch (err) {
      throw new AIProviderError(
        'INVALID_JSON',
        `Failed to parse Gemini response as JSON: ${err instanceof Error ? err.message : String(err)}\n\nRaw response (first 500 chars): ${text.substring(0, 500)}`,
      );
    }

    return parsed;
  }
}
