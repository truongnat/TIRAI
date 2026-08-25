// ---------------------------------------------------------------------------
// Requirement Builder – main orchestrator
// ---------------------------------------------------------------------------
// Pipeline:
//   1. Load Semantic IR
//   2. Build evidence batches
//   3. Extract requirement candidates (per-batch AI calls)
//   4. Consolidate (AI-assisted dedup + conflict detection)
//   5. Deterministic merge
//   6. Conflict detection
//   7. Convert candidates → final requirements
//   8. Assign deterministic IDs
//   9. Final validation
//  10. Compute quality metrics
//  11. Write output

import type { AIProvider } from 'ai-provider';
import type {
  RequirementIR,
  Requirement,
  RequirementUnresolved,
  RequirementConflict,
  RequirementCandidate,
  RequirementWarning,
  RequirementManifest,
  RequirementBuilderOptions,
  CandidateExtractionResult,
  RequirementConsolidationResult,
  ProvenanceReference,
  RequirementType,
  RequirementSourceNature,
  RequirementTestability,
} from './models.js';
import { RequirementWarningCode } from './warnings.js';
import { loadSemanticIR, loadSemanticIRContent } from './persistence/loader.js';
import { buildEvidenceBatches } from './analysis/evidence-grouper.js';
import type { EvidenceBatch } from './prompts/extraction.js';
import { extractCandidates } from './analysis/candidate-extractor.js';
import { consolidate } from './analysis/consolidator.js';
import { orderCandidates } from './merge/deterministic-order.js';
import { findDuplicateCandidates, applyMerge } from './merge/requirement-merger.js';
import { detectConflicts } from './merge/conflict-detector.js';
import { validateRequirement } from './validation/requirement-validator.js';
import {
  validateProvenanceArray,
  buildValidContextIdsFromIR,
} from './validation/provenance-validator.js';
import {
  validateSemanticReferences,
  buildValidSemanticIds,
} from './validation/semantic-reference-validator.js';
import { computeQualityMetrics } from './quality/metrics.js';
import { writeOutput, writeAnalysis } from './persistence/writer.js';
import { REQUIREMENT_PROMPT_VERSION } from './prompts/system.js';

/**
 * Build requirements from a Semantic IR.
 *
 * @param inputDir Directory containing semantic-ir.json
 * @param provider AI provider to use
 * @param options Optional configuration
 * @returns The Requirement IR
 */
