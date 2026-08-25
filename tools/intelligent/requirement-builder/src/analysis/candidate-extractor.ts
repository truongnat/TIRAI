// ---------------------------------------------------------------------------
// Candidate extractor – sends semantic evidence batches to AI
// ---------------------------------------------------------------------------
// Includes normalization and single repair attempt per batch.

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  CandidateExtractionResult,
  RequirementWarning,
  RawCandidate,
  RawUnresolvedCandidate,
  RawConflictCandidate,
  RequirementType,
  RequirementSourceNature,
  ProvenanceReference,
} from '../models.js';
import { RequirementBuilderError, RequirementErrorCode } from '../errors.js';
import { RequirementWarningCode } from '../warnings.js';
import { REQUIREMENT_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildExtractionPrompt, type EvidenceBatch } from '../prompts/extraction.js';
import { buildRepairPrompt } from '../prompts/repair.js';

/** Maximum number of schema-level repair attempts per batch. */
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

/** Default confidence when AI omits the value. */
const DEFAULT_CONFIDENCE = 0.7;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'functional',
  'validation',
  'business-rule',
  'data',
  'interface',
  'security',
  'state-transition',
  'non-functional',
  'technical-constraint',
  'unknown',
]);

const VALID_SOURCE_NATURES: ReadonlySet<string> = new Set(['explicit', 'derived', 'ambiguous']);

/**
 * Lenient schema for json_object mode. Actual normalization is done afterwards.
 */
const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Extract requirement candidates from a single evidence batch.
 */
