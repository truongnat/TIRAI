// ---------------------------------------------------------------------------
// Determinism tests – ordering, IDs, concurrency independence
// ---------------------------------------------------------------------------
// Spec coverage: scenarios 24-26

import { describe, it, expect } from 'vitest';
import {
  orderEntities,
  orderSections,
  orderFlows,
  orderRules,
  orderRelationships,
  orderUnresolved,
} from '../src/merge/deterministic-order.js';
import { createIdGenerator } from '../src/merge/id-remapper.js';
import { computeFingerprint } from '../src/fingerprint.js';
import { chunkEntity, chunkSection, chunkFlow, chunkRule, chunkRel, chunkUnresolved, prov } from './fixtures/helpers.js';

describe('deterministic ordering', () => {
  // Scenario 24: deterministic ordering
  describe('orderEntities', () => {
    it('sorts entities by contextId, provenance cell, then name', () => {
      const results = [
        {
          contextId: 'ctx-b',
          entities: [
            chunkEntity({ localId: 'e1', name: 'Zebra', type: 'table', provenance: [prov('ctx-b', 'Sheet', ['A1'])] }),
          ],
        },
        {
          contextId: 'ctx-a',
          entities: [
            chunkEntity({ localId: 'e2', name: 'Apple', type: 'table', provenance: [prov('ctx-a', 'Sheet', ['B1'])] }),
            chunkEntity({ localId: 'e1', name: 'Banana', type: 'table', provenance: [prov('ctx-a', 'Sheet', ['A1'])] }),
          ],
        },
      ];

      const ordered = orderEntities(results);

      // ctx-a|A1|banana < ctx-a|B1|apple < ctx-b|A1|zebra
      expect(ordered).toHaveLength(3);
      expect(ordered[0].entity.name).toBe('Banana');  // ctx-a|A1
      expect(ordered[1].entity.name).toBe('Apple');   // ctx-a|B1
      expect(ordered[2].entity.name).toBe('Zebra');   // ctx-b|A1
    });

    it('produces the same order regardless of input order', () => {
      const results1 = [
        { contextId: 'ctx-a', entities: [chunkEntity({ localId: 'e1', name: 'B', type: 't' })] },
        { contextId: 'ctx-b', entities: [chunkEntity({ localId: 'e1', name: 'A', type: 't' })] },
      ];
      const results2 = [
        { contextId: 'ctx-b', entities: [chunkEntity({ localId: 'e1', name: 'A', type: 't' })] },
        { contextId: 'ctx-a', entities: [chunkEntity({ localId: 'e1', name: 'B', type: 't' })] },
      ];

      const ordered1 = orderEntities(results1).map((e) => e.entity.name);
      const ordered2 = orderEntities(results2).map((e) => e.entity.name);
      expect(ordered1).toEqual(ordered2);
    });
  });

  describe('orderSections', () => {
    it('sorts sections deterministically', () => {
      const results = [
        { contextId: 'ctx-a', sections: [chunkSection({ localId: 's1', title: 'Z Section' })] },
        { contextId: 'ctx-a', sections: [chunkSection({ localId: 's2', title: 'A Section' })] },
      ];
      const ordered = orderSections(results);
      expect(ordered[0].section.title).toBe('A Section');
      expect(ordered[1].section.title).toBe('Z Section');
    });
  });

  describe('orderFlows', () => {
    it('sorts flows deterministically', () => {
      const results = [
        { contextId: 'ctx-a', flows: [chunkFlow({ localId: 'f1', name: 'Login' })] },
        { contextId: 'ctx-a', flows: [chunkFlow({ localId: 'f2', name: 'Auth' })] },
      ];
      const ordered = orderFlows(results);
      expect(ordered[0].flow.name).toBe('Auth');
      expect(ordered[1].flow.name).toBe('Login');
    });
  });

  describe('orderRules', () => {
    it('sorts rules by provenance then statement', () => {
      const results = [
        {
          contextId: 'ctx-a',
          rules: [
            chunkRule({ localId: 'r1', type: 'validation', statement: 'Z rule' }),
            chunkRule({ localId: 'r2', type: 'validation', statement: 'A rule' }),
          ],
        },
      ];
      const ordered = orderRules(results);
      expect(ordered[0].rule.statement).toBe('A rule');
    });
  });

  describe('orderRelationships', () => {
    it('sorts relationships by contextId, type, source, target', () => {
      const results = [
        {
          contextId: 'ctx-a',
          relationships: [
            chunkRel({ localId: 'r1', type: 'calls', sourceLocalId: 'e2', targetLocalId: 'e1' }),
            chunkRel({ localId: 'r2', type: 'calls', sourceLocalId: 'e1', targetLocalId: 'e2' }),
          ],
        },
      ];
      const ordered = orderRelationships(results);
      expect(ordered[0].rel.sourceLocalId).toBe('e1');
    });
  });

  describe('orderUnresolved', () => {
    it('sorts unresolved items deterministically', () => {
      const results = [
        {
          contextId: 'ctx-a',
          unresolved: [
            chunkUnresolved({ localId: 'u1', type: 'ambiguous', description: 'Z item', reason: 'unclear' }),
            chunkUnresolved({ localId: 'u2', type: 'ambiguous', description: 'A item', reason: 'unclear' }),
          ],
        },
      ];
      const ordered = orderUnresolved(results);
      expect(ordered[0].item.description).toBe('A item');
    });
  });
});

describe('deterministic IDs', () => {
  // Scenario 25: deterministic IDs
  it('generates sequential IDs with correct prefix', () => {
    const gen = createIdGenerator('ent');
    const ids = [gen(), gen(), gen(), gen()];
    expect(ids).toEqual(['ent-0000', 'ent-0001', 'ent-0002', 'ent-0003']);
  });

  it('different prefixes produce independent sequences', () => {
    const entGen = createIdGenerator('ent');
    const secGen = createIdGenerator('sec');
    expect(entGen()).toBe('ent-0000');
    expect(secGen()).toBe('sec-0000');
    expect(entGen()).toBe('ent-0001');
    expect(secGen()).toBe('sec-0001');
  });
});

describe('fingerprint', () => {
  // Scenario 26: concurrency does not change output (fingerprint is deterministic)
  it('produces the same fingerprint for the same input', () => {
    const fp1 = computeFingerprint('content', '1.0', 'groq');
    const fp2 = computeFingerprint('content', '1.0', 'groq');
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprints for different content', () => {
    const fp1 = computeFingerprint('content-a', '1.0', 'groq');
    const fp2 = computeFingerprint('content-b', '1.0', 'groq');
    expect(fp1).not.toBe(fp2);
  });

  it('produces different fingerprints for different prompt versions', () => {
    const fp1 = computeFingerprint('content', '1.0', 'groq');
    const fp2 = computeFingerprint('content', '2.0', 'groq');
    expect(fp1).not.toBe(fp2);
  });

  it('produces different fingerprints for different models', () => {
    const fp1 = computeFingerprint('content', '1.0', 'groq');
    const fp2 = computeFingerprint('content', '1.0', 'openai');
    expect(fp1).not.toBe(fp2);
  });

  it('returns a 16-character hex string', () => {
    const fp = computeFingerprint('test', '1.0', 'model');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});
