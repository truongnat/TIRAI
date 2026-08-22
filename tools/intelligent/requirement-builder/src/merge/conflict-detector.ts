// ---------------------------------------------------------------------------
// Conflict detector – identifies contradicting requirements
// ---------------------------------------------------------------------------

import type { RequirementCandidate, RequirementConflict, ProvenanceReference, RequirementWarning } from '../models.js';
import { RequirementWarningCode } from '../warnings.js';

let conflictIdCounter = 0;

/**
 * Detect conflicts between candidates based on deterministic signals.
 *
 * Detects:
 * - Contradiction: same topic, opposite constraints (required vs optional)
 * - Inconsistent constraint: same constraint, different values
 * - Ambiguous: overlapping evidence with conflicting statements
 */
export function detectConflicts(
  candidates: RequirementCandidate[],
  aiConflictCandidates: Array<{
    requirementTemporaryIds: string[];
    description: string;
    type: string;
    provenance: ProvenanceReference[];
    confidence: number;
  }>,
): { conflicts: RequirementConflict[]; warnings: RequirementWarning[] } {
  const conflicts: RequirementConflict[] = [];
  const warnings: RequirementWarning[] = [];
  conflictIdCounter = 0;

  // ---- Deterministic conflict detection ----
  // Group candidates by shared semantic evidence
  const evidenceGroups = groupBySharedEvidence(candidates);

  for (const group of evidenceGroups) {
    if (group.length < 2) continue;

    // Check for required vs optional contradictions
    const requiredVsOptional = detectRequiredOptional(group);
    if (requiredVsOptional) {
      conflicts.push({
        id: `CONFLICT-${String(++conflictIdCounter).padStart(4, '0')}`,
        requirementIds: requiredVsOptional.ids,
        description: requiredVsOptional.description,
        type: 'contradiction',
        provenance: unionProvenance(group.filter((c) => requiredVsOptional.ids.includes(c.temporaryId))),
        confidence: 0.8,
      });
      warnings.push({
        code: RequirementWarningCode.CONFLICT_DETECTED,
        message: `Conflict: ${requiredVsOptional.description}`,
      });
    }

    // Check for inconsistent constraints
    const inconsistentConstraints = detectInconsistentConstraints(group);
    for (const ic of inconsistentConstraints) {
      conflicts.push({
        id: `CONFLICT-${String(++conflictIdCounter).padStart(4, '0')}`,
        requirementIds: ic.ids,
        description: ic.description,
        type: 'inconsistent-constraint',
        provenance: unionProvenance(group.filter((c) => ic.ids.includes(c.temporaryId))),
        confidence: 0.7,
      });
      warnings.push({
        code: RequirementWarningCode.CONFLICT_DETECTED,
        message: `Conflict: ${ic.description}`,
      });
    }
  }

  // ---- AI-proposed conflicts ----
  for (const ac of aiConflictCandidates) {
    const validIds = ac.requirementTemporaryIds.filter((id) =>
      candidates.some((c) => c.temporaryId === id),
    );
    if (validIds.length >= 2) {
      conflicts.push({
        id: `CONFLICT-${String(++conflictIdCounter).padStart(4, '0')}`,
        requirementIds: validIds,
        description: ac.description,
        type: normalizeConflictType(ac.type),
        provenance: ac.provenance,
        confidence: ac.confidence,
      });
      warnings.push({
        code: RequirementWarningCode.CONFLICT_DETECTED,
        message: `AI-detected conflict: ${ac.description}`,
      });
    }
  }

  return { conflicts, warnings };
}

// ---- Helpers ----

function groupBySharedEvidence(candidates: RequirementCandidate[]): RequirementCandidate[][] {
  const groups: RequirementCandidate[][] = [];
  const _visited = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    const group = [a];

    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j]!;
      const shared = a.semanticEvidenceIds.filter((id) => b.semanticEvidenceIds.includes(id));
      if (shared.length > 0) {
        group.push(b);
      }
    }

    if (group.length >= 2) {
      groups.push(group);
    }
  }

  return groups;
}

function detectRequiredOptional(
  group: RequirementCandidate[],
): { ids: string[]; description: string } | null {
  const required = group.filter((c) =>
    c.constraints.some((ct) => ct.type === 'required') ||
    c.statement.toLowerCase().includes('required'),
  );
  const optional = group.filter((c) =>
    c.constraints.some((ct) => ct.type === 'optional') ||
    c.statement.toLowerCase().includes('optional'),
  );

  if (required.length > 0 && optional.length > 0) {
    return {
      ids: [...required, ...optional].map((c) => c.temporaryId),
      description: `Required vs optional contradiction: ${required.map((c) => c.temporaryId).join(', ')} vs ${optional.map((c) => c.temporaryId).join(', ')}`,
    };
  }

  return null;
}

function detectInconsistentConstraints(
  group: RequirementCandidate[],
): Array<{ ids: string[]; description: string }> {
  const results: Array<{ ids: string[]; description: string }> = [];

  // Group constraints by type
  const byType = new Map<string, Array<{ candidate: RequirementCandidate; constraint: { type: string; description: string; value?: unknown } }>>();
  for (const c of group) {
    for (const ct of c.constraints) {
      const arr = byType.get(ct.type) ?? [];
      arr.push({ candidate: c, constraint: ct });
      byType.set(ct.type, arr);
    }
  }

  for (const [type, items] of byType) {
    if (items.length < 2) continue;

    // Check for different values for the same constraint type
    const values = new Set(items.map((i) => String(i.constraint.value ?? i.constraint.description)));
    if (values.size > 1) {
      results.push({
        ids: items.map((i) => i.candidate.temporaryId),
        description: `Inconsistent ${type} constraint: ${[...values].join(' vs ')}`,
      });
    }
  }

  return results;
}

function normalizeConflictType(type: string): RequirementConflict['type'] {
  const valid: ReadonlySet<string> = new Set(['contradiction', 'inconsistent-constraint', 'ambiguous', 'potential-overlap']);
  return valid.has(type) ? (type as RequirementConflict['type']) : 'ambiguous';
}

function unionProvenance(candidates: RequirementCandidate[]): ProvenanceReference[] {
  const result: ProvenanceReference[] = [];
  for (const c of candidates) {
    for (const p of c.provenance) {
      if (!result.some((r) => r.contextId === p.contextId && r.sheet === p.sheet)) {
        result.push(p);
      }
    }
  }
  return result;
}
