// ---------------------------------------------------------------------------
// ID remapper – assigns deterministic global IDs
// ---------------------------------------------------------------------------

/** Zero-padded global ID generator. */
export function createIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => {
    const id = `${prefix}-${String(counter).padStart(4, '0')}`;
    counter++;
    return id;
  };
}

/**
 * Build a local-to-global ID mapping for a chunk's entities.
 *
 * Format: "ctx-s001-c000:local-entity-001" → "ent-0003"
 */
export function buildLocalToGlobalMap(
  chunkResults: Array<{
    contextId: string;
    entities: Array<{ localId: string }>;
    sections: Array<{ localId: string }>;
    flows: Array<{ localId: string }>;
    rules: Array<{ localId: string }>;
    relationships: Array<{ localId: string }>;
    unresolved: Array<{ localId: string }>;
  }>,
  entityGlobalIds: string[],
  sectionGlobalIds: string[],
  flowGlobalIds: string[],
  ruleGlobalIds: string[],
  relationshipGlobalIds: string[],
  unresolvedGlobalIds: string[],
): Map<string, string> {
  const map = new Map<string, string>();

  let entityIdx = 0;
  let sectionIdx = 0;
  let flowIdx = 0;
  let ruleIdx = 0;
  let relIdx = 0;
  let unresolvedIdx = 0;

  for (const result of chunkResults) {
    for (const e of result.entities) {
      map.set(`${result.contextId}:${e.localId}`, entityGlobalIds[entityIdx++]!);
    }
    for (const s of result.sections) {
      map.set(`${result.contextId}:${s.localId}`, sectionGlobalIds[sectionIdx++]!);
    }
    for (const f of result.flows) {
      map.set(`${result.contextId}:${f.localId}`, flowGlobalIds[flowIdx++]!);
    }
    for (const r of result.rules) {
      map.set(`${result.contextId}:${r.localId}`, ruleGlobalIds[ruleIdx++]!);
    }
    for (const rel of result.relationships) {
      map.set(`${result.contextId}:${rel.localId}`, relationshipGlobalIds[relIdx++]!);
    }
    for (const u of result.unresolved) {
      map.set(`${result.contextId}:${u.localId}`, unresolvedGlobalIds[unresolvedIdx++]!);
    }
  }

  return map;
}

/** Resolve a local ID reference to a global ID, or return the original if not found. */
export function resolveLocalId(map: Map<string, string>, contextId: string, localId: string): string {
  return map.get(`${contextId}:${localId}`) ?? localId;
}
