// ---------------------------------------------------------------------------
// Deterministic ordering – sort semantic objects for stable ID assignment
// ---------------------------------------------------------------------------

import type {
  ChunkEntity,
  ChunkSection,
  ChunkFlow,
  ChunkRule,
  ChunkRelationship,
  ChunkUnresolved,
} from '../models.js';

/** Sort key: first provenance cell or context ID as tiebreaker. */
function sortKey(contextId: string, provenance: Array<{ cells?: string[]; ranges?: string[] }>): string {
  const firstCell = provenance[0]?.cells?.[0] ?? provenance[0]?.ranges?.[0] ?? '';
  return `${contextId}|${firstCell}`;
}

/** Deterministic ordering for entities across all chunks. */
export function orderEntities(
  results: Array<{ contextId: string; entities: ChunkEntity[] }>,
): Array<{ contextId: string; entity: ChunkEntity }> {
  const flat = results.flatMap((r) =>
    r.entities.map((e) => ({ contextId: r.contextId, entity: e })),
  );
  return flat.sort((a, b) => {
    const ka = sortKey(a.contextId, a.entity.provenance) + '|' + a.entity.name.toLowerCase();
    const kb = sortKey(b.contextId, b.entity.provenance) + '|' + b.entity.name.toLowerCase();
    return ka.localeCompare(kb);
  });
}

/** Deterministic ordering for sections. */
export function orderSections(
  results: Array<{ contextId: string; sections: ChunkSection[] }>,
): Array<{ contextId: string; section: ChunkSection }> {
  const flat = results.flatMap((r) =>
    r.sections.map((s) => ({ contextId: r.contextId, section: s })),
  );
  return flat.sort((a, b) => {
    const ka = sortKey(a.contextId, a.section.provenance) + '|' + a.section.title.toLowerCase();
    const kb = sortKey(b.contextId, b.section.provenance) + '|' + b.section.title.toLowerCase();
    return ka.localeCompare(kb);
  });
}

/** Deterministic ordering for flows. */
export function orderFlows(
  results: Array<{ contextId: string; flows: ChunkFlow[] }>,
): Array<{ contextId: string; flow: ChunkFlow }> {
  const flat = results.flatMap((r) =>
    r.flows.map((f) => ({ contextId: r.contextId, flow: f })),
  );
  return flat.sort((a, b) => {
    const ka = sortKey(a.contextId, a.flow.provenance) + '|' + a.flow.name.toLowerCase();
    const kb = sortKey(b.contextId, b.flow.provenance) + '|' + b.flow.name.toLowerCase();
    return ka.localeCompare(kb);
  });
}

/** Deterministic ordering for rules. */
export function orderRules(
  results: Array<{ contextId: string; rules: ChunkRule[] }>,
): Array<{ contextId: string; rule: ChunkRule }> {
  const flat = results.flatMap((r) =>
    r.rules.map((rl) => ({ contextId: r.contextId, rule: rl })),
  );
  return flat.sort((a, b) => {
    const ka = sortKey(a.contextId, a.rule.provenance) + '|' + a.rule.statement.toLowerCase().slice(0, 50);
    const kb = sortKey(b.contextId, b.rule.provenance) + '|' + b.rule.statement.toLowerCase().slice(0, 50);
    return ka.localeCompare(kb);
  });
}

/** Deterministic ordering for relationships. */
export function orderRelationships(
  results: Array<{ contextId: string; relationships: ChunkRelationship[] }>,
): Array<{ contextId: string; rel: ChunkRelationship }> {
  const flat = results.flatMap((r) =>
    r.relationships.map((rel) => ({ contextId: r.contextId, rel })),
  );
  return flat.sort((a, b) => {
    const ka = `${a.contextId}|${a.rel.type}|${a.rel.sourceLocalId}|${a.rel.targetLocalId}`;
    const kb = `${b.contextId}|${b.rel.type}|${b.rel.sourceLocalId}|${b.rel.targetLocalId}`;
    return ka.localeCompare(kb);
  });
}

/** Deterministic ordering for unresolved items. */
export function orderUnresolved(
  results: Array<{ contextId: string; unresolved: ChunkUnresolved[] }>,
): Array<{ contextId: string; item: ChunkUnresolved }> {
  const flat = results.flatMap((r) =>
    r.unresolved.map((u) => ({ contextId: r.contextId, item: u })),
  );
  return flat.sort((a, b) => {
    const ka = sortKey(a.contextId, a.item.provenance) + '|' + a.item.description.toLowerCase().slice(0, 50);
    const kb = sortKey(b.contextId, b.item.provenance) + '|' + b.item.description.toLowerCase().slice(0, 50);
    return ka.localeCompare(kb);
  });
}
