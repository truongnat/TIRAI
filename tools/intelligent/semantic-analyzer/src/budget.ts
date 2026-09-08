// ---------------------------------------------------------------------------
// Semantic Analyzer request budgets
// ---------------------------------------------------------------------------

import { AIProviderError, AIProviderErrorCode, type AIProvider, type AIGenerationRequest } from 'ai-provider';

export const SEMANTIC_INPUT_BUDGET_EXCEEDED = 'SEMANTIC_INPUT_BUDGET_EXCEEDED';
export const SEMANTIC_REQUEST_LIMIT_EXCEEDED = 'SEMANTIC_REQUEST_LIMIT_EXCEEDED';
export const SEMANTIC_OUTPUT_LIMIT_EXCEEDED = 'SEMANTIC_OUTPUT_LIMIT_EXCEEDED';

export interface OutputBudgetPolicy {
  /** Hard ceiling for output tokens per request. Default: 2048. */
  maxOutputBudgetCeiling: number;
  /** Maximum number of output-budget escalations per chunk. Default: 1. */
  maxOutputEscalations: number;
}

export const DEFAULT_OUTPUT_BUDGET_POLICY: OutputBudgetPolicy = {
  maxOutputBudgetCeiling: 4096,
  maxOutputEscalations: 1,
};

/**
 * Tiered adaptive output budget.
 *
 * Smaller inputs get the base budget (1024). As estimated input grows,
 * the output budget increases to accommodate denser semantic output.
 * The hard ceiling caps the maximum regardless of input size.
 */
const OUTPUT_BUDGET_TIERS: Array<{ maxInputTokens: number; outputTokens: number }> = [
  { maxInputTokens: 2000, outputTokens: 2048 },
  { maxInputTokens: 8000, outputTokens: 4096 },
  { maxInputTokens: Infinity, outputTokens: 8192 },
];

/**
 * Compute the adaptive output budget for a request based on estimated input size.
 * The result is clamped to the hard ceiling.
 */
export function computeAdaptiveOutputBudget(
  estimatedInputTokens: number,
  policy: OutputBudgetPolicy = DEFAULT_OUTPUT_BUDGET_POLICY,
): number {
  for (const tier of OUTPUT_BUDGET_TIERS) {
    if (estimatedInputTokens <= tier.maxInputTokens) {
      return Math.min(tier.outputTokens, policy.maxOutputBudgetCeiling);
    }
  }
  return policy.maxOutputBudgetCeiling;
}

/** Escalate an output budget by one tier, respecting the hard ceiling. */
export function escalateOutputBudget(
  currentBudget: number,
  policy: OutputBudgetPolicy = DEFAULT_OUTPUT_BUDGET_POLICY,
): number | null {
  for (const tier of OUTPUT_BUDGET_TIERS) {
    if (tier.outputTokens > currentBudget) {
      const escalated = Math.min(tier.outputTokens, policy.maxOutputBudgetCeiling);
      return escalated > currentBudget ? escalated : null;
    }
  }
  // Already at or above the highest tier — check if ceiling allows more
  return null;
}

/** Check whether an error is an OUTPUT_LIMIT_EXCEEDED from the provider. */
export function isOutputLimitError(error: unknown): boolean {
  return error instanceof AIProviderError && error.code === AIProviderErrorCode.OUTPUT_LIMIT_EXCEEDED;
}

export interface SemanticAnalyzerBudget {
  maxInputTokensPerRequest: number;
  maxOutputTokensPerRequest: number;
  maxContextsPerBatch: number;
  maxConcurrentRequests: number;
  maxRepairAttempts: number;
  maxConsolidationInputTokens: number;
  maxConsolidationItemsPerBatch: number;
  /** Separate hard-bounded output budget for consolidation requests. */
  maxConsolidationOutputTokens: number;
  maxTotalRequests?: number;
  /** Adaptive output budget policy. */
  outputBudgetPolicy?: OutputBudgetPolicy;
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
  maxConsolidationOutputTokens: 2048,
  maxTotalRequests: 5000,
  outputBudgetPolicy: DEFAULT_OUTPUT_BUDGET_POLICY,
};

export function resolveSemanticBudget(overrides?: Partial<SemanticAnalyzerBudget>): SemanticAnalyzerBudget {
  const budget = { ...DEFAULT_SEMANTIC_BUDGET, ...overrides };
  if (budget.maxConcurrentRequests < 1 || budget.maxContextsPerBatch < 1 || budget.maxConsolidationItemsPerBatch < 1) {
    throw new Error('Semantic analyzer budget values must be positive.');
  }
  if (budget.maxInputTokensPerRequest < 1 || budget.maxConsolidationInputTokens < 1 || budget.maxOutputTokensPerRequest < 1 || budget.maxConsolidationOutputTokens < 1) {
    throw new Error('Semantic analyzer token budgets must be positive.');
  }
  const policy = { ...(budget.outputBudgetPolicy ?? DEFAULT_OUTPUT_BUDGET_POLICY) };
  const envCeiling = Number(process.env.TIRAI_OUTPUT_BUDGET_CEILING);
  if (Number.isFinite(envCeiling) && envCeiling > 0) {
    policy.maxOutputBudgetCeiling = envCeiling;
  }
  const envEscalations = Number(process.env.TIRAI_OUTPUT_BUDGET_ESCALATIONS);
  if (Number.isFinite(envEscalations) && envEscalations >= 0) {
    policy.maxOutputEscalations = envEscalations;
  }
  if (policy.maxOutputBudgetCeiling < 1 || policy.maxOutputEscalations < 0) {
    throw new Error('Output budget policy values must be non-negative.');
  }
  // The base output budget must not exceed the hard ceiling.
  budget.maxOutputTokensPerRequest = Math.min(budget.maxOutputTokensPerRequest, policy.maxOutputBudgetCeiling);
  // Consolidation output is bounded independently.
  budget.maxConsolidationOutputTokens = Math.min(budget.maxConsolidationOutputTokens, policy.maxOutputBudgetCeiling);
  budget.outputBudgetPolicy = policy;
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
  outputTokenOverride?: number,
): Promise<{ response: Awaited<ReturnType<AIProvider['generate']>>; request: BudgetedRequestMetadata }> {
  const effectiveOutput = outputTokenOverride ?? budget.maxOutputTokensPerRequest;
  const cappedOutput = Math.min(effectiveOutput, budget.outputBudgetPolicy?.maxOutputBudgetCeiling ?? budget.maxOutputTokensPerRequest);
  const boundedRequest = { ...request, maxOutputTokens: cappedOutput };
  // For the budget assertion, temporarily raise the ceiling to the override
  const assertionBudget = outputTokenOverride
    ? { ...budget, maxOutputTokensPerRequest: cappedOutput }
    : budget;
  const requestInfo = assertRequestWithinBudget(boundedRequest, assertionBudget, metadata);
  const response = await provider.generate(boundedRequest);
  return { response, request: requestInfo };
}
