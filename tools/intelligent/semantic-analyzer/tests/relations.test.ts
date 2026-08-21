// ---------------------------------------------------------------------------
// Relationship tests – dangling reference detection, cross-chunk resolution
// ---------------------------------------------------------------------------
// Spec coverage: scenarios 21-23

import { describe, it, expect } from 'vitest';
import { validateRelationships } from '../src/validation/relationship-validator.js';
import { SemanticWarningCode } from '../src/warnings.js';
import { semanticRel } from './fixtures/helpers.js';

describe('relationship validator', () => {
  const entityIds = new Set(['ent-0000', 'ent-0001', 'ent-0002']);
  const sectionIds = new Set(['sec-0000']);
  const flowIds = new Set(['flow-0000']);

  // Scenario 21: valid relationship
  it('returns no warnings when both source and target exist', () => {
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'calls', sourceId: 'ent-0000', targetId: 'ent-0001' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(0);
  });

  it('accepts relationships between entities, sections, and flows', () => {
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'belongs-to', sourceId: 'ent-0000', targetId: 'sec-0000' }),
      semanticRel({ id: 'rel-0001', type: 'triggers', sourceId: 'ent-0001', targetId: 'flow-0000' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(0);
  });

  // Scenario 22: dangling relationship
  it('warns when source ID does not exist', () => {
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'calls', sourceId: 'ent-9999', targetId: 'ent-0001' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe(SemanticWarningCode.RELATIONSHIP_UNRESOLVED);
    expect(warnings[0].message).toContain('source');
    expect(warnings[0].message).toContain('ent-9999');
  });

  it('warns when target ID does not exist', () => {
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'calls', sourceId: 'ent-0000', targetId: 'ent-9999' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe(SemanticWarningCode.RELATIONSHIP_UNRESOLVED);
    expect(warnings[0].message).toContain('target');
  });

  it('warns for both source and target when neither exists', () => {
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'calls', sourceId: 'ent-X', targetId: 'ent-Y' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(2);
  });

  // Scenario 23: cross-chunk relationship
  it('validates cross-chunk relationships after ID remapping', () => {
    // After remapping, cross-chunk refs should point to valid global IDs
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'reads', sourceId: 'ent-0000', targetId: 'ent-0002' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(0);
  });

  it('detects unresolved cross-chunk references', () => {
    // If cross-chunk ref could not be resolved, it remains as raw string
    const rels = [
      semanticRel({ id: 'rel-0000', type: 'reads', sourceId: 'ctx-b:local-e1', targetId: 'ent-0000' }),
    ];
    const warnings = validateRelationships(rels, entityIds, sectionIds, flowIds);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('ctx-b:local-e1');
  });
});
