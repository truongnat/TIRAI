// ---------------------------------------------------------------------------
// Deterministic ordering – sort functions for stable output
// ---------------------------------------------------------------------------

import type { RequirementCandidate, Requirement } from '../models.js';

/**
 * Sort candidates deterministically for stable ID assignment.
 *
 * Order: first provenance contextId → type → normalized statement.
 */
export function orderCandidates(candidates: RequirementCandidate[]): RequirementCandidate[] {
  return [...candidates].sort((a, b) => {
    // First provenance location
    const aProv = firstProvenanceKey(a.provenance);
    const bProv = firstProvenanceKey(b.provenance);
    if (aProv !== bProv) return aProv.localeCompare(bProv);

    // Type
    if (a.type !== b.type) return a.type.localeCompare(b.type);

    // Normalized statement
    return normalizeStatement(a.statement).localeCompare(normalizeStatement(b.statement));
  });
}

/**
 * Sort final requirements deterministically.
 */
export function orderRequirements(requirements: Requirement[]): Requirement[] {
  return [...requirements].sort((a, b) => {
    const aProv = firstProvenanceKey(a.provenance);
    const bProv = firstProvenanceKey(b.provenance);
    if (aProv !== bProv) return aProv.localeCompare(bProv);

    if (a.type !== b.type) return a.type.localeCompare(b.type);

    return normalizeStatement(a.statement).localeCompare(normalizeStatement(b.statement));
  });
}

/**
 * Create a deterministic sort key from the first provenance entry.
 */
function firstProvenanceKey(provenance: Array<{ contextId: string; sheet?: string; cells?: string[] }>): string {
  if (provenance.length === 0) return '';
  const p = provenance[0]!;
  const cells = p.cells?.length ? p.cells.join(',') : '';
  return `${p.contextId}|${p.sheet ?? ''}|${cells}`;
}

/**
 * Normalize a statement for comparison: lowercase, trim, collapse whitespace.
 */
function normalizeStatement(statement: string): string {
  return statement.toLowerCase().trim().replace(/\s+/g, ' ');
}
