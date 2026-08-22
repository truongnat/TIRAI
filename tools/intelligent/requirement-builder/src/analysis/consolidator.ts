// ---------------------------------------------------------------------------
// Consolidator – sends candidate set to AI for dedup + conflict detection
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  RequirementCandidate,
  RequirementConsolidationResult,
  RequirementWarning,
  ProvenanceReference,
} from '../models.js';
import { RequirementWarningCode } from '../warnings.js';
import { REQUIREMENT_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildConsolidationPrompt } from '../prompts/consolidation.js';

/** Lenient schema for json_object mode. */
const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Run consolidation: AI-assisted duplicate detection + conflict detection.
 */
export async function consolidate(
  candidates: RequirementCandidate[],
  provider: AIProvider,
): Promise<{
  result: RequirementConsolidationResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: RequirementWarning[];
}> {
  const systemPrompt = REQUIREMENT_SYSTEM_PROMPT;
  const userPrompt = buildConsolidationPrompt(candidates);
  const warnings: RequirementWarning[] = [];

  try {
    const response = await provider.generate<Record<string, unknown>>({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseSchema: lenientObjectSchema,
      temperature: 0,
    });

    const result = normalizeConsolidationResult(response.data);

    return {
      result,
      usage: response.usage ?? {},
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    // Consolidation failure is not fatal — return empty result
    warnings.push({
      code: RequirementWarningCode.PARTIAL_EXTRACTION,
      message: `Consolidation failed: ${err instanceof Error ? err.message : String(err)}`,
    });

    return {
      result: { duplicateGroups: [], additionalConflicts: [] },
      usage: {},
      warnings,
    };
  }
}

/**
 * Normalize raw AI response to RequirementConsolidationResult.
 */
function normalizeConsolidationResult(raw: Record<string, unknown>): RequirementConsolidationResult {
  const rawGroups = (Array.isArray(raw.duplicateGroups) ? raw.duplicateGroups : []) as Array<Record<string, unknown>>;
  const rawConflicts = (Array.isArray(raw.additionalConflicts) ? raw.additionalConflicts : []) as Array<Record<string, unknown>>;

  const duplicateGroups = rawGroups
    .filter((g) => Array.isArray(g.sourceTemporaryIds) && (g.sourceTemporaryIds as unknown[]).length >= 2)
    .map((g) => ({
      sourceTemporaryIds: (g.sourceTemporaryIds as unknown[]).filter((x): x is string => typeof x === 'string'),
      reason: typeof g.reason === 'string' ? g.reason : 'Duplicate candidates',
      confidence: typeof g.confidence === 'number' ? g.confidence : 0.7,
    }));

  const additionalConflicts = rawConflicts
    .filter((c) => Array.isArray(c.requirementTemporaryIds) && (c.requirementTemporaryIds as unknown[]).length >= 2)
    .map((c) => ({
      requirementTemporaryIds: (c.requirementTemporaryIds as unknown[]).filter((x): x is string => typeof x === 'string'),
      description: typeof c.description === 'string' ? c.description : 'Potential conflict',
      type: typeof c.type === 'string' ? c.type : 'ambiguous',
      provenance: normalizeProvenance(c.provenance),
      confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
    }));

  return { duplicateGroups, additionalConflicts };
}

function normalizeProvenance(raw: unknown): ProvenanceReference[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && typeof p.contextId === 'string')
    .map((p) => ({
      contextId: p.contextId as string,
      sheet: typeof p.sheet === 'string' ? p.sheet : undefined,
      ranges: Array.isArray(p.ranges) ? p.ranges.filter((x): x is string => typeof x === 'string') : undefined,
      cells: Array.isArray(p.cells) ? p.cells.filter((x): x is string => typeof x === 'string') : undefined,
    }));
}
