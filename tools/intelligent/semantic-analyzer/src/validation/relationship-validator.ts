// ---------------------------------------------------------------------------
// Relationship validator – checks for dangling references
// ---------------------------------------------------------------------------

import type { SemanticRelationship, SemanticWarning } from '../models.js';
import { SemanticWarningCode } from '../warnings.js';

/**
 * Validate that all relationship source/target IDs exist in the entity set.
 *
 * Returns warnings for any dangling references.
 */
export function validateRelationships(
  relationships: SemanticRelationship[],
  validEntityIds: Set<string>,
  validSectionIds: Set<string>,
  validFlowIds: Set<string>,
): SemanticWarning[] {
  const validIds = new Set([...validEntityIds, ...validSectionIds, ...validFlowIds]);
  const warnings: SemanticWarning[] = [];

  for (const rel of relationships) {
    if (!validIds.has(rel.sourceId)) {
      warnings.push({
        code: SemanticWarningCode.RELATIONSHIP_UNRESOLVED,
        message: `Relationship "${rel.id}" source "${rel.sourceId}" does not exist`,
        objectId: rel.id,
      });
    }
    if (!validIds.has(rel.targetId)) {
      warnings.push({
        code: SemanticWarningCode.RELATIONSHIP_UNRESOLVED,
        message: `Relationship "${rel.id}" target "${rel.targetId}" does not exist`,
        objectId: rel.id,
      });
    }
  }

  return warnings;
}
