import { describe, expect, it } from 'vitest';
import type {
  ExecutableDataPreparationIR,
  PreparationOperation,
} from 'data-resolver';
import type { TestDataItem } from 'test-data-planner';
import {
  DataNeedCoordinator,
  defaultCapabilities,
  buildRuntimeCapabilityInventory,
} from '../src/index.js';
import type {
  RuntimeCapabilityInventory,
  RuntimePreparationAdapter,
  RuntimePreparationRequest,
} from '../src/data/runtime-capability-inventory.js';
import {
  RuntimePreparationCoordinator,
  type PreparationMutationPolicy,
} from '../src/data/preparation-lifecycle.js';
import { RuntimeDataStore } from '../src/data/runtime-data-store.js';

function item(overrides: Partial<TestDataItem> = {}): TestDataItem {
  return {
    id: 'DATA-ORDER',
    name: 'approved-order',
    description: 'An order prepared for the test',
    type: 'external-response',
    lifecycle: 'temporary',
    strategy: 'create-new',
    constraints: [],
    dependencies: [],
    relatedTestCaseIds: ['TC-ORDER'],
    relatedRequirementIds: ['REQ-ORDER'],
    relatedEntityIds: ['Order'],
    setup: [{ type: 'create', description: 'Create an order through the fixture API', executorHint: 'api' }],
    cleanup: [{ type: 'delete', description: 'Delete the test-owned order' }],
    provenance: [{ requirementId: 'REQ-ORDER' }],
    confidence: 1,
    ...overrides,
  };
}

function operation(overrides: Partial<PreparationOperation> = {}): PreparationOperation {
  return {
    id: 'OP-DATA-ORDER',
    dataItemId: 'DATA-ORDER',
    resolver: 'api',
    action: 'create',
    resourceId: 'api-test',
    parameters: { resource: 'orders' },
    produces: ['runtime.DATA-ORDER'],
    consumes: [],
    cleanupOperationIds: [],
    provenance: [{ requirementId: 'REQ-ORDER' }],
    confidence: 1,
    idempotency: { mode: 'unique-per-run' },
    resolverSpec: {
      operationId: 'OP-DATA-ORDER',
      resource: 'orders',
      methodIntent: 'POST',
      requestDataBindings: [],
      responseBindings: ['runtime.DATA-ORDER'],
    },
    ...overrides,
  };
}

function plan(operations: PreparationOperation[], dependencies: ExecutableDataPreparationIR['dependencies'] = []): ExecutableDataPreparationIR {
  return {
    schemaVersion: '1.0',
    environmentProfileId: 'ENV-TEST',
    operations,
    bindings: [],
    dependencies,
    unresolved: [],
    quality: {
      dataItemsTotal: operations.length,
      resolved: 0,
      partiallyResolved: 0,
      unresolved: 0,
      operations: operations.length,
      automatedOperations: operations.length,
      manualOperations: 0,
      bindings: operations.length,
      dependencyEdges: dependencies.length,
      cyclicDependencies: 0,
      provenanceCoverage: 1,
    },
  };
}

function blockedResolution(dataItemId: string) {
  return {
    dataItemId,
    status: 'BLOCKED' as const,
    semantics: 'SYNTHETIC_ALLOWED' as const,
    sensitive: false,
    evidence: [],
    resolved: false,
    reason: 'fixture requires preparation',
    unresolvedReason: 'fixture requires preparation',
  };
}

function apiInventory(adapter: RuntimePreparationAdapter, operationIds: string[]): RuntimeCapabilityInventory {
  return buildRuntimeCapabilityInventory(defaultCapabilities(), {
    environmentKind: 'test',
    environment: {
      id: 'ENV-TEST',
      resources: [{ id: 'api-test', type: 'api', name: 'Test fixture API', capabilities: ['read', 'mutate'], metadata: {} }],
      capabilities: [],
    },
    api: {
      available: true,
      readable: true,
      mutable: true,
      allowedOperationIds: operationIds,
      preparation: adapter,
    },
  });
}

