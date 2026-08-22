// ---------------------------------------------------------------------------
// Evidence batch builder – groups semantic objects for extraction
// ---------------------------------------------------------------------------
// Creates bounded batches to avoid token explosion and reduce duplicates.
// Strategy: each flow + referenced entities/rules, standalone rules,
// remaining structures.

import type { SemanticIRInput } from '../models.js';
import type { EvidenceBatch } from '../prompts/extraction.js';

/**
 * Build evidence batches from a Semantic IR.
 *
 * Batching strategy:
 * 1. Each flow + its referenced entities + rules sharing evidence
 * 2. Standalone rules (not already covered by flow batches)
 * 3. Remaining entities + relationships + sections
 */
export function buildEvidenceBatches(ir: SemanticIRInput): EvidenceBatch[] {
  const batches: EvidenceBatch[] = [];
  const consumedRuleIds = new Set<string>();
  const consumedEntityIds = new Set<string>();

  // ---- Batch per flow ----
  for (const flow of ir.flows) {
    // Collect entities referenced by this flow's provenance or steps
    const flowEntities = findRelatedEntities(flow, ir.entities);
    for (const e of flowEntities) consumedEntityIds.add(e.id);

    // Collect rules that share provenance context with this flow
    const flowRules = findRelatedRules(flow, ir.rules);
    for (const r of flowRules) consumedRuleIds.add(r.id);

    batches.push({
      label: `flow-${flow.id}`,
      flows: [flow],
      rules: flowRules,
      entities: flowEntities,
      relationships: findRelatedRelationships(flow.id, ir.relationships),
      sections: ir.sections.filter((s) =>
        s.provenance.some((p) => flow.provenance.some((fp) => fp.contextId === p.contextId)),
      ),
    });
  }

  // ---- Standalone rules ----
  const standaloneRules = ir.rules.filter((r) => !consumedRuleIds.has(r.id));
  if (standaloneRules.length > 0) {
    const standaloneEntities = ir.entities.filter((e) => !consumedEntityIds.has(e.id));

    batches.push({
      label: 'standalone-rules',
      flows: [],
      rules: standaloneRules,
      entities: standaloneEntities,
      relationships: ir.relationships,
      sections: ir.sections,
    });
  }

  // ---- Remaining structures (if any entities/relationships not yet covered) ----
  const remainingEntities = ir.entities.filter((e) => !consumedEntityIds.has(e.id));
  const remainingRelationships = ir.relationships.filter(
    (r) => !batches.some((b) => b.relationships.some((br) => br.id === r.id)),
  );

  if (remainingEntities.length > 0 || remainingRelationships.length > 0) {
    batches.push({
      label: 'remaining-structures',
      flows: [],
      rules: [],
      entities: remainingEntities,
      relationships: remainingRelationships,
      sections: ir.sections,
    });
  }

  // If no batches were created (empty IR), create a single empty batch
  if (batches.length === 0) {
    batches.push({
      label: 'empty',
      flows: [],
      rules: [],
      entities: [],
      relationships: [],
      sections: ir.sections,
    });
  }

  return batches;
}

/**
 * Find entities that share provenance context with a flow.
 */
function findRelatedEntities(
  flow: SemanticIRInput['flows'][number],
  entities: SemanticIRInput['entities'],
): SemanticIRInput['entities'] {
  const flowContextIds = new Set(flow.provenance.map((p) => p.contextId));
  return entities.filter((e) =>
    e.provenance.some((p) => flowContextIds.has(p.contextId)),
  );
}

/**
 * Find rules that share provenance context with a flow.
 */
function findRelatedRules(
  flow: SemanticIRInput['flows'][number],
  rules: SemanticIRInput['rules'],
): SemanticIRInput['rules'] {
  const flowContextIds = new Set(flow.provenance.map((p) => p.contextId));
  return rules.filter((r) =>
    r.provenance.some((p) => flowContextIds.has(p.contextId)),
  );
}

/**
 * Find relationships where source or target matches a flow ID.
 */
function findRelatedRelationships(
  flowId: string,
  relationships: SemanticIRInput['relationships'],
): SemanticIRInput['relationships'] {
  return relationships.filter(
    (r) => r.sourceId === flowId || r.targetId === flowId,
  );
}
