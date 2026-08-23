// ---------------------------------------------------------------------------
// Provenance inheritance — deterministic traceability from Test Case IR
// ---------------------------------------------------------------------------
// Provenance is inherited from validated Test Case references because source
// traceability is deterministic and should not depend on model reproduction.
//
// Chain:
//   Data Item → relatedTestCaseIds → load TC provenance → union → dedup
//
// Priority:
//   1. Test Case provenance (primary)
//   2. Existing AI-provided provenance (union, not replacement)
//
// Never:
//   - fake context IDs
//   - fake sheet names
//   - fake cell coordinates
// ---------------------------------------------------------------------------

import type { TestDataItem, TestProvenance, TestCaseIRInput } from '../models.js';

/**
 * Build a provenance lookup from Test Case IR.
 * Maps TC ID → its provenance array.
 */
export function buildTestCaseProvenanceMap(
  testCases: TestCaseIRInput['testCases'],
): Map<string, TestProvenance[]> {
  const map = new Map<string, TestProvenance[]>();
  for (const tc of testCases) {
    if (Array.isArray(tc.provenance) && tc.provenance.length > 0) {
      map.set(tc.id, tc.provenance.map((p) => ({
        requirementId: p.requirementId,
        contextId: p.contextId,
        sheet: p.sheet,
        ranges: p.ranges,
      })));
    }
  }
  return map;
}

/**
 * Inherit provenance for a data item from its related test cases.
 * Returns a new provenance array: union of existing AI provenance + inherited.
 * Results are deduplicated and deterministically ordered.
 */
export function inheritProvenance(
  existingProvenance: TestProvenance[],
  relatedTestCaseIds: string[],
  tcProvenanceMap: Map<string, TestProvenance[]>,
): TestProvenance[] {
  const seen = new Set<string>();
  const result: TestProvenance[] = [];

  // Add existing AI-provided provenance first (preserved if valid)
  for (const p of existingProvenance) {
    const key = provenanceKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...p });
    }
  }

  // Inherit from related test cases
  for (const tcId of relatedTestCaseIds) {
    const tcProv = tcProvenanceMap.get(tcId);
    if (!tcProv) continue;
    for (const p of tcProv) {
      const key = provenanceKey(p);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ ...p });
      }
    }
  }

  // Stable ordering: sort by requirementId for determinism
  result.sort((a, b) => a.requirementId.localeCompare(b.requirementId));

  return result;
}

/**
 * Apply provenance inheritance to all data items in-place.
 * Returns the count of data items that gained provenance.
 */
export function applyProvenanceInheritance(
  dataItems: TestDataItem[],
  testCases: TestCaseIRInput['testCases'],
): number {
  const tcProvenanceMap = buildTestCaseProvenanceMap(testCases);
  let gainedCount = 0;

  for (const item of dataItems) {
    const inherited = inheritProvenance(item.provenance, item.relatedTestCaseIds, tcProvenanceMap);
    if (inherited.length > item.provenance.length) {
      gainedCount++;
    }
    item.provenance = inherited;
  }

  return gainedCount;
}

/** Deterministic key for provenance deduplication. */
function provenanceKey(p: TestProvenance): string {
  const parts = [p.requirementId];
  if (p.contextId) parts.push(p.contextId);
  if (p.sheet) parts.push(p.sheet);
  if (p.ranges && p.ranges.length > 0) parts.push(p.ranges.join(','));
  return parts.join('|');
}