export async function buildRequirements(
  inputDir: string,
  provider: AIProvider,
  options?: RequirementBuilderOptions,
): Promise<RequirementIR> {
  const promptVersion = options?.promptVersion ?? REQUIREMENT_PROMPT_VERSION;
  const maxRepairAttempts = options?.maxRepairAttempts ?? 1;
  const outputDir = options?.outputDir;

  // ---- Load Semantic IR ---------------------------------------------------
  const semanticIR = loadSemanticIR(inputDir);
  const _semanticContent = loadSemanticIRContent(inputDir);

  const allWarnings: RequirementWarning[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let aiRequests = 0;

  // ---- Build evidence batches ---------------------------------------------
  const batches = buildEvidenceBatches(semanticIR);

  // ---- Pass 1: Candidate extraction ---------------------------------------
  const allCandidates: RequirementCandidate[] = [];
  const allUnresolvedRaw: Array<{
    temporaryId: string;
    description: string;
    reason: string;
    semanticEvidenceIds: string[];
    provenance: ProvenanceReference[];
    candidates?: string[];
  }> = [];
  const allConflictRaw: Array<{
    requirementTemporaryIds: string[];
    description: string;
    type: string;
    provenance: ProvenanceReference[];
    confidence: number;
  }> = [];
  const extractionResults: CandidateExtractionResult[] = [];

  for (const batch of batches) {
    const {
      result,
      usage,
      warnings: extractionWarnings,
    } = await extractCandidates(batch, provider, maxRepairAttempts);

    aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;

    if (extractionWarnings) allWarnings.push(...extractionWarnings);
    extractionResults.push(result);

    // Build provenance lookup from batch context
    const batchProvenance = buildBatchProvenanceLookup(batch);
    // Collect all valid semantic IDs from the batch
    const validBatchIds = buildValidBatchIds(batch);

    // Convert raw candidates to RequirementCandidate
    for (const c of result.candidates) {
      // Sanitize evidence IDs (fix AI hallucinated prefixes)
      const sanitizedEvidenceIds = sanitizeEvidenceIds(c.semanticEvidenceIds, validBatchIds);

      // Backfill provenance from batch context when AI returns empty or unknown
      let provenance = c.provenance;
      if (
        provenance.length === 0 ||
        (provenance.length === 1 && provenance[0]!.contextId === 'unknown')
      ) {
        provenance = inferProvenanceFromEvidence(sanitizedEvidenceIds, batchProvenance);
      }
      // If still unknown, fall back to batch-level provenance
      if (provenance.length === 1 && provenance[0]!.contextId === 'unknown') {
        const batchProv = getBatchFallbackProvenance(batch);
        if (batchProv.length > 0) provenance = batchProv;
      }

      allCandidates.push({
        temporaryId: c.temporaryId,
        title: c.title,
        type: c.type as RequirementType,
        statement: c.statement,
        sourceNature: c.sourceNature as RequirementSourceNature,
        semanticEvidenceIds: sanitizedEvidenceIds,
        actor: c.actor,
        trigger: c.trigger,
        preconditions: c.preconditions.map((p) => ({
          description: p.description,
          relatedSemanticIds: p.relatedSemanticIds,
          provenance: p.provenance ?? [],
        })),
        dataNeeds: c.dataNeeds ?? [],
        inputs: c.inputs.map((i) => ({
          name: i.name,
          description: i.description,
          dataType: i.dataType,
          required: i.required,
          constraints: i.constraints,
          relatedSemanticId: i.relatedSemanticId,
          provenance: i.provenance ?? [],
        })),
        expectedBehaviors: c.expectedBehaviors.map((b) => ({
          description: b.description,
          condition: b.condition,
          target: b.target,
          provenance: b.provenance ?? [],
        })),
        outcomes: c.outcomes.map((o) => ({
          condition: o.condition,
          description: o.description,
          state: o.state,
          provenance: o.provenance ?? [],
        })),
        constraints: c.constraints.map((ct) => ({
          type: ct.type,
          description: ct.description,
          value: ct.value,
          provenance: ct.provenance ?? [],
        })),
        provenance,
        confidence: c.confidence,
        rationale: c.rationale,
      });
    }

    // Collect unresolved + conflict candidates
    for (const u of result.unresolvedCandidates) {
      allUnresolvedRaw.push(u);
    }
    for (const cf of result.conflictCandidates) {
      allConflictRaw.push(cf);
    }
  }

  // ---- Pass 2: Consolidation (AI-assisted dedup + conflict) ---------------
  let consolidationResult: RequirementConsolidationResult = {
    duplicateGroups: [],
    additionalConflicts: [],
  };

  if (allCandidates.length >= 2) {
    try {
      const cons = await consolidate(allCandidates, provider);
      aiRequests++;
      totalInputTokens += cons.usage.inputTokens ?? 0;
      totalOutputTokens += cons.usage.outputTokens ?? 0;
      consolidationResult = cons.result;
      if (cons.warnings) allWarnings.push(...cons.warnings);
    } catch (err) {
      allWarnings.push({
        code: RequirementWarningCode.PARTIAL_EXTRACTION,
        message: `Consolidation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ---- Deterministic merge ------------------------------------------------
  // Apply AI-proposed duplicate groups as additional merge signals
  const aiMergeGroups = consolidationResult.duplicateGroups
    .filter((g) => g.sourceTemporaryIds.length >= 2)
    .map((g) => {
      const indices = g.sourceTemporaryIds
        .map((tid) => allCandidates.findIndex((c) => c.temporaryId === tid))
        .filter((idx) => idx >= 0);
      return { indices, reason: g.reason };
    })
    .filter((g) => g.indices.length >= 2);

  // Also run deterministic duplicate detection
  const deterministicGroups = findDuplicateCandidates(allCandidates);

  // Combine merge groups (avoid duplicating the same indices)
  const allMergeGroups = [...deterministicGroups];
  for (const aiGroup of aiMergeGroups) {
    const aiSet = new Set(aiGroup.indices);
    const alreadyCovered = allMergeGroups.some(
      (existing) =>
        existing.indices.length === aiGroup.indices.length &&
        existing.indices.every((idx) => aiSet.has(idx)),
    );
    if (!alreadyCovered) {
      allMergeGroups.push(aiGroup);
    }
  }

  const { merged: dedupedCandidates, warnings: mergeWarnings } = applyMerge(
    allCandidates,
    allMergeGroups,
  );
  allWarnings.push(...mergeWarnings);

  // ---- Conflict detection -------------------------------------------------
  const { conflicts: detectedConflicts, warnings: conflictWarnings } = detectConflicts(
    dedupedCandidates,
    [...allConflictRaw, ...consolidationResult.additionalConflicts],
  );
  allWarnings.push(...conflictWarnings);

  // ---- Deterministic ordering + ID assignment -----------------------------
  const orderedCandidates = orderCandidates(dedupedCandidates);

  // Convert candidates to final requirements with deterministic IDs
  const finalRequirements: Requirement[] = orderedCandidates.map((c, i) => {
    const id = `REQ-${String(i + 1).padStart(4, '0')}`;

    // Assess testability using structured fields + statement analysis
    const testability: RequirementTestability = assessTestability(c);

    // Infer type when AI returned 'unknown'
    const type: RequirementType =
      c.type === 'unknown' ? inferRequirementType(c.statement, c.semanticEvidenceIds) : c.type;

    return {
      id,
      title: c.title,
      type,
      statement: c.statement,
      sourceNature: c.sourceNature,
      actor: c.actor,
      trigger: c.trigger,
      preconditions: c.preconditions,
      inputs: c.inputs,
      dataNeeds: c.dataNeeds ?? [],
      expectedBehaviors: c.expectedBehaviors,
      outcomes: c.outcomes,
      constraints: c.constraints,
      relatedSemanticIds: c.semanticEvidenceIds,
      provenance: c.provenance,
      confidence: c.confidence,
      testability,
    };
  });

  // ---- Build unresolved ---------------------------------------------------
  const validSemanticIds = buildValidSemanticIds(semanticIR);

  const finalUnresolved: RequirementUnresolved[] = allUnresolvedRaw.map((u, i) => ({
    id: `UNRESOLVED-${String(i + 1).padStart(4, '0')}`,
    description: u.description,
    reason: u.reason,
    semanticEvidenceIds: u.semanticEvidenceIds.filter((id) => validSemanticIds.has(id)),
    provenance: u.provenance,
    candidates: u.candidates,
  }));

  // Also include Semantic IR unresolved items that weren't resolved
  for (const su of semanticIR.unresolved) {
    if (!finalUnresolved.some((u) => u.description === su.description)) {
      finalUnresolved.push({
        id: `UNRESOLVED-${String(finalUnresolved.length + 1).padStart(4, '0')}`,
        description: su.description,
        reason: su.reason,
        semanticEvidenceIds: [],
        provenance: su.provenance,
        candidates: su.candidates,
      });
    }
  }

  // ---- Assign conflict IDs ------------------------------------------------
  const finalConflicts: RequirementConflict[] = detectedConflicts
    .map((c, i) => ({
      ...c,
      id: `CONFLICT-${String(i + 1).padStart(4, '0')}`,
      // Remap temporary IDs to final requirement IDs
      requirementIds: c.requirementIds
        .map((tid) => {
          const idx = orderedCandidates.findIndex((cand) => cand.temporaryId === tid);
          return idx >= 0 ? finalRequirements[idx]!.id : null;
        })
        .filter((id): id is string => id !== null),
    }))
    .filter((c) => c.requirementIds.length >= 2);

  // ---- Final validation ---------------------------------------------------
  const validContextIds = buildValidContextIdsFromIR(semanticIR);

  for (const req of finalRequirements) {
    // Validate provenance
    allWarnings.push(...validateProvenanceArray(req.provenance, validContextIds, req.id));

    // Validate semantic references
    allWarnings.push(
      ...validateSemanticReferences(req.relatedSemanticIds, validSemanticIds, req.id),
    );

    // Structural validation
    allWarnings.push(...validateRequirement(req, validSemanticIds));
  }

  // ---- Quality metrics ----------------------------------------------------
  const quality = computeQualityMetrics(finalRequirements, finalUnresolved, finalConflicts);

  // ---- Build document model -----------------------------------------------
  const document = {
    title: semanticIR.document.title,
    summary: semanticIR.document.summary,
    sourceSemanticIR: inputDir,
    provenance: semanticIR.document.provenance,
  };

  // ---- Assemble final IR --------------------------------------------------
  const requirementIR: RequirementIR = {
    schemaVersion: '1.0',
    document,
    requirements: finalRequirements,
    unresolved: finalUnresolved,
    conflicts: finalConflicts,
    quality,
  };

  // ---- Write output -------------------------------------------------------
  if (outputDir) {
    const manifest: RequirementManifest = {
      schemaVersion: '1.0',
      source: { semanticIR: inputDir },
      provider: { name: provider.name, model: '' },
      promptVersion,
      stats: {
        requirements: finalRequirements.length,
        explicit: quality.explicit,
        derived: quality.derived,
        unresolved: finalUnresolved.length,
        conflicts: finalConflicts.length,
      },
      usage: {
        requests: aiRequests,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
      warnings: allWarnings,
    };

    writeOutput(outputDir, requirementIR, manifest);
    writeAnalysis(outputDir, allCandidates, extractionResults, consolidationResult);
  }

  return requirementIR;
}

// ---- Helpers --------------------------------------------------------------

/**
 * Assess testability of a requirement candidate.
 *
 * Heuristic: analyze expected behaviors, constraints, outcomes,
 * AND the statement text for measurable criteria.
 */
function assessTestability(candidate: RequirementCandidate): RequirementTestability {
  // Has expected behaviors with concrete descriptions
  if (candidate.expectedBehaviors.length > 0) {
    const hasMeasurable = candidate.expectedBehaviors.some((b) =>
      hasMeasurableCriteria(b.description),
    );

    if (hasMeasurable) {
      return { status: 'testable', reasons: ['Has measurable expected behaviors'] };
    }

    return {
      status: 'partially-testable',
      reasons: ['Has expected behaviors but measurability is unclear'],
    };
  }

  // Has constraints that can be checked
  if (candidate.constraints.length > 0) {
    return {
      status: 'partially-testable',
      reasons: ['Has constraints but no explicit expected behaviors'],
    };
  }

  // Has outcomes
  if (candidate.outcomes.length > 0) {
    return {
      status: 'partially-testable',
      reasons: ['Has outcomes but no explicit behaviors to test'],
    };
  }

  // Fall back to statement analysis
  if (hasMeasurableCriteria(candidate.statement)) {
    return {
      status: 'testable',
      reasons: ['Statement contains measurable criteria'],
    };
  }

  // Check if statement has any verifiable obligation keywords
  if (hasObligationKeywords(candidate.statement)) {
    return {
      status: 'partially-testable',
      reasons: ['Statement has obligation keywords but measurable criteria unclear'],
    };
  }

  return {
    status: 'unknown',
    reasons: ['No expected behaviors, constraints, or outcomes specified'],
  };
}

/**
 * Check if a behavior description has measurable criteria.
 *
 * Heuristic: contains numbers, comparisons, specific values, or
 * action verbs with clear pass/fail conditions.
 */
function hasMeasurableCriteria(description: string): boolean {
  const lower = description.toLowerCase();

  // Contains numeric values
  if (/\d+/.test(lower)) return true;

  // Contains measurable keywords
  const measurableKeywords = [
    'must be',
    'shall be',
    'required',
    'valid',
    'invalid',
    'equal',
    'greater',
    'less',
    'between',
    'within',
    'accept',
    'reject',
    'success',
    'fail',
    'error',
    'display',
    'show',
    'hide',
    'enable',
    'disable',
    'navigate',
    'redirect',
    'return',
    'respond',
    'at least',
    'at most',
    'no more than',
    'no less than',
    'expire',
    'lock',
    'block',
    'deny',
    'allow',
    'single-use',
    'unique',
    'hash',
    'encrypt',
    'send',
    'email',
    'generate',
    'invalidate',
    'activate',
    'verify',
    'validate',
    'check',
  ];

  return measurableKeywords.some((kw) => lower.includes(kw));
}

/**
 * Check if a statement contains obligation keywords indicating a testable requirement.
 */
function hasObligationKeywords(statement: string): boolean {
  const lower = statement.toLowerCase();
  const obligationKeywords = [
    'shall',
    'must',
    'should',
    'will',
    'required',
    'ensure',
    'verify',
    'validate',
    'prevent',
    'restrict',
    'limit',
  ];
  return obligationKeywords.some((kw) => lower.includes(kw));
}

/**
 * Infer requirement type from statement content when AI returns 'unknown'.
 */
function inferRequirementType(statement: string, _evidenceIds: string[]): RequirementType {
  const lower = statement.toLowerCase();

  // Security indicators
  if (/hash|encrypt|https|ssl|tls|token|auth|password|secret|secure|bcrypt/.test(lower)) {
    return 'security';
  }

  // Validation indicators
  if (/valid|format|must be (between|at least|at most)|required field|mandatory/.test(lower)) {
    return 'validation';
  }

  // State transition indicators
  if (/change.*state|transition|status.*from.*to|activate|deactivate|enable|disable/.test(lower)) {
    return 'state-transition';
  }

  // Data indicators
  if (/store|save|persist|database|schema|field.*type|data.*format/.test(lower)) {
    return 'data';
  }

  // Interface indicators
  if (/api|endpoint|request|response|http|rest|message.*format/.test(lower)) {
    return 'interface';
  }

  // Business rule indicators
  if (/business|policy|rule|role|permission|access|redirect|lock|expire/.test(lower)) {
    return 'business-rule';
  }

  // Functional (default for system actions)
  if (/shall|must|system|accept|submit|send|generate|create|update|delete/.test(lower)) {
    return 'functional';
  }

  return 'unknown';
}

/**
 * Build a lookup map from semantic object IDs to their provenance.
 */
function buildBatchProvenanceLookup(batch: EvidenceBatch): Map<string, ProvenanceReference[]> {
  const lookup = new Map<string, ProvenanceReference[]>();

  for (const f of batch.flows) {
    lookup.set(f.id, f.provenance);
  }
  for (const r of batch.rules) {
    lookup.set(r.id, r.provenance);
  }
  for (const e of batch.entities) {
    lookup.set(e.id, e.provenance);
  }
  for (const s of batch.sections) {
    lookup.set(s.id, s.provenance);
  }

  return lookup;
}

/**
 * Infer provenance from semantic evidence IDs using batch context.
 */
function inferProvenanceFromEvidence(
  evidenceIds: string[],
  batchLookup: Map<string, ProvenanceReference[]>,
): ProvenanceReference[] {
  const seen = new Set<string>();
  const result: ProvenanceReference[] = [];

  for (const id of evidenceIds) {
    const prov = batchLookup.get(id);
    if (prov) {
      for (const p of prov) {
        if (!seen.has(p.contextId)) {
          seen.add(p.contextId);
          result.push(p);
        }
      }
    }
  }

  return result.length > 0 ? result : [{ contextId: 'unknown' }];
}

/**
 * Build a set of all valid semantic object IDs in a batch.
 */
function buildValidBatchIds(batch: EvidenceBatch): Set<string> {
  const ids = new Set<string>();
  for (const f of batch.flows) ids.add(f.id);
  for (const r of batch.rules) ids.add(r.id);
  for (const e of batch.entities) ids.add(e.id);
  for (const s of batch.sections) ids.add(s.id);
  for (const rel of batch.relationships) ids.add(rel.id);
  return ids;
}

/**
 * Sanitize evidence IDs by attempting to fix common AI hallucinations.
 *
 * If an ID doesn't exist in the valid set, try stripping common prefixes
 * the AI may have doubled (e.g. "flow-flow-0003" → "flow-0003").
 */
function sanitizeEvidenceIds(evidenceIds: string[], validIds: Set<string>): string[] {
  return evidenceIds.map((id) => {
    if (validIds.has(id)) return id;

    // Try stripping doubled prefixes
    const prefixes = ['flow-', 'rule-', 'ent-', 'sec-', 'rel-'];
    for (const prefix of prefixes) {
      if (id.startsWith(prefix + prefix)) {
        const fixed = id.slice(prefix.length);
        if (validIds.has(fixed)) return fixed;
      }
    }

    return id; // Return original if no fix found
  });
}

/**
 * Get fallback provenance from the first available batch object.
 */
function getBatchFallbackProvenance(batch: EvidenceBatch): ProvenanceReference[] {
  // Try flows first, then rules, then sections
  const sources = [
    batch.flows.flatMap((f) => f.provenance),
    batch.rules.flatMap((r) => r.provenance),
    batch.sections.flatMap((s) => s.provenance),
  ];

  for (const provs of sources) {
    if (provs.length > 0) return provs;
  }

  return [];
}
