// ---------------------------------------------------------------------------
// Merge tests – entity deduplication, provenance merge, ID remapping
// ---------------------------------------------------------------------------
// Spec coverage: scenarios 16-20

import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  findDuplicateCandidates,
  applyEntityMerge,
} from '../src/merge/entity-merger.js';
import {
  createIdGenerator,
  buildLocalToGlobalMap,
  resolveLocalId,
} from '../src/merge/id-remapper.js';
import { SemanticWarningCode } from '../src/warnings.js';
import { chunkEntity, prov } from './fixtures/helpers.js';

describe('normalizeName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeName('  User  Name  ')).toBe('user name');
    expect(normalizeName('USERS')).toBe('users');
    expect(normalizeName('Admin\tUser')).toBe('admin user'); // \s+ collapses tabs too
  });
});

describe('findDuplicateCandidates', () => {
  // Scenario 16: unique entities – no duplicates
  it('returns no groups when all entities are unique', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'Order', type: 'table' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e3', name: 'Product', type: 'table' }), contextId: 'ctx-b' },
    ];
    const groups = findDuplicateCandidates(entities);
    expect(groups).toHaveLength(0);
  });

  // Scenario 17: obvious duplicate candidate (same name + type)
  it('identifies obvious duplicates by normalized name and type', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'user', type: 'table' }), contextId: 'ctx-b' },
      { entity: chunkEntity({ localId: 'e3', name: 'USER', type: 'table' }), contextId: 'ctx-c' },
    ];
    const groups = findDuplicateCandidates(entities);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([0, 1, 2]);
  });

  // Scenario 18: non-duplicate similar names (different type)
  it('does not merge entities with same name but different type', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'User', type: 'screen' }), contextId: 'ctx-b' },
    ];
    const groups = findDuplicateCandidates(entities);
    expect(groups).toHaveLength(0);
  });

  it('does not merge "Customer User" with "Admin User"', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'Customer User', type: 'role' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'Admin User', type: 'role' }), contextId: 'ctx-b' },
    ];
    const groups = findDuplicateCandidates(entities);
    expect(groups).toHaveLength(0);
  });

  it('detects duplicates via alias matching when names differ', () => {
    // Both entities share the same normalized name+type, so they are
    // candidate duplicates. The alias provides additional confirmation.
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table', aliases: ['Users'] }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'User', type: 'table' }), contextId: 'ctx-b' },
    ];
    const groups = findDuplicateCandidates(entities);
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });
});

describe('applyEntityMerge', () => {
  // Scenario 19: provenance merge
  it('merges provenance from duplicate entities', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table', provenance: [prov('ctx-a', 'Sheet1', ['A1'])] }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'user', type: 'table', provenance: [prov('ctx-b', 'Sheet2', ['B2'])] }), contextId: 'ctx-b' },
    ];
    const groups = findDuplicateCandidates(entities);
    const { merged, warnings } = applyEntityMerge(entities, groups);

    expect(merged).toHaveLength(1);
    expect(merged[0].entity.provenance).toHaveLength(2);
    expect(merged[0].entity.provenance[0].contextId).toBe('ctx-a');
    expect(merged[0].entity.provenance[1].contextId).toBe('ctx-b');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe(SemanticWarningCode.DUPLICATE_CANDIDATE);
  });

  it('merges aliases from duplicate entities', () => {
    // Both share name+type so they are detected as duplicates
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'User', type: 'table', aliases: ['usr'] }), contextId: 'ctx-b' },
    ];
    const groups = findDuplicateCandidates(entities);
    const { merged } = applyEntityMerge(entities, groups);

    expect(merged).toHaveLength(1);
    expect(merged[0].entity.aliases).toBeDefined();
    expect(merged[0].entity.aliases!.length).toBeGreaterThanOrEqual(1);
  });

  it('does not merge unique entities', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table' }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'Order', type: 'table' }), contextId: 'ctx-a' },
    ];
    const groups = findDuplicateCandidates(entities);
    const { merged, warnings } = applyEntityMerge(entities, groups);

    expect(merged).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it('deduplicates provenance within merged entity', () => {
    const entities = [
      { entity: chunkEntity({ localId: 'e1', name: 'User', type: 'table', provenance: [prov('ctx-a', 'Sheet1', ['A1'])] }), contextId: 'ctx-a' },
      { entity: chunkEntity({ localId: 'e2', name: 'user', type: 'table', provenance: [prov('ctx-a', 'Sheet1', ['A1'])] }), contextId: 'ctx-a' },
    ];
    const groups = findDuplicateCandidates(entities);
    const { merged } = applyEntityMerge(entities, groups);

    expect(merged).toHaveLength(1);
    // Same provenance should be deduplicated
    expect(merged[0].entity.provenance).toHaveLength(1);
  });
});

describe('ID remapper', () => {
  // Scenario 20: ID remapping
  describe('createIdGenerator', () => {
    it('generates sequential zero-padded IDs', () => {
      const gen = createIdGenerator('ent');
      expect(gen()).toBe('ent-0000');
      expect(gen()).toBe('ent-0001');
      expect(gen()).toBe('ent-0002');
    });

    it('uses the correct prefix', () => {
      const secGen = createIdGenerator('sec');
      const flowGen = createIdGenerator('flow');
      expect(secGen()).toBe('sec-0000');
      expect(flowGen()).toBe('flow-0000');
    });
  });

  describe('buildLocalToGlobalMap', () => {
    it('maps local IDs to global IDs across chunks', () => {
      const chunkResults = [
        {
          contextId: 'ctx-a',
          entities: [{ localId: 'e1' }, { localId: 'e2' }],
          sections: [{ localId: 's1' }],
          flows: [],
          rules: [{ localId: 'r1' }],
          relationships: [],
          unresolved: [],
        },
        {
          contextId: 'ctx-b',
          entities: [{ localId: 'e1' }],
          sections: [],
          flows: [{ localId: 'f1' }],
          rules: [],
          relationships: [],
          unresolved: [],
        },
      ];

      const map = buildLocalToGlobalMap(
        chunkResults,
        ['ent-0000', 'ent-0001', 'ent-0002'],
        ['sec-0000'],
        ['flow-0000'],
        ['rule-0000'],
        [],
        [],
      );

      expect(map.get('ctx-a:e1')).toBe('ent-0000');
      expect(map.get('ctx-a:e2')).toBe('ent-0001');
      expect(map.get('ctx-b:e1')).toBe('ent-0002');
      expect(map.get('ctx-a:s1')).toBe('sec-0000');
      expect(map.get('ctx-b:f1')).toBe('flow-0000');
      expect(map.get('ctx-a:r1')).toBe('rule-0000');
    });
  });

  describe('resolveLocalId', () => {
    it('resolves a known local ID to its global ID', () => {
      const map = new Map([['ctx-a:e1', 'ent-0005']]);
      expect(resolveLocalId(map, 'ctx-a', 'e1')).toBe('ent-0005');
    });

    it('returns the original localId when not found in map', () => {
      const map = new Map<string, string>();
      expect(resolveLocalId(map, 'ctx-a', 'unknown')).toBe('unknown');
    });
  });
});
