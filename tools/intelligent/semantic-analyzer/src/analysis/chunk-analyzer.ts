// ---------------------------------------------------------------------------
// Chunk analyzer – sends individual chunks to AI for extraction
// ---------------------------------------------------------------------------
// Includes a single semantic repair attempt when the AI response fails schema
// validation (spec §40: semanticRepairAttempts = 1).
//
// The raw AI response is normalized before schema validation: missing required
// arrays are filled with empty defaults, and missing confidence values get a
// safe default. This handles the common case where the model omits empty
// collections rather than outputting `[]`.

import type { AIProvider, JSONSchema } from 'ai-provider';
import type { ChunkSemanticResult, SemanticWarning } from '../models.js';
import type { ContextChunk } from '../persistence/loader.js';
import { SemanticAnalyzerError, SemanticErrorCode } from '../errors.js';
import { SemanticWarningCode } from '../warnings.js';
import { SEMANTIC_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildChunkAnalysisPrompt } from '../prompts/chunk.js';
import { DEFAULT_SEMANTIC_BUDGET, generateBudgeted, type SemanticAnalyzerBudget } from '../budget.js';

/**
 * Lenient schema used to force json_object mode at the provider level.
 * The actual field-level normalization is done by normalizeChunkResponse().
 */
const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/** Maximum number of schema-level repair attempts per chunk. */
const MAX_REPAIR_ATTEMPTS = 1;

/** Default confidence for objects where the AI omitted the value. */
const DEFAULT_CONFIDENCE = 0.7;

/**
 * Normalize a raw AI response object to ensure all required schema fields
 * are present. Fills missing arrays with [] and missing confidence with
 * a safe default.
 */
function normalizeChunkResponse(raw: Record<string, unknown>, contextId: string): ChunkSemanticResult {
  const rawSections = (Array.isArray(raw.sections) ? raw.sections : []) as Array<Record<string, unknown>>;
  const rawEntities = (Array.isArray(raw.entities) ? raw.entities : []) as Array<Record<string, unknown>>;
  const rawFlows = (Array.isArray(raw.flows) ? raw.flows : []) as Array<Record<string, unknown>>;
  const rawRules = (Array.isArray(raw.rules) ? raw.rules : []) as Array<Record<string, unknown>>;
  const rawRelationships = (Array.isArray(raw.relationships) ? raw.relationships : []) as Array<Record<string, unknown>>;
  const rawUnresolved = (Array.isArray(raw.unresolved) ? raw.unresolved : []) as Array<Record<string, unknown>>;

  // Ensure localId on all items (generate deterministic fallback if missing)
  let autoId = 0;
  const ensureLocalId = (item: Record<string, unknown>): void => {
    if (!item.localId || typeof item.localId !== 'string') {
      item.localId = `auto-${String(++autoId).padStart(3, '0')}`;
    }
  };

  // Normalize + filter: keep only items with minimum required fields
  const sections = rawSections.filter((s) => typeof s.title === 'string' && s.title.length > 0);
  for (const s of sections) {
    ensureLocalId(s);
    if (typeof s.confidence !== 'number') s.confidence = DEFAULT_CONFIDENCE;
    if (!Array.isArray(s.provenance)) s.provenance = [{ contextId }];
  }

  const entities = rawEntities.filter((e) => typeof e.name === 'string' && e.name.length > 0);
  for (const e of entities) {
    ensureLocalId(e);
    if (typeof e.type !== 'string') e.type = 'unknown';
    if (typeof e.confidence !== 'number') e.confidence = DEFAULT_CONFIDENCE;
    if (!Array.isArray(e.provenance)) e.provenance = [{ contextId }];
  }

  const flows = rawFlows.filter((f) => typeof f.name === 'string' && f.name.length > 0);
  for (const f of flows) {
    ensureLocalId(f);
    if (typeof f.confidence !== 'number') f.confidence = DEFAULT_CONFIDENCE;
    if (!Array.isArray(f.steps)) f.steps = [];
    if (!Array.isArray(f.provenance)) f.provenance = [{ contextId }];
    for (const step of f.steps as Array<Record<string, unknown>>) {
      if (!Array.isArray(step.provenance)) step.provenance = [];
    }
  }

  const rules = rawRules.filter((r) => typeof r.statement === 'string' && r.statement.length > 0);
  for (const r of rules) {
    ensureLocalId(r);
    if (typeof r.type !== 'string') r.type = 'unknown';
    if (typeof r.confidence !== 'number') r.confidence = DEFAULT_CONFIDENCE;
    if (!Array.isArray(r.provenance)) r.provenance = [{ contextId }];
  }

  const relationships = rawRelationships.filter((r) => typeof r.sourceLocalId === 'string' && typeof r.targetLocalId === 'string');
  for (const rel of relationships) {
    ensureLocalId(rel);
    if (typeof rel.type !== 'string') rel.type = 'related';
    if (typeof rel.confidence !== 'number') rel.confidence = DEFAULT_CONFIDENCE;
    if (!Array.isArray(rel.provenance)) rel.provenance = [{ contextId }];
  }

  const unresolved = rawUnresolved.filter((u) => typeof u.description === 'string' && u.description.length > 0);
  for (const u of unresolved) {
    ensureLocalId(u);
    if (typeof u.type !== 'string') u.type = 'ambiguous';
    if (typeof u.reason !== 'string') u.reason = 'AI could not determine with confidence';
    if (!Array.isArray(u.provenance)) u.provenance = [{ contextId }];
  }

  return {
    contextId: (raw.contextId as string) || contextId,
    sections: sections as unknown as ChunkSemanticResult['sections'],
    entities: entities as unknown as ChunkSemanticResult['entities'],
    flows: flows as unknown as ChunkSemanticResult['flows'],
    rules: rules as unknown as ChunkSemanticResult['rules'],
    relationships: relationships as unknown as ChunkSemanticResult['relationships'],
    unresolved: unresolved as unknown as ChunkSemanticResult['unresolved'],
  };
}

