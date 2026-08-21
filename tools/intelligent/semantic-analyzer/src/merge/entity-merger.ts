// ---------------------------------------------------------------------------
// Entity merger – deduplication based on deterministic signals
// ---------------------------------------------------------------------------

import type { ChunkEntity, SemanticWarning } from '../models.js';
import { SemanticWarningCode } from '../warnings.js';

/**
 * Normalize a name for comparison: lowercase, trim, collapse whitespace.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Find duplicate entity candidates using deterministic signals:
 * - Normalized name match
 * - Type match
 * - Alias overlap
 *
 * Returns merge groups: arrays of entity indices that should be merged.
 */
export function findDuplicateCandidates(
  entities: Array<{ entity: ChunkEntity; contextId: string }>,
): number[][] {
  const groups = new Map<string, number[]>();

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]!;
    const key = `${normalizeName(e.entity.name)}|${e.entity.type}`;

    const existing = groups.get(key);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(key, [i]);
    }

    // Also check aliases
    if (e.entity.aliases) {
      for (const alias of e.entity.aliases) {
        const aliasKey = `${normalizeName(alias)}|${e.entity.type}`;
        if (aliasKey !== key) {
          const aliasGroup = groups.get(aliasKey);
          if (aliasGroup && !aliasGroup.includes(i)) {
            aliasGroup.push(i);
          } else if (!aliasGroup) {
            // Don't create alias-only groups; they'll match when the main entity is processed
          }
        }
      }
    }
  }

  // Only return groups with more than one member
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Apply merge: combine duplicate entities into one, merging provenance.
 *
 * Returns the merged entities and any warnings generated.
 */
export function applyEntityMerge(
  entities: Array<{ entity: ChunkEntity; contextId: string }>,
  mergeGroups: number[][],
): { merged: Array<{ entity: ChunkEntity; contextId: string }>; warnings: SemanticWarning[] } {
  const warnings: SemanticWarning[] = [];
  const mergedIndices = new Set<number>();
  const mergedEntities: Array<{ entity: ChunkEntity; contextId: string }> = [];

  for (const group of mergeGroups) {
    // Keep the first entity as the canonical one
    const canonical = entities[group[0]!]!;
    const merged = { ...canonical.entity };

    // Merge provenance from all duplicates
    const allProvenance = [...merged.provenance];
    for (let i = 1; i < group.length; i++) {
      const dup = entities[group[i]!]!;
      allProvenance.push(...dup.entity.provenance);

      // Merge aliases
      if (dup.entity.aliases) {
        merged.aliases = [...(merged.aliases ?? []), dup.entity.name, ...dup.entity.aliases];
      } else {
        merged.aliases = [...(merged.aliases ?? []), dup.entity.name];
      }

      mergedIndices.add(group[i]!);
      warnings.push({
        code: SemanticWarningCode.DUPLICATE_CANDIDATE,
        message: `Merged "${dup.entity.name}" into "${canonical.entity.name}" (same name+type)`,
        contextId: dup.contextId,
        objectId: dup.entity.localId,
      });
    }

    // Deduplicate provenance
    merged.provenance = deduplicateProvenance(allProvenance);
    // Deduplicate aliases
    if (merged.aliases) {
      merged.aliases = [...new Set(merged.aliases.map(normalizeName))];
    }

    mergedEntities.push({ entity: merged, contextId: canonical.contextId });
  }

  // Add non-merged entities
  for (let i = 0; i < entities.length; i++) {
    if (!mergedIndices.has(i) && !mergeGroups.some((g) => g[0] === i)) {
      mergedEntities.push(entities[i]!);
    }
  }

  return { merged: mergedEntities, warnings };
}

function deduplicateProvenance(
  provs: Array<{ contextId: string; sheet?: string; ranges?: string[]; cells?: string[] }>,
): Array<{ contextId: string; sheet?: string; ranges?: string[]; cells?: string[] }> {
  const seen = new Set<string>();
  const result: Array<{ contextId: string; sheet?: string; ranges?: string[]; cells?: string[] }> = [];

  for (const p of provs) {
    const key = `${p.contextId}|${p.sheet ?? ''}|${(p.ranges ?? []).join(',')}|${(p.cells ?? []).join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }

  return result;
}
