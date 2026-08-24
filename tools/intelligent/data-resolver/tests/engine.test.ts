// ---------------------------------------------------------------------------
// Data Resolver – engine, graph, quality, and acceptance tests
// ---------------------------------------------------------------------------
// Tests 76-83+: quality, acceptance, graph, validation, persistence.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveDataPlan, buildManifest } from '../src/resolver-engine.js';
import { topologicalSort, detectCycles, buildPreparationDependencies, countDanglingDependencies } from '../src/graph/topological-sort.js';
import { computeResolutionQuality } from '../src/quality/metrics.js';
import { validateDataPlan, validateEnvironmentProfile, validateMappings } from '../src/validation/input-validator.js';
import { DataResolverError } from '../src/errors.js';
import { clearRegistry } from '../src/registry.js';
import { acceptedDataPlan } from './fixtures/accepted-data-plan.js';
import {
  minimalDataItem,
  minimalDataPlan,
  minimalEnvironment,
  dbResource,
  dependency,
} from './helpers.js';
import type { PreparationOperation, PreparationDependency, EnvironmentProfile } from '../src/models.js';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');

// ===========================================================================
// QUALITY (tests 76-80)
// ===========================================================================

describe('Quality metrics', () => {
  it('76. full resolution', () => {
    const ops: PreparationOperation[] = [
      { id: 'OP-1', dataItemId: 'D1', resolver: 'database', action: 'select', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.8 },
      { id: 'OP-2', dataItemId: 'D2', resolver: 'value-generator', action: 'generate', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.9 },
    ];
    const q = computeResolutionQuality(2, ops, [], [], []);
    expect(q.resolved).toBe(2);
    expect(q.automatedOperations).toBe(2);
    expect(q.manualOperations).toBe(0);
  });

  it('77. partial resolution', () => {
    const ops: PreparationOperation[] = [
      { id: 'OP-1', dataItemId: 'D1', resolver: 'database', action: 'select', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.8 },
      { id: 'OP-2', dataItemId: 'D2', resolver: 'manual', action: 'manual', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.5 },
    ];
    const q = computeResolutionQuality(2, ops, [], [], []);
    expect(q.automatedOperations).toBe(1);
    expect(q.manualOperations).toBe(1);
  });

  it('78. manual resolution', () => {
    const ops: PreparationOperation[] = [
      { id: 'OP-1', dataItemId: 'D1', resolver: 'manual', action: 'manual', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.5 },
    ];
    const q = computeResolutionQuality(1, ops, [], [], []);
    expect(q.manualOperations).toBe(1);
    expect(q.automatedOperations).toBe(0);
  });

  it('79. provenance coverage', () => {
    const ops: PreparationOperation[] = [
      { id: 'OP-1', dataItemId: 'D1', resolver: 'database', action: 'select', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [{ requirementId: 'R1' }], confidence: 0.8 },
      { id: 'OP-2', dataItemId: 'D2', resolver: 'database', action: 'select', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.8 },
    ];
    const q = computeResolutionQuality(2, ops, [], [], []);
    expect(q.provenanceCoverage).toBe(0.5);
  });

  it('80. automation readiness', () => {
    const ops: PreparationOperation[] = [
      { id: 'OP-1', dataItemId: 'D1', resolver: 'database', action: 'select', resourceId: 'db-1', parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.8 },
    ];
    const q = computeResolutionQuality(1, ops, [], [], []);
    expect(q.resolved).toBe(1);
    expect(q.partiallyResolved).toBe(0);
  });
});

// ===========================================================================
// GRAPH (tests for topological sort and cycle detection)
// ===========================================================================

