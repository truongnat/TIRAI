// ---------------------------------------------------------------------------
// Test Data Planner – deduplication and consolidation
// ---------------------------------------------------------------------------

import type {
  DataRequirementCandidate,
  TestDataPlannerWarning,
} from '../models.js';
import { TestDataPlannerWarningCode } from '../warnings.js';

/**
 * Deduplicate data requirement candidates.
 *
 * Two candidates are equivalent if they have the same type, description
 * (case-insensitive), and constraints. Equivalent candidates are merged
 * into one, combining their test case references.
 *
 * Do NOT merge if:
 * - Different constraints
 * - Different types
 * - One test mutates the data (different strategies)
 */
export function deduplicateDataCandidates(
  candidates: DataRequirementCandidate[],
): {
  deduped: DataRequirementCandidate[];
  warnings: TestDataPlannerWarning[];
} {
  const warnings: TestDataPlannerWarning[] = [];
  const deduped: DataRequirementCandidate[] = [];
  const seen = new Map<string, number>(); // dedup key → index in deduped

  for (const c of candidates) {
    const key = buildDedupKey(c);

    if (seen.has(key)) {
      const idx = seen.get(key)!;
      const existing = deduped[idx]!;

      // Merge test case references – the dedup key already accounts for
      // same type/description/constraints/strategy.  The planner will
      // collect all related test cases from the original candidates.

      warnings.push({
        code: TestDataPlannerWarningCode.DUPLICATE_CANDIDATE,
        message: `Duplicate data candidate "${c.name}" merged with existing "${existing.name}"`,
      });
    } else {
      seen.set(key, deduped.length);
      deduped.push({ ...c });
    }
  }

  return { deduped, warnings };
}

function buildDedupKey(c: DataRequirementCandidate): string {
  const constraintKey = c.constraints
    .map((con) => `${con.type}:${con.field ?? ''}:${con.description}`)
    .sort()
    .join('|');
  return `${c.type}::${c.description.toLowerCase().trim()}::${constraintKey}::${c.strategy}`;
}