export async function extractCandidates(
  batch: EvidenceBatch,
  provider: AIProvider,
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
): Promise<{
  result: CandidateExtractionResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: RequirementWarning[];
}> {
  const systemPrompt = REQUIREMENT_SYSTEM_PROMPT;
  const userPrompt = buildExtractionPrompt(batch);
  const warnings: RequirementWarning[] = [];

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    try {
      const messages =
        attempt === 0
          ? [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: userPrompt },
            ]
          : [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: userPrompt },
              {
                role: 'assistant' as const,
                content: `My previous response was invalid. Let me correct it.`,
              },
              {
                role: 'user' as const,
                content: buildRepairPrompt('', [
                  lastError instanceof Error ? lastError.message : String(lastError),
                ]),
              },
            ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
        providerOptions: { deepseek: { thinking: 'disabled' } },
      });

      const result = normalizeExtractionResult(response.data, batch.label);

      if (attempt > 0) {
        warnings.push({
          code: RequirementWarningCode.REPAIR_APPLIED,
          message: `Schema repair succeeded on attempt ${attempt} for batch "${batch.label}"`,
        });
      }

      return {
        result,
        usage: response.usage ?? {},
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new RequirementBuilderError(
    RequirementErrorCode.SCHEMA_FAILURE,
    `Batch "${batch.label}" failed after ${maxRepairAttempts + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

/**
 * Normalize raw AI response to structured CandidateExtractionResult.
 */
function normalizeExtractionResult(
  raw: Record<string, unknown>,
  batchLabel: string,
): CandidateExtractionResult {
  const rawCandidates = (Array.isArray(raw.candidates) ? raw.candidates : []) as Array<
    Record<string, unknown>
  >;
  const rawUnresolved = (
    Array.isArray(raw.unresolvedCandidates) ? raw.unresolvedCandidates : []
  ) as Array<Record<string, unknown>>;
  const rawConflicts = (
    Array.isArray(raw.conflictCandidates) ? raw.conflictCandidates : []
  ) as Array<Record<string, unknown>>;

  let autoId = 0;
  const ensureId = (item: Record<string, unknown>): void => {
    if (!item.temporaryId || typeof item.temporaryId !== 'string') {
      item.temporaryId = `cand-${batchLabel}-${String(++autoId).padStart(3, '0')}`;
    }
  };

  // Normalize candidates
  const candidates: RawCandidate[] = [];
  for (const c of rawCandidates) {
    ensureId(c);
    if (typeof c.statement !== 'string' || c.statement.length === 0) continue;

    const type = VALID_TYPES.has(c.type as string) ? (c.type as RequirementType) : 'unknown';
    const sourceNature = VALID_SOURCE_NATURES.has(c.sourceNature as string)
      ? (c.sourceNature as RequirementSourceNature)
      : 'ambiguous';
    const confidence = typeof c.confidence === 'number' ? c.confidence : DEFAULT_CONFIDENCE;

    candidates.push({
      temporaryId: c.temporaryId as string,
      title: (typeof c.title === 'string' ? c.title : (c.statement as string)).slice(0, 200),
      type,
      statement: c.statement as string,
      sourceNature,
      semanticEvidenceIds: Array.isArray(c.semanticEvidenceIds)
        ? c.semanticEvidenceIds.filter((x): x is string => typeof x === 'string')
        : [],
      actor: typeof c.actor === 'string' ? c.actor : undefined,
      trigger: typeof c.trigger === 'string' ? c.trigger : undefined,
      preconditions: normalizeProvenancedArray(c.preconditions, 'description'),
      inputs: normalizeProvenancedArray(c.inputs, 'name'),
      dataNeeds: normalizeProvenancedArray(c.dataNeeds, 'description'),
      expectedBehaviors: normalizeProvenancedArray(c.expectedBehaviors, 'description'),
      outcomes: normalizeProvenancedArray(c.outcomes, 'description'),
      constraints: normalizeProvenancedArray(c.constraints, 'description'),
      provenance: normalizeProvenance(c.provenance),
      confidence,
      rationale: typeof c.rationale === 'string' ? c.rationale : undefined,
    });
  }

  // Normalize unresolved
  const unresolvedCandidates: RawUnresolvedCandidate[] = [];
  for (const u of rawUnresolved) {
    ensureId(u);
    if (typeof u.description !== 'string' || u.description.length === 0) continue;

    unresolvedCandidates.push({
      temporaryId: u.temporaryId as string,
      description: u.description as string,
      reason: typeof u.reason === 'string' ? u.reason : 'Insufficient evidence',
      semanticEvidenceIds: Array.isArray(u.semanticEvidenceIds)
        ? u.semanticEvidenceIds.filter((x): x is string => typeof x === 'string')
        : [],
      provenance: normalizeProvenance(u.provenance),
      candidates: Array.isArray(u.candidates)
        ? u.candidates.filter((x): x is string => typeof x === 'string')
        : undefined,
    });
  }

  // Normalize conflicts
  const conflictCandidates: RawConflictCandidate[] = [];
  for (const cf of rawConflicts) {
    ensureId(cf);
    if (typeof cf.description !== 'string' || cf.description.length === 0) continue;

    conflictCandidates.push({
      temporaryId: cf.temporaryId as string,
      requirementTemporaryIds: Array.isArray(cf.requirementTemporaryIds)
        ? cf.requirementTemporaryIds.filter((x): x is string => typeof x === 'string')
        : [],
      description: cf.description as string,
      type: typeof cf.type === 'string' ? cf.type : 'ambiguous',
      provenance: normalizeProvenance(cf.provenance),
      confidence: typeof cf.confidence === 'number' ? cf.confidence : DEFAULT_CONFIDENCE,
    });
  }

  return { candidates, unresolvedCandidates, conflictCandidates };
}

/** Normalize a provenance field that may be missing or malformed. */
function normalizeProvenance(raw: unknown): ProvenanceReference[] {
  if (!Array.isArray(raw)) return [{ contextId: 'unknown' }];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null && typeof p.contextId === 'string',
    )
    .map((p) => ({
      contextId: p.contextId as string,
      sourceId: typeof p.sourceId === 'string' ? p.sourceId : undefined,
      revisionId: typeof p.revisionId === 'string' ? p.revisionId : undefined,
      artifactId: typeof p.artifactId === 'string' ? p.artifactId : undefined,
      location: isSourceLocation(p.location) ? p.location : undefined,
      sheet: typeof p.sheet === 'string' ? p.sheet : undefined,
      ranges: Array.isArray(p.ranges)
        ? p.ranges.filter((x): x is string => typeof x === 'string')
        : undefined,
      cells: Array.isArray(p.cells)
        ? p.cells.filter((x): x is string => typeof x === 'string')
        : undefined,
    }));
}

function isSourceLocation(value: unknown): value is ProvenanceReference['location'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { segments?: unknown }).segments)
  );
}

/** Normalize an array of objects with a required key field + provenance. */
function normalizeProvenancedArray<T extends Record<string, unknown>>(
  raw: unknown,
  keyField: string,
): T[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && typeof item[keyField] === 'string',
    )
    .map((item) => {
      // Ensure provenance exists
      if (!Array.isArray(item.provenance)) {
        item.provenance = [];
      }
      return item as T;
    });
}