describe('Graph operations', () => {
  const makeOp = (id: string): PreparationOperation => ({
    id, dataItemId: id.replace('OP-', 'D-'), resolver: 'database', action: 'select',
    parameters: {}, produces: [], consumes: [], cleanupOperationIds: [], provenance: [], confidence: 0.7,
  });

  it('topological sort: linear chain', () => {
    const ops = [makeOp('OP-A'), makeOp('OP-B'), makeOp('OP-C')];
    const deps: PreparationDependency[] = [
      { id: 'd1', sourceOperationId: 'OP-A', targetOperationId: 'OP-B', type: 'requires' },
      { id: 'd2', sourceOperationId: 'OP-B', targetOperationId: 'OP-C', type: 'requires' },
    ];
    const order = topologicalSort(ops, deps);
    expect(order.indexOf('OP-A')).toBeLessThan(order.indexOf('OP-B'));
    expect(order.indexOf('OP-B')).toBeLessThan(order.indexOf('OP-C'));
  });

  it('topological sort: diamond', () => {
    const ops = [makeOp('OP-A'), makeOp('OP-B'), makeOp('OP-C'), makeOp('OP-D')];
    const deps: PreparationDependency[] = [
      { id: 'd1', sourceOperationId: 'OP-A', targetOperationId: 'OP-B', type: 'requires' },
      { id: 'd2', sourceOperationId: 'OP-A', targetOperationId: 'OP-C', type: 'requires' },
      { id: 'd3', sourceOperationId: 'OP-B', targetOperationId: 'OP-D', type: 'requires' },
      { id: 'd4', sourceOperationId: 'OP-C', targetOperationId: 'OP-D', type: 'requires' },
    ];
    const order = topologicalSort(ops, deps);
    expect(order.indexOf('OP-A')).toBeLessThan(order.indexOf('OP-D'));
  });

  it('cycle detection: acyclic → 0', () => {
    const ops = [makeOp('OP-A'), makeOp('OP-B')];
    const deps: PreparationDependency[] = [
      { id: 'd1', sourceOperationId: 'OP-A', targetOperationId: 'OP-B', type: 'requires' },
    ];
    expect(detectCycles(ops, deps)).toBe(0);
  });

  it('cycle detection: cyclic → > 0', () => {
    const ops = [makeOp('OP-A'), makeOp('OP-B')];
    const deps: PreparationDependency[] = [
      { id: 'd1', sourceOperationId: 'OP-A', targetOperationId: 'OP-B', type: 'requires' },
      { id: 'd2', sourceOperationId: 'OP-B', targetOperationId: 'OP-A', type: 'requires' },
    ];
    expect(detectCycles(ops, deps)).toBeGreaterThan(0);
  });

  it('topological sort: throws on cycle', () => {
    const ops = [makeOp('OP-A'), makeOp('OP-B')];
    const deps: PreparationDependency[] = [
      { id: 'd1', sourceOperationId: 'OP-A', targetOperationId: 'OP-B', type: 'requires' },
      { id: 'd2', sourceOperationId: 'OP-B', targetOperationId: 'OP-A', type: 'requires' },
    ];
    expect(() => topologicalSort(ops, deps)).toThrow('Cycle detected');
  });

  it('dangling dependencies: counts missing refs', () => {
    const ops = [makeOp('OP-A')];
    const deps: PreparationDependency[] = [
      { id: 'd1', sourceOperationId: 'OP-A', targetOperationId: 'OP-MISSING', type: 'requires' },
    ];
    expect(countDanglingDependencies(ops, deps)).toBe(1);
  });

  it('buildPreparationDependencies: converts data deps', () => {
    const dataDeps = [dependency('DEP-1', 'DATA-0001', 'DATA-0002', 'derived-from')];
    const prepDeps = buildPreparationDependencies(dataDeps);
    expect(prepDeps).toHaveLength(1);
    expect(prepDeps[0]!.sourceOperationId).toBe('OP-DATA-0001');
    expect(prepDeps[0]!.targetOperationId).toBe('OP-DATA-0002');
    expect(prepDeps[0]!.type).toBe('derived-from');
  });
});

// ===========================================================================
// VALIDATION
// ===========================================================================

describe('Validation', () => {
  it('rejects null data plan', () => {
    expect(() => validateDataPlan(null)).toThrow(DataResolverError);
  });

  it('rejects wrong schema version', () => {
    expect(() => validateDataPlan({ schemaVersion: '2.0', dataItems: [], dependencyGraph: [], testCases: [] })).toThrow(DataResolverError);
  });

  it('rejects missing dataItems array', () => {
    expect(() => validateDataPlan({ schemaVersion: '1.0', dependencyGraph: [], testCases: [] })).toThrow(DataResolverError);
  });

  it('rejects null environment', () => {
    expect(() => validateEnvironmentProfile(null)).toThrow(DataResolverError);
  });

  it('rejects environment without id', () => {
    expect(() => validateEnvironmentProfile({ resources: [] })).toThrow(DataResolverError);
  });

  it('rejects mapping without logicalEntity', () => {
    expect(() => validateMappings([{ logicalEntity: '', resourceId: 'db-1' }])).toThrow(DataResolverError);
  });
});

// ===========================================================================
// OUTPUT (tests 81-83)
// ===========================================================================