function databaseInventory(adapter: RuntimePreparationAdapter, _operationIds: string[]): RuntimeCapabilityInventory {
  return buildRuntimeCapabilityInventory(defaultCapabilities(), {
    environmentKind: 'test',
    environment: {
      id: 'ENV-TEST',
      resources: [{ id: 'db-test', type: 'database', name: 'Mapped test database', capabilities: ['select', 'write'], metadata: {} }],
      capabilities: [],
    },
    resourceMappings: [{ logicalEntity: 'Order', resourceId: 'db-test', fieldMappings: { status: 'status' } }],
    database: {
      available: true,
      readable: true,
      writable: true,
      resourceIds: ['db-test'],
      mappings: [{ logicalEntity: 'Order', resourceId: 'db-test', fieldMappings: { status: 'status' } }],
      preparation: adapter,
    },
  });
}

function fixtureAdapter(options: {
  failFor?: string;
  cleanupFails?: boolean;
  withSnapshot?: boolean;
  secret?: boolean;
} = {}) {
  const prepared: string[] = [];
  const cleaned: string[] = [];
  const restored: string[] = [];
  const requests: RuntimePreparationRequest[] = [];
  const adapter: RuntimePreparationAdapter = {
    async prepare(request) {
      requests.push(request);
      if (options.failFor === request.item.id) throw new Error('fixture mutation failed');
      prepared.push(request.item.id);
      return {
        value: options.secret ? 'super-secret-token' : { id: `${request.item.id}-fixture`, status: 'APPROVED' },
        ownership: request.snapshotRef ? 'TEMPORARILY_MODIFIED' : 'TEST_OWNED',
        cleanupRef: request.snapshotRef ? undefined : `${request.item.id}-fixture`,
        sensitive: options.secret,
        evidence: [{
          kind: request.operation.resolver === 'api' ? 'api' : 'database',
          description: options.secret
            ? 'Adapter saw super-secret-token while creating the binding.'
            : 'Fixture adapter returned a redacted resource binding.',
        }],
      };
    },
    async snapshot(request) {
      if (!options.withSnapshot) return undefined;
      return { snapshotRef: `SNAPSHOT-${request.item.id}` };
    },
    async cleanup(request) {
      cleaned.push(request.item.id);
      if (options.cleanupFails) throw new Error('cleanup failed');
    },
    async restore(request) {
      restored.push(request.item.id);
    },
  };
  return { adapter, prepared, cleaned, restored, requests };
}

async function prepareDirect(
  items: TestDataItem[],
  operations: PreparationOperation[],
  inventory: RuntimeCapabilityInventory,
  policy: Partial<PreparationMutationPolicy>,
  dependencies: ExecutableDataPreparationIR['dependencies'] = [],
) {
  const runtimeData = new RuntimeDataStore();
  const coordinator = new RuntimePreparationCoordinator({ inventory, policy });
  const result = await coordinator.prepare({
    items,
    plan: plan(operations, dependencies),
    resolutions: items.map((candidate) => blockedResolution(candidate.id)),
    runtimeData,
    runId: 'RUN-PREP-001',
  });
  return { coordinator, result };
}

