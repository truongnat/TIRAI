// ---------------------------------------------------------------------------
// Provenance validator – ensures AI does not hallucinate references
// ---------------------------------------------------------------------------
// Checks that every provenance reference in AI output points to a real
// context chunk and valid sheet/range that exists in the source.

import type { ProvenanceReference, SemanticWarning } from '../models.js';
import type { AnalyzerContextChunk } from '../persistence/loader.js';
import { SemanticWarningCode } from '../warnings.js';

/** Build a set of valid context IDs from the loaded chunks. */
export function buildValidContextIds(chunks: AnalyzerContextChunk[]): Set<string> {
  return new Set(chunks.map((c) => c.id));
}

/** Build a map of contextId → sheet name from loaded chunks. */
export function buildContextSheetMap(chunks: AnalyzerContextChunk[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of chunks) {
    map.set(c.id, contextGroup(c));
  }
  return map;
}

/** Build a map of contextId → valid ranges from loaded chunks. */
export function buildContextRangeMap(chunks: AnalyzerContextChunk[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of chunks) {
    const ranges = new Set<string>();
    if ('range' in c && c.range) ranges.add(c.range);
    if ('ranges' in c.provenance) {
      for (const r of c.provenance.ranges) ranges.add(r);
    }
    map.set(c.id, ranges);
  }
  return map;
}

export function buildContextProvenanceMap(chunks: AnalyzerContextChunk[]) {
  return new Map(chunks.filter(isCanonicalChunk).map((chunk) => [chunk.id, chunk.provenance] as const));
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
  contextProvenanceMap?: ReturnType<typeof buildContextProvenanceMap>,
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

  const expected = contextProvenanceMap?.get(prov.contextId);
  if (expected) {
    if (prov.sourceId !== expected.sourceId || prov.revisionId !== expected.revisionId || prov.artifactId !== expected.artifactId) {
      warnings.push({
        code: SemanticWarningCode.INVALID_PROVENANCE,
        message: `Object "${objectId}" does not preserve canonical source, revision, or artifact identity`,
        contextId: prov.contextId,
        objectId,
      });
    }
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
  contextProvenanceMap?: ReturnType<typeof buildContextProvenanceMap>,
): SemanticWarning[] {
  const warnings: SemanticWarning[] = [];
  for (const prov of provenances) {
    warnings.push(...validateProvenance(prov, validContextIds, contextSheetMap, objectId, contextProvenanceMap));
  }
  return warnings;
}

function isCanonicalChunk(chunk: AnalyzerContextChunk): chunk is Extract<AnalyzerContextChunk, { provenance: { sourceId: string } }> {
  return 'sourceId' in chunk.provenance;
}

function contextGroup(chunk: AnalyzerContextChunk): string {
  if ('sheet' in chunk) return chunk.sheet.name;
  return chunk.location.segments.find((segment) => segment.kind === 'heading')?.value.toString()
    ?? chunk.location.segments[0]?.value.toString()
    ?? chunk.id;
}
