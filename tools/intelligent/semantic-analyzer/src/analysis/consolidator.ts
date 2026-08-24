// ---------------------------------------------------------------------------
// Consolidator – Pass 2 global AI consolidation
// ---------------------------------------------------------------------------
// Requests raw JSON and normalizes the response to handle AI models that
// omit empty arrays or optional fields.

import type { AIProvider, JSONSchema } from 'ai-provider';
import type { ChunkSemanticResult, ConsolidationResult } from '../models.js';
import { SEMANTIC_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildConsolidationPrompt } from '../prompts/consolidation.js';
import { DEFAULT_SEMANTIC_BUDGET, estimateRequestTokens, generateBudgeted, type SemanticAnalyzerBudget } from '../budget.js';
import { computeConsolidationFingerprint } from '../fingerprint.js';
import { readConsolidationCheckpoint, writeConsolidationCheckpoint } from '../persistence/writer.js';

export interface ConsolidationMetrics {
  batchRequests: number;
  globalRequests: number;
  maxEstimatedInputTokens: number;
  batches: number;
  estimatedInputTokens: number;
}

export interface ConsolidationCheckpointOptions {
  outputDir: string;
  resume: boolean;
  provider: string;
  model: string;
  promptVersion: string;
  providerOptions?: Record<string, unknown>;
}

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
  budget: SemanticAnalyzerBudget = DEFAULT_SEMANTIC_BUDGET,
  phase = 'consolidation',
  providerOptions?: Record<string, unknown>,
): Promise<{ result: ConsolidationResult; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
  const userPrompt = buildConsolidationPrompt(chunkResults, sheetNames);

  const response = await generateBudgeted(provider, {
    messages: [
      { role: 'system', content: SEMANTIC_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseSchema: lenientObjectSchema,
    temperature: 0,
    providerOptions,
  }, { ...budget, maxInputTokensPerRequest: Math.min(budget.maxInputTokensPerRequest, budget.maxConsolidationInputTokens) }, { phase, contextIds: chunkResults.map((r) => r.contextId) });

  // Normalize: ensure required arrays exist
  const raw = response.response.data as Record<string, unknown>;
  const result: ConsolidationResult = {
    mergeCandidates: Array.isArray(raw.mergeCandidates) ? raw.mergeCandidates as ConsolidationResult['mergeCandidates'] : [],
    crossChunkRelationships: Array.isArray(raw.crossChunkRelationships) ? raw.crossChunkRelationships as ConsolidationResult['crossChunkRelationships'] : [],
  };

  if (raw.documentSummary && typeof raw.documentSummary === 'object') {
    result.documentSummary = raw.documentSummary as ConsolidationResult['documentSummary'];
  }

  return {
    result,
    usage: response.response.usage ?? {},
  };
}

/**
 * Consolidate in deterministic, bounded levels. Sheet-local batches are
 * reduced first; only their small consolidation records enter later levels.
 */
export async function consolidateHierarchically(
  chunkResults: ChunkSemanticResult[],
  sheetNames: string[],
  provider: AIProvider,
  budget: SemanticAnalyzerBudget = DEFAULT_SEMANTIC_BUDGET,
  contextSheetMap?: Map<string, string>,
  requestOffset = 0,
  checkpoint?: ConsolidationCheckpointOptions,
  providerOptions?: Record<string, unknown>,
): Promise<{
  result: ConsolidationResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  metrics: ConsolidationMetrics;
}> {
  const metrics: ConsolidationMetrics = { batchRequests: 0, globalRequests: 0, maxEstimatedInputTokens: 0, batches: 0, estimatedInputTokens: 0 };
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const batchResults: ConsolidationResult[] = [];
  let plannedRequests = 0;
  const consumeRequest = (): void => {
    plannedRequests++;
    if (budget.maxTotalRequests && requestOffset + plannedRequests > budget.maxTotalRequests) {
      throw new Error(`SEMANTIC_REQUEST_LIMIT_EXCEEDED: ${budget.maxTotalRequests}`);
    }
  };

  // Small inputs retain the original single global pass. This keeps the v1
  // contract stable while the large-workbook path below becomes hierarchical.
  if (chunkResults.length <= budget.maxConsolidationItemsPerBatch && estimateConsolidationTokens(chunkResults, sheetNames) <= budget.maxConsolidationInputTokens) {
    consumeRequest();
    const cons = await consolidate(chunkResults, sheetNames, provider, budget, 'global-consolidation', checkpoint?.providerOptions ?? providerOptions);
    metrics.globalRequests = 1;
    metrics.maxEstimatedInputTokens = estimateConsolidationTokens(chunkResults, sheetNames);
    metrics.estimatedInputTokens = metrics.maxEstimatedInputTokens;
    addUsage(usage, cons.usage);
    return { result: cons.result, usage, metrics };
  }

  // Preserve loader order, while keeping each sheet local at the first level.
  const bySheet = new Map<string, ChunkSemanticResult[]>();
  for (const result of chunkResults) {
    const sheet = contextSheetMap?.get(result.contextId) ?? result.contextId;
    const list = bySheet.get(sheet) ?? [];
    list.push(result);
    bySheet.set(sheet, list);
  }

  const plannedBatches = [...bySheet.entries()].flatMap(([sheet, results]) =>
    splitChunkResults(results, [sheet], budget).map((batch) => ({ sheet, batch })),
  );
  for (const [{ sheet, batch }, batchIndex] of plannedBatches.map((planned, index) => [planned, index] as const)) {
    const checkpointId = `sheet-${batchIndex}`;
    const fingerprint = checkpoint
      ? computeConsolidationFingerprint(batch, checkpoint.promptVersion, checkpoint.model, { phase: 'sheet', sheet, budget }, checkpoint.providerOptions)
      : '';
    const cached = checkpoint?.resume
      ? readConsolidationCheckpoint(checkpoint.outputDir, fingerprint, checkpoint.provider, checkpoint.model, checkpoint.promptVersion, checkpointId)
      : null;
    if (cached) {
      batchResults.push(cached);
      continue;
    }
    consumeRequest();
    const cons = await consolidate(batch, [sheet], provider, budget, 'sheet-consolidation', checkpoint?.providerOptions ?? providerOptions);
    batchResults.push(cons.result);
    addUsage(usage, cons.usage);
    metrics.batchRequests++;
    metrics.batches++;
    metrics.maxEstimatedInputTokens = Math.max(metrics.maxEstimatedInputTokens, estimateConsolidationTokens(batch, [sheet]));
    metrics.estimatedInputTokens += estimateConsolidationTokens(batch, [sheet]);
    if (checkpoint) writeConsolidationCheckpoint(checkpoint.outputDir, fingerprint, cons.result, checkpoint.provider, checkpoint.model, checkpoint.promptVersion, checkpointId);
  }

  let level = batchResults;
  while (level.length > 0) {
    const groups = splitConsolidationResults(level, sheetNames, budget);
    const next: ConsolidationResult[] = [];
    for (const [groupIndex, group] of groups.entries()) {
      if (groups.length === 1 && level.length === 1) {
        next.push(group[0]!);
        continue;
      }
      const checkpointId = `global-${level.length}-${groupIndex}`;
      const fingerprint = checkpoint
        ? computeConsolidationFingerprint(group, checkpoint.promptVersion, checkpoint.model, { phase: 'global', sheetNames, budget, level: level.length, groupIndex }, checkpoint.providerOptions)
        : '';
      const cached = checkpoint?.resume
        ? readConsolidationCheckpoint(checkpoint.outputDir, fingerprint, checkpoint.provider, checkpoint.model, checkpoint.promptVersion, checkpointId)
        : null;
      if (cached) {
        next.push(cached);
        continue;
      }
      consumeRequest();
      const cons = await consolidateSummaryBatch(group, sheetNames, provider, budget, checkpoint?.providerOptions ?? providerOptions);
      next.push(cons.result);
      addUsage(usage, cons.usage);
      metrics.globalRequests++;
      metrics.maxEstimatedInputTokens = Math.max(metrics.maxEstimatedInputTokens, estimateSummaryTokens(group, sheetNames));
      metrics.estimatedInputTokens += estimateSummaryTokens(group, sheetNames);
      if (checkpoint) writeConsolidationCheckpoint(checkpoint.outputDir, fingerprint, cons.result, checkpoint.provider, checkpoint.model, checkpoint.promptVersion, checkpointId);
    }
    if (next.length === 1) {
      return { result: combineConsolidationResults(batchResults, next[0]!), usage, metrics };
    }
    level = next;
  }

  return { result: { mergeCandidates: [], crossChunkRelationships: [] }, usage, metrics };
}

function splitChunkResults(
  results: ChunkSemanticResult[],
  sheetNames: string[],
  budget: SemanticAnalyzerBudget,
): ChunkSemanticResult[][] {
  const batches: ChunkSemanticResult[][] = [];
  let current: ChunkSemanticResult[] = [];
  for (const result of results) {
    const candidate = [...current, result];
    const withinCount = candidate.length <= budget.maxConsolidationItemsPerBatch && candidate.length <= budget.maxContextsPerBatch;
    const withinTokens = estimateConsolidationTokens(candidate, sheetNames) <= budget.maxConsolidationInputTokens;
    if (current.length > 0 && (!withinCount || !withinTokens)) {
      batches.push(current);
      current = [result];
    } else {
      current = candidate;
    }
    if (current.length === 1 && estimateConsolidationTokens(current, sheetNames) > budget.maxConsolidationInputTokens) {
      throw new Error(`SEMANTIC_INPUT_BUDGET_EXCEEDED: consolidation batch contains ${result.contextId}`);
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function estimateConsolidationTokens(results: ChunkSemanticResult[], sheetNames: string[]): number {
  return estimateProviderPromptTokens(buildConsolidationPrompt(results, sheetNames));
}

function splitConsolidationResults(
  results: ConsolidationResult[],
  sheetNames: string[],
  budget: SemanticAnalyzerBudget,
): ConsolidationResult[][] {
  const groups: ConsolidationResult[][] = [];
  let current: ConsolidationResult[] = [];
  for (const result of results) {
    const candidate = [...current, result];
    const withinCount = candidate.length <= budget.maxConsolidationItemsPerBatch;
    const withinTokens = estimateSummaryTokens(candidate, sheetNames) <= budget.maxConsolidationInputTokens;
    if (current.length > 0 && (!withinCount || !withinTokens)) {
      groups.push(current);
      current = [result];
    } else {
      current = candidate;
    }
    if (current.length === 1 && estimateSummaryTokens(current, sheetNames) > budget.maxConsolidationInputTokens) {
      throw new Error('SEMANTIC_INPUT_BUDGET_EXCEEDED: consolidation summary batch');
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function buildSummaryPrompt(results: ConsolidationResult[], sheetNames: string[]): string {
  const parts = [
    'Consolidate bounded semantic batch results. Preserve only explicitly supported merges and relationships.',
    `Document sheets: ${sheetNames.join(', ')}`,
    `Batch results: ${results.length}`,
  ];
  results.forEach((result, index) => {
    parts.push(`--- Batch ${index + 1} ---`);
    parts.push(`Merge candidates: ${JSON.stringify(result.mergeCandidates)}`);
    parts.push(`Cross-chunk relationships: ${JSON.stringify(result.crossChunkRelationships)}`);
    if (result.documentSummary) parts.push(`Document summary: ${JSON.stringify(result.documentSummary)}`);
  });
  parts.push('Return JSON with mergeCandidates, crossChunkRelationships, and optional documentSummary.');
  return parts.join('\n');
}

function estimateSummaryTokens(results: ConsolidationResult[], sheetNames: string[]): number {
  return estimateProviderPromptTokens(buildSummaryPrompt(results, sheetNames));
}

function estimateProviderPromptTokens(userPrompt: string): number {
  return estimateRequestTokens({
    messages: [
      { role: 'system', content: SEMANTIC_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseSchema: lenientObjectSchema,
    maxOutputTokens: DEFAULT_SEMANTIC_BUDGET.maxOutputTokensPerRequest,
  });
}

async function consolidateSummaryBatch(
  results: ConsolidationResult[],
  sheetNames: string[],
  provider: AIProvider,
  budget: SemanticAnalyzerBudget,
  providerOptions?: Record<string, unknown>,
): Promise<{ result: ConsolidationResult; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }> {
  const response = await generateBudgeted(provider, {
    messages: [
      { role: 'system', content: SEMANTIC_SYSTEM_PROMPT },
      { role: 'user', content: buildSummaryPrompt(results, sheetNames) },
    ],
    responseSchema: lenientObjectSchema,
    temperature: 0,
    providerOptions,
  }, { ...budget, maxInputTokensPerRequest: Math.min(budget.maxInputTokensPerRequest, budget.maxConsolidationInputTokens) }, { phase: 'global-consolidation', contextIds: [] });
  const raw = response.response.data as Record<string, unknown>;
  return {
    result: {
      mergeCandidates: Array.isArray(raw.mergeCandidates) ? raw.mergeCandidates as ConsolidationResult['mergeCandidates'] : [],
      crossChunkRelationships: Array.isArray(raw.crossChunkRelationships) ? raw.crossChunkRelationships as ConsolidationResult['crossChunkRelationships'] : [],
      documentSummary: raw.documentSummary && typeof raw.documentSummary === 'object' ? raw.documentSummary as ConsolidationResult['documentSummary'] : undefined,
    },
    usage: response.response.usage ?? {},
  };
}

function combineConsolidationResults(batchResults: ConsolidationResult[], finalResult: ConsolidationResult): ConsolidationResult {
  const all = [...batchResults, finalResult];
  const mergeCandidates = all.flatMap((r) => r.mergeCandidates);
  const relationshipMap = new Map<string, ChunkSemanticResult['relationships'][number]>();
  for (const result of all) {
    for (const rel of result.crossChunkRelationships) {
      relationshipMap.set(JSON.stringify(rel), rel);
    }
  }
  return {
    mergeCandidates,
    crossChunkRelationships: [...relationshipMap.values()],
    documentSummary: finalResult.documentSummary ?? batchResults.find((r) => r.documentSummary)?.documentSummary,
  };
}

function addUsage(target: { inputTokens: number; outputTokens: number; totalTokens: number }, source: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): void {
  target.inputTokens += source.inputTokens ?? 0;
  target.outputTokens += source.outputTokens ?? 0;
  target.totalTokens += source.totalTokens ?? 0;
}