describe('Output', () => {
  it('81. executable IR has correct schema', () => {
    const plan = minimalDataPlan({
      dataItems: [minimalDataItem({ type: 'input', strategy: 'generate' })],
    });
    const env = minimalEnvironment({ resources: [dbResource()] });
    const { ir } = resolveDataPlan(plan, env);
    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.operations).toHaveLength(1);
    expect(ir.environmentProfileId).toBe('test-env');
  });

  it('82. manifest has correct stats', () => {
    const plan = minimalDataPlan({
      dataItems: [
        minimalDataItem({ id: 'D1', type: 'input', strategy: 'generate' }),
        minimalDataItem({ id: 'D2', type: 'database-record', strategy: 'create-new' }),
      ],
    });
    const env = minimalEnvironment({ resources: [dbResource()] });
    const { ir, warnings } = resolveDataPlan(plan, env);
    const manifest = buildManifest('test.json', env.id, ir, warnings);
    expect(manifest.stats.dataItemsTotal).toBe(2);
    expect(manifest.stats.operations).toBe(2);
  });

  it('83. quality report is computed', () => {
    const plan = minimalDataPlan({
      dataItems: [minimalDataItem({ type: 'input', strategy: 'generate' })],
    });
    const env = minimalEnvironment();
    const { ir } = resolveDataPlan(plan, env);
    expect(ir.quality.dataItemsTotal).toBe(1);
    expect(ir.quality.operations).toBe(1);
  });
});

// ===========================================================================
// ACCEPTANCE TEST — Real artifact (spec §62-65)
// ===========================================================================

describe('Acceptance: real Test Data Plan + synthetic environment', () => {
  let ir: ReturnType<typeof resolveDataPlan>['ir'];

  beforeEach(() => {
    clearRegistry();
    const envPath = path.join(FIXTURES, 'local-test-environment.json');
    const mappingsPath = path.join(FIXTURES, 'resource-mappings.json');

    const plan = acceptedDataPlan;
    const environment = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as EnvironmentProfile;
    const mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf-8'));

    const result = resolveDataPlan(plan, environment, { mappings });
    ir = result.ir;
  });

  it('produces 24 operations for 24 data items', () => {
    expect(ir.operations).toHaveLength(24);
  });

  it('has bindings for all operations', () => {
    expect(ir.bindings.length).toBeGreaterThanOrEqual(24);
  });

  it('preserves dependency edges', () => {
    expect(ir.dependencies.length).toBe(5);
  });

  it('has no cycles', () => {
    expect(ir.quality.cyclicDependencies).toBe(0);
  });

  it('resolves database items to database resolver', () => {
    const dbOps = ir.operations.filter(o => o.resolver === 'database');
    expect(dbOps.length).toBeGreaterThan(0);
  });

  it('resolves account item to account resolver', () => {
    const acctOps = ir.operations.filter(o => o.resolver === 'account');
    expect(acctOps.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves token to api resolver', () => {
    const apiOps = ir.operations.filter(o => o.resolver === 'api');
    expect(apiOps.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves generated inputs to value-generator', () => {
    const genOps = ir.operations.filter(o => o.resolver === 'value-generator');
    expect(genOps.length).toBeGreaterThan(0);
  });

  it('inherits unresolved from data plan', () => {
    const inherited = ir.unresolved.filter(u => u.id.startsWith('INHERITED-'));
    expect(inherited.length).toBeGreaterThanOrEqual(1);
  });

  it('no hallucinated table names', () => {
    for (const op of ir.operations) {
      const params = JSON.stringify(op.parameters);
      // Should not contain guessed table names
      expect(params).not.toContain('"entity": "users"');
    }
  });

  it('all operations have valid data item references', () => {
    const dataItemIds = new Set(['DATA-0001','DATA-0002','DATA-0003','DATA-0004','DATA-0005','DATA-0006','DATA-0007','DATA-0008','DATA-0009','DATA-0010','DATA-0011','DATA-0012','DATA-0013','DATA-0014','DATA-0015','DATA-0016','DATA-0017','DATA-0018','DATA-0019','DATA-0020','DATA-0021','DATA-0022','DATA-0023','DATA-0024']);
    for (const op of ir.operations) {
      expect(dataItemIds.has(op.dataItemId)).toBe(true);
    }
  });

  it('derived chains: DATA-0017 consumes DATA-0016', () => {
    const op17 = ir.operations.find(o => o.dataItemId === 'DATA-0017');
    expect(op17?.consumes).toContain('runtime.DATA-0016');
  });

  it('configuration item resolved', () => {
    const configOps = ir.operations.filter(o => o.resolver === 'configuration');
    expect(configOps.length).toBeGreaterThanOrEqual(1);
  });
});
