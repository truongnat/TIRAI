// ---------------------------------------------------------------------------
// Semantic reference validator – checks relatedSemanticIds exist
// ---------------------------------------------------------------------------

import type { RequirementWarning } from '../models.js';
import { RequirementWarningCode } from '../warnings.js';

/**
 * Validate that all semantic IDs referenced by a requirement actually exist
 * in the source Semantic IR.
 *
 * Returns warnings for dangling references.
 */
export function validateSemanticReferences(
  semanticIds: string[],
  validIds: Set<string>,
  requirementId: string,
): RequirementWarning[] {
  const warnings: RequirementWarning[] = [];

  for (const id of semanticIds) {
    if (!validIds.has(id)) {
      warnings.push({
        code: RequirementWarningCode.DANGLING_SEMANTIC_REF,
        message: `${requirementId}: dangling semantic reference "${id}"`,
        requirementId,
      });
    }
  }

  return warnings;
}

/**
 * Build the set of all valid semantic object IDs from a Semantic IR.
 */
export function buildValidSemanticIds(ir: {
  entities: Array<{ id: string }>;
  flows: Array<{ id: string }>;
  rules: Array<{ id: string }>;
  relationships: Array<{ id: string }>;
  sections: Array<{ id: string }>;
  unresolved: Array<{ id: string }>;
}): Set<string> {
  const ids = new Set<string>();

  for (const e of ir.entities) ids.add(e.id);
  for (const f of ir.flows) ids.add(f.id);
  for (const r of ir.rules) ids.add(r.id);
  for (const rel of ir.relationships) ids.add(rel.id);
  for (const s of ir.sections) ids.add(s.id);
  for (const u of ir.unresolved) ids.add(u.id);

  return ids;
}