describe('Phase 2B.3 preparation lifecycle', () => {
  it('reuses an existing fixture without registering cleanup', async () => {
    const discovery = async () => ({
      value: { id: 'existing-order', status: 'APPROVED' },
      evidence: [{ kind: 'database' as const, description: 'Mapped order fixture discovered.' }],
    });
    const inventory = buildRuntimeCapabilityInventory(defaultCapabilities(), {
      environmentKind: 'test',
      environment: {
        id: 'ENV-TEST',
        resources: [{ id: 'db-test', type: 'database', name: 'DB', capabilities: ['select'], metadata: {} }],
        capabilities: [],
      },
      resourceMappings: [{ logicalEntity: 'Order', resourceId: 'db-test' }],
      database: { available: true, readable: true, writable: false, mappings: [{ logicalEntity: 'Order', resourceId: 'db-test' }], discovery },
    });
    const result = await new DataNeedCoordinator({ inventory }).prepare([item({ strategy: 'select-existing', lifecycle: 'existing', setup: [{ type: 'select', description: 'Select order', executorHint: 'database' }] })]);

    expect(result.status).toBe('ready');
    expect(result.resolutions[0]?.status).toBe('DISCOVERED');
    expect(result.resolutions[0]?.preparation?.kind).toBe('REUSED');
    expect(result.preparation?.cleanup.registered).toBe(0);
  });

  it('creates an API fixture only through an allowlisted operation and cleans it', async () => {
    const fixture = fixtureAdapter();
    const coordinator = new DataNeedCoordinator({
      inventory: apiInventory(fixture.adapter, ['OP-DATA-ORDER']),
      preparationPolicy: { environment: 'test', allowApiCreate: true },
    });
    const result = await coordinator.prepare([item()]);

    expect(result.status).toBe('ready');
    expect(result.resolutions[0]?.preparation?.kind).toBe('CREATED');
    expect(result.metrics.resolvedDataNeeds).toBe(1);
    expect(result.runtimeData.resolve('runtime.DATA-ORDER')).toEqual({ id: 'DATA-ORDER-fixture', status: 'APPROVED' });
    expect(fixture.prepared).toEqual(['DATA-ORDER']);
    const cleanup = await coordinator.cleanup();
    expect(cleanup.succeeded).toBe(1);
    expect(fixture.cleaned).toEqual(['DATA-ORDER']);
  });

  it('denies mutation when write policy is not explicit', async () => {
    const fixture = fixtureAdapter();
    const result = await prepareDirect(
      [item()],
      [operation()],
      apiInventory(fixture.adapter, ['OP-DATA-ORDER']),
      { environment: 'test' },
    );

    expect(result.result.status).toBe('blocked');
    expect(result.result.resolutions[0]?.status).toBe('BLOCKED');
    expect(fixture.prepared).toHaveLength(0);
  });

  it('denies an API mutation when its operation is not allowlisted', async () => {
    const fixture = fixtureAdapter();
    const result = await prepareDirect(
      [item()],
      [operation()],
      apiInventory(fixture.adapter, []),
      { environment: 'test', allowApiCreate: true },
    );

    expect(result.result.status).toBe('blocked');
    expect(result.result.resolutions[0]?.reason).toContain('allowlisted');
    expect(fixture.prepared).toHaveLength(0);
  });

  it('denies mutation in production and unknown environments', async () => {
    const production = fixtureAdapter();
    const productionInventory = { ...apiInventory(production.adapter, ['OP-DATA-ORDER']), environmentKind: 'production' as const };
    const productionResult = await prepareDirect([item()], [operation()], productionInventory, { environment: 'production', allowApiCreate: true });
    expect(productionResult.result.status).toBe('blocked');
    expect(production.prepared).toHaveLength(0);

    const unknown = fixtureAdapter();
    const unknownInventory = { ...apiInventory(unknown.adapter, ['OP-DATA-ORDER']), environmentKind: 'unknown' as const };
    const unknownResult = await prepareDirect([item()], [operation()], unknownInventory, { allowApiCreate: true });
    expect(unknownResult.result.status).toBe('blocked');
    expect(unknown.prepared).toHaveLength(0);
  });

  it('requires a snapshot before temporarily updating an existing record', async () => {
    const fixture = fixtureAdapter({ withSnapshot: true });
    const temporaryOperation = operation({
      dataItemId: 'DATA-TEMP-ORDER',
      id: 'OP-DATA-TEMP-ORDER',
      resolver: 'database',
      resourceId: 'db-test',
      parameters: { entity: 'Order' },
      resolverSpec: { mode: 'update', entity: 'Order', criteria: [], values: [], bindings: [] },
    });
    const result = await prepareDirect(
      [item({ id: 'DATA-TEMP-ORDER', strategy: 'select-existing', lifecycle: 'existing' })],
      [temporaryOperation],
      databaseInventory(fixture.adapter, ['OP-DATA-ORDER']),
      { environment: 'test', allowDatabaseUpdate: true, allowTemporaryUpdate: true },
    );

    expect(result.result.status).toBe('ready');
    expect(result.result.resolutions[0]?.preparation?.kind).toBe('TEMPORARILY_MODIFIED');
    expect(fixture.requests[0]?.snapshotRef).toBe('SNAPSHOT-DATA-TEMP-ORDER');
    const cleanup = await result.coordinator.cleanup();
    expect(cleanup.succeeded).toBe(1);
    expect(fixture.restored).toEqual(['DATA-TEMP-ORDER']);
    expect(fixture.cleaned).toHaveLength(0);
  });

  it('blocks an update before mutation when snapshot is unavailable', async () => {
    const fixture = fixtureAdapter({ withSnapshot: false });
    const temporaryOperation = operation({
      dataItemId: 'DATA-ORDER',
      resolver: 'database',
      resourceId: 'db-test',
      parameters: { entity: 'Order' },
      resolverSpec: { mode: 'update', entity: 'Order', criteria: [], values: [], bindings: [] },
    });
    const result = await prepareDirect([item()], [temporaryOperation], databaseInventory(fixture.adapter, ['OP-DATA-ORDER']), {
      environment: 'test', allowDatabaseUpdate: true, allowTemporaryUpdate: true,
    });

    expect(result.result.status).toBe('blocked');
    expect(result.result.resolutions[0]?.reason).toContain('snapshot');
    expect(fixture.prepared).toHaveLength(0);
  });

  it('cleans partial preparation failures in reverse dependency order', async () => {
    const fixture = fixtureAdapter({ failFor: 'DATA-ORDER-2' });
    const first = item({ id: 'DATA-ORDER-1', dependencies: [] });
    const second = item({ id: 'DATA-ORDER-2', dependencies: ['DATA-ORDER-1'] });
    const firstOp = operation({ id: 'OP-DATA-ORDER-1', dataItemId: 'DATA-ORDER-1' });
    const secondOp = operation({ id: 'OP-DATA-ORDER-2', dataItemId: 'DATA-ORDER-2' });
    const result = await prepareDirect(
      [first, second],
      [firstOp, secondOp],
      apiInventory(fixture.adapter, ['OP-DATA-ORDER-1', 'OP-DATA-ORDER-2']),
      { environment: 'test', allowApiCreate: true },
      [{ id: 'DEP-1', sourceOperationId: firstOp.id, targetOperationId: secondOp.id, type: 'requires' }],
    );

    expect(result.result.status).toBe('error');
    expect(result.result.cleanup.succeeded).toBe(1);
    expect(fixture.cleaned).toEqual(['DATA-ORDER-1']);
  });

  it('cleans earlier owned resources when a later preparation is blocked', async () => {
    const fixture = fixtureAdapter();
    const first = item({ id: 'DATA-ORDER-1', dependencies: [] });
    const second = item({ id: 'DATA-ORDER-2', dependencies: ['DATA-ORDER-1'] });
    const firstOp = operation({ id: 'OP-DATA-ORDER-1', dataItemId: 'DATA-ORDER-1' });
    const blockedOp = operation({
      id: 'OP-DATA-ORDER-2',
      dataItemId: 'DATA-ORDER-2',
      resolver: 'unknown',
      action: 'unknown',
    });
    const result = await prepareDirect(
      [first, second],
      [firstOp, blockedOp],
      apiInventory(fixture.adapter, ['OP-DATA-ORDER-1']),
      { environment: 'test', allowApiCreate: true },
      [{ id: 'DEP-1', sourceOperationId: firstOp.id, targetOperationId: blockedOp.id, type: 'requires' }],
    );

    expect(result.result.status).toBe('blocked');
    expect(result.result.cleanup.succeeded).toBe(1);
    expect(result.result.cleanup.orphaned).toBe(0);
    expect(fixture.cleaned).toEqual(['DATA-ORDER-1']);
  });

  it('cleans successful resources in reverse dependency order', async () => {
    const fixture = fixtureAdapter();
    const customer = item({ id: 'DATA-CUSTOMER', dependencies: [] });
    const order = item({ id: 'DATA-ORDER-CHAIN', dependencies: ['DATA-CUSTOMER'] });
    const line = item({ id: 'DATA-LINE', dependencies: ['DATA-ORDER-CHAIN'] });
    const customerOp = operation({ id: 'OP-CUSTOMER', dataItemId: 'DATA-CUSTOMER' });
    const orderOp = operation({ id: 'OP-ORDER-CHAIN', dataItemId: 'DATA-ORDER-CHAIN' });
    const lineOp = operation({ id: 'OP-LINE', dataItemId: 'DATA-LINE' });
    const result = await prepareDirect(
      [line, order, customer],
      [lineOp, orderOp, customerOp],
      apiInventory(fixture.adapter, ['OP-CUSTOMER', 'OP-ORDER-CHAIN', 'OP-LINE']),
      { environment: 'test', allowApiCreate: true },
      [
        { id: 'DEP-CO', sourceOperationId: customerOp.id, targetOperationId: orderOp.id, type: 'requires' },
        { id: 'DEP-OL', sourceOperationId: orderOp.id, targetOperationId: lineOp.id, type: 'requires' },
      ],
    );

    expect(result.result.status).toBe('ready');
    const cleanup = await result.coordinator.cleanup();
    expect(cleanup.succeeded).toBe(3);
    expect(fixture.cleaned).toEqual(['DATA-LINE', 'DATA-ORDER-CHAIN', 'DATA-CUSTOMER']);
  });

  it('surfaces cleanup failure instead of reporting a clean pass', async () => {
    const fixture = fixtureAdapter({ cleanupFails: true });
    const result = await prepareDirect([item()], [operation()], apiInventory(fixture.adapter, ['OP-DATA-ORDER']), {
      environment: 'test', allowApiCreate: true,
    });
    const cleanup = await result.coordinator.cleanup();

    expect(cleanup.failed).toBe(1);
    expect(cleanup.orphaned).toBe(1);
    expect(cleanup.results[0]?.status).toBe('failed');
  });

  it('requires a database mapping and never accepts generated SQL', async () => {
    const fixture = fixtureAdapter();
    const dbOperation = operation({
      resolver: 'database',
      resourceId: 'db-test',
      parameters: { entity: 'Order' },
      resolverSpec: { mode: 'insert', entity: 'Order', values: [], criteria: [], bindings: [] },
    });
    const result = await prepareDirect([item()], [dbOperation], databaseInventory(fixture.adapter, ['OP-DATA-ORDER']), {
      environment: 'test', allowDatabaseInsert: true,
    });

    expect(result.result.status).toBe('ready');
    expect(fixture.requests[0]?.operation.resolverSpec).toEqual(expect.objectContaining({ entity: 'Order' }));
    expect(JSON.stringify(fixture.requests[0]?.operation)).not.toContain('SELECT');
  });

  it('prefers an explicitly mapped domain API over a raw database mutation', async () => {
    const apiFixture = fixtureAdapter();
    const dbFixture = fixtureAdapter();
    const dbOnly = databaseInventory(dbFixture, ['OP-DATA-ORDER']);
    const inventory: RuntimeCapabilityInventory = {
      ...dbOnly,
      environment: {
        ...dbOnly.environment!,
        resources: [
          ...dbOnly.environment!.resources,
          { id: 'api-test', type: 'api', name: 'Domain fixture API', capabilities: ['mutate'], metadata: {} },
        ],
      },
      api: {
        available: true,
        readable: true,
        mutable: true,
        allowedOperationIds: ['OP-DATA-ORDER'],
        preferredOperationIds: ['OP-DATA-ORDER'],
        preparation: apiFixture.adapter,
      },
    };
    const dbOperation = operation({
      resolver: 'database',
      resourceId: 'db-test',
      parameters: { entity: 'Order' },
      resolverSpec: { mode: 'insert', entity: 'Order', values: [], criteria: [], bindings: [] },
    });
    const result = await prepareDirect([item()], [dbOperation], inventory, {
      environment: 'test',
      allowApiCreate: true,
      allowDatabaseInsert: false,
    });

    expect(result.result.status).toBe('ready');
    expect(apiFixture.prepared).toEqual(['DATA-ORDER']);
    expect(dbFixture.prepared).toHaveLength(0);
    expect(result.result.proofs[0]?.executor).toBe('api');
  });

  it('keeps sensitive prepared values out of proofs and journal snapshots', async () => {
    const fixture = fixtureAdapter({ secret: true });
    const result = await prepareDirect([item({ name: 'auth-token', description: 'Temporary credential token' })], [operation()], apiInventory(fixture.adapter, ['OP-DATA-ORDER']), {
      environment: 'test', allowApiCreate: true,
    });

    expect(result.result.proofs[0]).not.toHaveProperty('value');
    expect(JSON.stringify(result.result.proofs)).not.toContain('super-secret-token');
    expect(JSON.stringify(result.result.journal.safeSnapshot())).not.toContain('super-secret-token');
    expect(result.result.resolutions[0]?.value).toBeUndefined();
    expect(result.result.runtimeData.resolve('runtime.DATA-ORDER')).toBe('super-secret-token');
  });

  it('does not retry an ambiguous mutation timeout', async () => {
    let calls = 0;
    const adapter: RuntimePreparationAdapter = {
      async prepare() {
        calls++;
        throw new Error('request timed out after possible side effect');
      },
      async cleanup() {},
    };
    const result = await prepareDirect([item()], [operation()], apiInventory(adapter, ['OP-DATA-ORDER']), {
      environment: 'test', allowApiCreate: true,
    });

    expect(result.result.status).toBe('error');
    expect(calls).toBe(1);
  });
});