/**
 * Analyze a single context chunk using the AI provider.
 *
 * Returns the structured ChunkSemanticResult.
 * Requests raw JSON (no schema enforcement at provider level), normalizes
 * the response, then validates against the schema. Retries once with a
 * repair prompt if validation fails.
 */
export async function analyzeChunk(
  chunk: ContextChunk,
  provider: AIProvider,
  budget: SemanticAnalyzerBudget = DEFAULT_SEMANTIC_BUDGET,
  providerOptions?: Record<string, unknown>,
): Promise<{ result: ChunkSemanticResult; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; warnings?: SemanticWarning[]; metrics: { requests: number; schemaRepairs: number; estimatedInputTokens: number; maxEstimatedInputTokens: number } }> {
  const systemPrompt = SEMANTIC_SYSTEM_PROMPT;
  const userPrompt = buildChunkAnalysisPrompt(chunk);
  const warnings: SemanticWarning[] = [];
  let requests = 0;
  let estimatedInputTokens = 0;
  let maxEstimatedInputTokens = 0;

  let lastError: unknown;
  for (let attempt = 0; attempt <= Math.min(MAX_REPAIR_ATTEMPTS, budget.maxRepairAttempts); attempt++) {
    try {
      const messages = attempt === 0
        ? [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ]
        : [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
            { role: 'assistant' as const, content: `My previous response was invalid. Let me correct it.` },
            { role: 'user' as const, content: `Your previous response was missing required fields. The error was: ${lastError instanceof Error ? lastError.message : String(lastError)}. Please ensure ALL required fields are present: contextId, sections, entities, flows, rules, relationships, unresolved. Every flow/rule/entity must have provenance and confidence.` },
          ];

      // Request JSON output using a lenient schema to enable json_object mode.
      // Detailed normalization is done afterwards.
      requests++;
      const response = await generateBudgeted(provider, {
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
        providerOptions,
      }, budget, { phase: attempt === 0 ? 'chunk-analysis' : 'chunk-schema-repair', contextIds: [chunk.id] });
      estimatedInputTokens += response.request.estimatedInputTokens;
      maxEstimatedInputTokens = Math.max(maxEstimatedInputTokens, response.request.estimatedInputTokens);

      // Normalize the raw response to fill missing defaults
      const result = normalizeChunkResponse(response.response.data as Record<string, unknown>, chunk.id);

      // Ensure contextId matches the source chunk
      if (result.contextId !== chunk.id) {
        result.contextId = chunk.id;
      }

      if (attempt > 0) {
        warnings.push({
          code: SemanticWarningCode.REPAIR_APPLIED,
          message: `Schema repair succeeded on attempt ${attempt} for chunk "${chunk.id}"`,
          contextId: chunk.id,
        });
      }

      return {
        result,
        usage: response.response.usage ?? {},
        warnings: warnings.length > 0 ? warnings : undefined,
        metrics: { requests, schemaRepairs: warnings.length, estimatedInputTokens, maxEstimatedInputTokens },
      };
    } catch (err) {
      lastError = err;
    }
  }

  // All attempts exhausted
  throw new SemanticAnalyzerError(
    SemanticErrorCode.SCHEMA_FAILURE,
    `Chunk "${chunk.id}" failed after ${Math.min(MAX_REPAIR_ATTEMPTS, budget.maxRepairAttempts) + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}
