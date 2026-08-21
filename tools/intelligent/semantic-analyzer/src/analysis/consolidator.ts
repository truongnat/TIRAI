// ---------------------------------------------------------------------------
// Consolidator – Pass 2 global AI consolidation
// ---------------------------------------------------------------------------
// Requests raw JSON and normalizes the response to handle AI models that
// omit empty arrays or optional fields.

import type { AIProvider, JSONSchema } from 'ai-provider';
import type { ChunkSemanticResult, ConsolidationResult } from '../models.js';
import { SEMANTIC_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildConsolidationPrompt } from '../prompts/consolidation.js';

/** Lenient schema to force json_object mode at the provider level. */
const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Run global consolidation across all chunk results.
 *
 * The AI identifies merge candidates and cross-chunk relationships.
 * Code validates and applies the merge proposals.
 */
export async function consolidate(
  chunkResults: ChunkSemanticResult[],
  sheetNames: string[],
  provider: AIProvider,
): Promise<{ result: ConsolidationResult; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
  const userPrompt = buildConsolidationPrompt(chunkResults, sheetNames);

  const response = await provider.generate<Record<string, unknown>>({
    messages: [
      { role: 'system', content: SEMANTIC_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseSchema: lenientObjectSchema,
    temperature: 0,
  });

  // Normalize: ensure required arrays exist
  const raw = response.data;
  const result: ConsolidationResult = {
    mergeCandidates: Array.isArray(raw.mergeCandidates) ? raw.mergeCandidates as ConsolidationResult['mergeCandidates'] : [],
    crossChunkRelationships: Array.isArray(raw.crossChunkRelationships) ? raw.crossChunkRelationships as ConsolidationResult['crossChunkRelationships'] : [],
  };

  if (raw.documentSummary && typeof raw.documentSummary === 'object') {
    result.documentSummary = raw.documentSummary as ConsolidationResult['documentSummary'];
  }

  return {
    result,
    usage: response.usage ?? {},
  };
}
