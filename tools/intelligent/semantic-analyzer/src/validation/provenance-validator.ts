// ---------------------------------------------------------------------------
// Provenance validator – ensures AI does not hallucinate references
// ---------------------------------------------------------------------------
// Checks that every provenance reference in AI output points to a real
// context chunk and valid sheet/range that exists in the source.

import type { ProvenanceReference, SemanticWarning } from '../models.js';
import type { ContextChunk } from '../persistence/loader.js';
import { SemanticWarningCode } from '../warnings.js';

/** Build a set of valid context IDs from the loaded chunks. */
export function buildValidContextIds(chunks: ContextChunk[]): Set<string> {
  return new Set(chunks.map((c) => c.id));
}

/** Build a map of contextId → sheet name from loaded chunks. */
export function buildContextSheetMap(chunks: ContextChunk[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of chunks) {
    map.set(c.id, c.sheet.name);
  }
  return map;
}

/** Build a map of contextId → valid ranges from loaded chunks. */
export function buildContextRangeMap(chunks: ContextChunk[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of chunks) {
    const ranges = new Set<string>();
    if (c.range) ranges.add(c.range);
    for (const r of c.provenance.ranges) ranges.add(r);
    map.set(c.id, ranges);
  }
  return map;
}

/**
 * Validate a single provenance reference against the source context.
 *
 * Returns an array of warnings for any invalid aspects.
 * An empty array means the provenance is valid.
 */
export function validateProvenance(
  prov: ProvenanceReference,
  validContextIds: Set<string>,
  contextSheetMap: Map<string, string>,
  objectId: string,
): SemanticWarning[] {
  const warnings: SemanticWarning[] = [];

  // Check contextId exists
  if (!validContextIds.has(prov.contextId)) {
    warnings.push({
      code: SemanticWarningCode.INVALID_PROVENANCE,
      message: `Object "${objectId}" references non-existent context "${prov.contextId}"`,
      contextId: prov.contextId,
      objectId,
    });
    return warnings; // No point checking further
  }

  // Check sheet name matches
  if (prov.sheet) {
    const expectedSheet = contextSheetMap.get(prov.contextId);
    if (expectedSheet && prov.sheet !== expectedSheet) {
      warnings.push({
        code: SemanticWarningCode.INVALID_PROVENANCE,
        message: `Object "${objectId}" sheet "${prov.sheet}" does not match context sheet "${expectedSheet}"`,
        contextId: prov.contextId,
        objectId,
      });
    }
  }

  return warnings;
}

/**
 * Validate all provenance references in an array.
 * Returns all warnings found.
 */
export function validateProvenanceArray(
  provenances: ProvenanceReference[],
  validContextIds: Set<string>,
  contextSheetMap: Map<string, string>,
  objectId: string,
): SemanticWarning[] {
  const warnings: SemanticWarning[] = [];
  for (const prov of provenances) {
    warnings.push(...validateProvenance(prov, validContextIds, contextSheetMap, objectId));
  }
  return warnings;
}
