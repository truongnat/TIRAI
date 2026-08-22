// ---------------------------------------------------------------------------
// Requirement merger – deterministic dedup + provenance/evidence union
// ---------------------------------------------------------------------------

import type { RequirementCandidate, RequirementWarning } from '../models.js';
import { RequirementWarningCode } from '../warnings.js';

/**
 * Find deterministic duplicate candidates based on shared signals.
 *
 * Signals: normalized statement + type + shared semantic evidence + shared provenance.
 */
export function findDuplicateCandidates(
  candidates: RequirementCandidate[],
): Array<{ indices: number[]; reason: string }> {
  const groups: Array<{ indices: number[]; reason: string }> = [];
  const visited = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    if (visited.has(i)) continue;

    const group = [i];
    const a = candidates[i]!;
    const aNorm = normalizeStatement(a.statement);

    for (let j = i + 1; j < candidates.length; j++) {
      if (visited.has(j)) continue;

      const b = candidates[j]!;
      const bNorm = normalizeStatement(b.statement);

      // Exact normalized statement match + same type
      if (aNorm === bNorm && a.type === b.type) {
        group.push(j);
        visited.add(j);
        continue;
      }

      // Shared semantic evidence + same type + similar statement
      const sharedEvidence = a.semanticEvidenceIds.filter((id) => b.semanticEvidenceIds.includes(id));
      if (sharedEvidence.length > 0 && a.type === b.type && isSimilar(aNorm, bNorm)) {
        group.push(j);
        visited.add(j);
      }
    }

    if (group.length >= 2) {
      visited.add(i);
      groups.push({
        indices: group,
        reason: `Same obligation detected across different evidence sources`,
      });
    }
  }

  return groups;
}

/**
 * Merge duplicate candidates into a single candidate with union of
 * provenance, semantic evidence, constraints, etc.
 */
export function applyMerge(
  candidates: RequirementCandidate[],
  groups: Array<{ indices: number[]; reason: string }>,
): { merged: RequirementCandidate[]; warnings: RequirementWarning[] } {
  const warnings: RequirementWarning[] = [];
  const removeIndices = new Set<number>();
  const mergedReplacements: Array<{ index: number; candidate: RequirementCandidate }> = [];

  for (const group of groups) {
    const [primary, ...rest] = group.indices;
    const primaryCandidate = candidates[primary!]!;

    // Union of provenance
    const allProvenance = [...primaryCandidate.provenance];
    for (const idx of rest) {
      const c = candidates[idx]!;
      for (const p of c.provenance) {
        if (!allProvenance.some((existing) => provenanceEqual(existing, p))) {
          allProvenance.push(p);
        }
      }
    }

    // Union of semantic evidence IDs
    const allEvidence = new Set(primaryCandidate.semanticEvidenceIds);
    for (const idx of rest) {
      for (const id of candidates[idx]!.semanticEvidenceIds) {
        allEvidence.add(id);
      }
    }

    // Union of expected behaviors
    const allBehaviors = [...primaryCandidate.expectedBehaviors];
    for (const idx of rest) {
      for (const b of candidates[idx]!.expectedBehaviors) {
        if (!allBehaviors.some((existing) => existing.description === b.description)) {
          allBehaviors.push(b);
        }
      }
    }

    // Union of constraints
    const allConstraints = [...primaryCandidate.constraints];
    for (const idx of rest) {
      for (const c of candidates[idx]!.constraints) {
        if (!allConstraints.some((existing) => existing.type === c.type && existing.description === c.description)) {
          allConstraints.push(c);
        }
      }
    }

    // Max confidence
    const maxConfidence = Math.max(
      primaryCandidate.confidence,
      ...rest.map((idx) => candidates[idx]!.confidence),
    );

    // Build merged candidate
    const merged: RequirementCandidate = {
      ...primaryCandidate,
      provenance: allProvenance,
      semanticEvidenceIds: [...allEvidence],
      expectedBehaviors: allBehaviors,
      constraints: allConstraints,
      confidence: maxConfidence,
      rationale: primaryCandidate.rationale
        ? `${primaryCandidate.rationale}; merged from ${group.indices.length} candidates`
        : `Merged from ${group.indices.length} candidates`,
    };

    mergedReplacements.push({ index: primary!, candidate: merged });
    for (const idx of rest) {
      removeIndices.add(idx);
      warnings.push({
        code: RequirementWarningCode.DUPLICATE_CANDIDATE,
        message: `Merged candidate "${candidates[idx]!.temporaryId}" into "${primaryCandidate.temporaryId}"`,
      });
    }
  }

  // Build result: replace primaries, remove duplicates
  const result: RequirementCandidate[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (removeIndices.has(i)) continue;
    const replacement = mergedReplacements.find((r) => r.index === i);
    result.push(replacement ? replacement.candidate : candidates[i]!);
  }

  return { merged: result, warnings };
}

// ---- Helpers ----

function normalizeStatement(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Simple similarity check: Jaccard similarity on word sets > 0.6.
 */
function isSimilar(a: string, b: string): boolean {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union > 0.6;
}

function provenanceEqual(
  a: { contextId: string; sheet?: string; cells?: string[] },
  b: { contextId: string; sheet?: string; cells?: string[] },
): boolean {
  if (a.contextId !== b.contextId) return false;
  if ((a.sheet ?? '') !== (b.sheet ?? '')) return false;
  const aCells = (a.cells ?? []).sort().join(',');
  const bCells = (b.cells ?? []).sort().join(',');
  return aCells === bCells;
}
