// ---------------------------------------------------------------------------
// Offline semantic execution preflight
// ---------------------------------------------------------------------------

import { loadContextPackage, type LoadedContext } from './persistence/loader.js';
import { buildChunkAnalysisPrompt } from './prompts/chunk.js';
import { SEMANTIC_SYSTEM_PROMPT } from './prompts/system.js';
import { DEFAULT_SEMANTIC_BUDGET, estimateRequestTokens, resolveSemanticBudget, type SemanticAnalyzerBudget } from './budget.js';

export interface SemanticPreflightReport {
  contextCount: number;
  estimatedSourceTokens: number;
  sheetCount: number;
  estimatedChunkRequests: number;
  maximumEstimatedChunkInputTokens: number;
  inputBudget: number;
  outputBudget: number;
  concurrency: number;
  maxContextsPerBatch: number;
  maxConsolidationItemsPerBatch: number;
  budgetViolations: Array<{ contextId: string; estimatedInputTokens: number; budget: number }>;
  providerCalls: number;
}

export function preflightSemanticContext(
  contextPath: string,
  options?: { budget?: Partial<SemanticAnalyzerBudget>; concurrency?: number },
): SemanticPreflightReport {
  const loaded = loadContextPackage(contextPath);
  return preflightLoadedContext(loaded, options);
}

export function preflightLoadedContext(
  loaded: LoadedContext,
  options?: { budget?: Partial<SemanticAnalyzerBudget>; concurrency?: number },
): SemanticPreflightReport {
  const budget = resolveSemanticBudget(options?.budget ?? DEFAULT_SEMANTIC_BUDGET);
  const requestSchema = { type: 'object', additionalProperties: true };
  const estimates = loaded.chunks.map((chunk) => estimateRequestTokens({
    messages: [
      { role: 'system' as const, content: SEMANTIC_SYSTEM_PROMPT },
      { role: 'user' as const, content: buildChunkAnalysisPrompt(chunk) },
    ],
    responseSchema: requestSchema,
    maxOutputTokens: budget.maxOutputTokensPerRequest,
  }));
  const violations = loaded.chunks.flatMap((chunk, index) => estimates[index]! > budget.maxInputTokensPerRequest
    ? [{ contextId: chunk.id, estimatedInputTokens: estimates[index]!, budget: budget.maxInputTokensPerRequest }]
    : []);
  return {
    contextCount: loaded.chunks.length,
    estimatedSourceTokens: loaded.manifest.stats.estimatedTokens,
    sheetCount: loaded.manifest.sheets.length,
    estimatedChunkRequests: loaded.chunks.length,
    maximumEstimatedChunkInputTokens: Math.max(...estimates, 0),
    inputBudget: budget.maxInputTokensPerRequest,
    outputBudget: budget.maxOutputTokensPerRequest,
    concurrency: Math.min(options?.concurrency ?? budget.maxConcurrentRequests, budget.maxConcurrentRequests),
    maxContextsPerBatch: budget.maxContextsPerBatch,
    maxConsolidationItemsPerBatch: budget.maxConsolidationItemsPerBatch,
    budgetViolations: violations,
    providerCalls: 0,
  };
}
