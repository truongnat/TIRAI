// ---------------------------------------------------------------------------
// Semantic Analyzer request budgets
// ---------------------------------------------------------------------------

import type { AIProvider, AIGenerationRequest } from 'ai-provider';

export const SEMANTIC_INPUT_BUDGET_EXCEEDED = 'SEMANTIC_INPUT_BUDGET_EXCEEDED';
export const SEMANTIC_REQUEST_LIMIT_EXCEEDED = 'SEMANTIC_REQUEST_LIMIT_EXCEEDED';

export interface SemanticAnalyzerBudget {
  maxInputTokensPerRequest: number;
  maxOutputTokensPerRequest: number;
  maxContextsPerBatch: number;
  maxConcurrentRequests: number;
  maxRepairAttempts: number;
  maxConsolidationInputTokens: number;
  maxConsolidationItemsPerBatch: number;
  maxTotalRequests?: number;
}

export const DEFAULT_SEMANTIC_BUDGET: SemanticAnalyzerBudget = {
  // Conservative application ceilings. They are deliberately below common
  // provider context windows and apply to every request, including repair.
  maxInputTokensPerRequest: 8192,
  maxOutputTokensPerRequest: 1024,
  maxContextsPerBatch: 8,
  maxConcurrentRequests: 2,
  maxRepairAttempts: 1,
  maxConsolidationInputTokens: 8192,
  maxConsolidationItemsPerBatch: 8,
  maxTotalRequests: 5000,
};

export function resolveSemanticBudget(overrides?: Partial<SemanticAnalyzerBudget>): SemanticAnalyzerBudget {
  const budget = { ...DEFAULT_SEMANTIC_BUDGET, ...overrides };
  if (budget.maxConcurrentRequests < 1 || budget.maxContextsPerBatch < 1 || budget.maxConsolidationItemsPerBatch < 1) {
    throw new Error('Semantic analyzer budget values must be positive.');
  }
  if (budget.maxInputTokensPerRequest < 1 || budget.maxConsolidationInputTokens < 1 || budget.maxOutputTokensPerRequest < 1) {
    throw new Error('Semantic analyzer token budgets must be positive.');
  }
  return budget;
}

export interface BudgetedRequestMetadata {
  phase: string;
  contextIds?: string[];
  estimatedInputTokens: number;
  maxOutputTokens: number;
}

/** Deterministic safety estimate, not provider billing usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateRequestTokens<T>(request: AIGenerationRequest<T>): number {
  const messageTokens = request.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const schemaTokens = request.responseSchema ? estimateTokens(JSON.stringify(request.responseSchema)) : 0;
  return messageTokens + schemaTokens;
}

export function assertRequestWithinBudget<T>(
  request: AIGenerationRequest<T>,
  budget: SemanticAnalyzerBudget,
  metadata: Omit<BudgetedRequestMetadata, 'estimatedInputTokens' | 'maxOutputTokens'>,
): BudgetedRequestMetadata {
  const estimatedInputTokens = estimateRequestTokens(request);
  const maxOutputTokens = request.maxOutputTokens ?? 0;
  if (estimatedInputTokens > budget.maxInputTokensPerRequest) {
    const contextSuffix = metadata.contextIds?.length ? ` (${metadata.contextIds.join(', ')})` : '';
    throw new Error(`${SEMANTIC_INPUT_BUDGET_EXCEEDED}: ${metadata.phase}${contextSuffix}; estimated ${estimatedInputTokens}, budget ${budget.maxInputTokensPerRequest}`);
  }
  if (maxOutputTokens <= 0 || maxOutputTokens > budget.maxOutputTokensPerRequest) {
    throw new Error(`SEMANTIC_OUTPUT_BUDGET_EXCEEDED: ${metadata.phase}; configured ${maxOutputTokens}, budget ${budget.maxOutputTokensPerRequest}`);
  }
  return { ...metadata, estimatedInputTokens, maxOutputTokens };
}

export async function generateBudgeted<T>(
  provider: AIProvider,
  request: AIGenerationRequest<T>,
  budget: SemanticAnalyzerBudget,
  metadata: Omit<BudgetedRequestMetadata, 'estimatedInputTokens' | 'maxOutputTokens'>,
): Promise<{ response: Awaited<ReturnType<AIProvider['generate']>>; request: BudgetedRequestMetadata }> {
  const boundedRequest = { ...request, maxOutputTokens: budget.maxOutputTokensPerRequest };
  const requestInfo = assertRequestWithinBudget(boundedRequest, budget, metadata);
  const response = await provider.generate(boundedRequest);
  return { response, request: requestInfo };
}
