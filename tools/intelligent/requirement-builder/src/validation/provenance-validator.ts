// ---------------------------------------------------------------------------
// Provenance validator – checks provenance references against valid contexts
// ---------------------------------------------------------------------------

import type { ProvenanceReference, RequirementWarning } from '../models.js';
import { RequirementWarningCode } from '../warnings.js';

/**
 * Validate a provenance array against known valid context IDs.
 *
 * Returns warnings for any invalid references.
 */
export function validateProvenanceArray(
  provenance: ProvenanceReference[],
  validContextIds: Set<string>,
  objectId: string,
): RequirementWarning[] {
  const warnings: RequirementWarning[] = [];

  for (const p of provenance) {
    if (!p.contextId || !validContextIds.has(p.contextId)) {
      warnings.push({
        code: RequirementWarningCode.INVALID_PROVENANCE,
        message: `${objectId}: invalid provenance contextId "${p.contextId}"`,
        requirementId: objectId,
        contextId: p.contextId,
      });
    }
  }

  return warnings;
}

/**
 * Build the set of valid context IDs from a Semantic IR's provenance.
 *
 * Context IDs come from the document provenance and all object provenance.
 */
export function buildValidContextIdsFromIR(ir: {
  document: { provenance: ProvenanceReference[] };
  entities: Array<{ provenance: ProvenanceReference[] }>;
  flows: Array<{ provenance: ProvenanceReference[]; steps: Array<{ provenance: ProvenanceReference[] }> }>;
  rules: Array<{ provenance: ProvenanceReference[] }>;
  relationships: Array<{ provenance: ProvenanceReference[] }>;
  sections: Array<{ provenance: ProvenanceReference[] }>;
  unresolved: Array<{ provenance: ProvenanceReference[] }>;
}): Set<string> {
  const ids = new Set<string>();

  const collect = (provenance: ProvenanceReference[]): void => {
    for (const p of provenance) {
      if (p.contextId) ids.add(p.contextId);
    }
  };

  collect(ir.document.provenance);
  for (const e of ir.entities) collect(e.provenance);
  for (const f of ir.flows) {
    collect(f.provenance);
    for (const s of f.steps) collect(s.provenance);
  }
  for (const r of ir.rules) collect(r.provenance);
  for (const rel of ir.relationships) collect(rel.provenance);
  for (const s of ir.sections) collect(s.provenance);
  for (const u of ir.unresolved) collect(u.provenance);

  return ids;
}
