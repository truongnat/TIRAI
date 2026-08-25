// ---------------------------------------------------------------------------
// Phase 2B.2 deterministic data capability acceptance
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { SecretProvider } from 'execution-engine';
import type { TestDataItem } from 'test-data-planner';
import { DataNeedCoordinator } from '../src/data/data-need-coordinator.js';
import {
  buildRuntimeCapabilityInventory,
  type RuntimeCapabilityInventory,
} from '../src/data/runtime-capability-inventory.js';
import { defaultCapabilities } from '../src/models.js';

function item(overrides: Partial<TestDataItem> = {}): TestDataItem {
  return {
    id: 'DATA-001',
    name: 'data-item',
    description: 'Synthetic input',
    type: 'input',
    lifecycle: 'generated',
    strategy: 'generate',
    constraints: [],
    dependencies: [],
    relatedTestCaseIds: ['TC-001'],
    relatedRequirementIds: ['REQ-001'],
    relatedEntityIds: [],
    setup: [{ type: 'generate', description: 'Generate safely' }],
    cleanup: [],
    provenance: [{ requirementId: 'REQ-001' }],
    confidence: 1,
    ...overrides,
  };
}

function inventory(overrides: Partial<RuntimeCapabilityInventory> = {}): RuntimeCapabilityInventory {
  return buildRuntimeCapabilityInventory(defaultCapabilities(), overrides);
}

function databaseInventory(
  discover: NonNullable<RuntimeCapabilityInventory['database']['discovery']>,
): RuntimeCapabilityInventory {
  return inventory({
    environment: {
      id: 'ENV-DB',
      resources: [{
        id: 'db-test',
        type: 'database',
        name: 'Mapped test database',
        capabilities: ['select'],
        metadata: {},
      }],
      capabilities: [],
    },
    resourceMappings: [{ logicalEntity: 'User', resourceId: 'db-test', fieldMappings: { username: 'username' } }],
    database: {
      available: true,
      readable: true,
      writable: false,
      resourceIds: ['db-test'],
      mappings: [{ logicalEntity: 'User', resourceId: 'db-test', fieldMappings: { username: 'username' } }],
      discovery: discover,
    },
  });
}

function apiInventory(
  discover: NonNullable<RuntimeCapabilityInventory['api']['discovery']>,
): RuntimeCapabilityInventory {
  return inventory({
    environment: {
      id: 'ENV-API',
      resources: [{
        id: 'api-test',
        type: 'api',
        name: 'Mapped test API',
        capabilities: ['read'],
        metadata: {},
      }],
      capabilities: [],
    },
    api: {
      available: true,
      readable: true,
      mutable: false,
      allowedOperationIds: ['OP-DATA-API-001'],
      discovery: discover,
    },
  });
}

describe('DataNeedCoordinator', () => {
  it('resolves a supplied existing account and generates an invalid password', async () => {
    const account = item({
      id: 'DATA-ACCOUNT',
      name: 'valid-username',
      description: 'Valid existing login account username',
      type: 'account',
      lifecycle: 'existing',
      strategy: 'reuse-existing',
    });
    const password = item({
      id: 'DATA-INVALID-PASSWORD',
      name: 'invalid-password',
      description: 'Invalid password for negative login',
      strategy: 'generate',
    });

    const result = await new DataNeedCoordinator({
      inventory: inventory(),
      generationSeed: 'acceptance',
    }).resolve([account, password], {
      inputs: [{ name: 'valid-username', value: 'demo', valueStrategy: 'valid' }],
    });

    expect(result.status).toBe('ready');
    expect(result.resolutions.map((resolution) => resolution.status)).toEqual(['RESOLVED', 'GENERATED']);
    expect(result.resolutions[0]?.source).toBe('supplied-input');
    expect(result.resolutions[1]?.source).toBe('generator');
    expect(result.runtimeData.resolve('DATA-ACCOUNT')).toBe('demo');
    expect(result.runtimeData.resolve('DATA-INVALID-PASSWORD')).toBeTruthy();
    expect(result.metrics.generatedDataNeeds).toBe(1);
  });

  it('blocks an existing account without a discovery capability and never generates it', async () => {
    const result = await new DataNeedCoordinator({ inventory: inventory() }).resolve([
      item({
        id: 'DATA-ACCOUNT',
        name: 'valid-username',
        description: 'Valid existing account username',
        type: 'account',
        lifecycle: 'existing',
        strategy: 'reuse-existing',
      }),
    ]);

    expect(result.status).toBe('blocked');
    expect(result.resolutions[0]?.status).toBe('NEEDS_CAPABILITY');
    expect(result.resolutions[0]?.status).not.toBe('GENERATED');
    expect(result.runtimeData.resolve('DATA-ACCOUNT')).toBeUndefined();
  });

  it('discovers an existing database record only through an explicit mapping', async () => {
    let calls = 0;
    const result = await new DataNeedCoordinator({
      inventory: databaseInventory(async (request) => {
        calls++;
        expect(request.operation?.resourceId).toBe('db-test');
        expect(request.operation?.resolver).toBe('database');
        return {
          value: 'demo',
          evidence: [{ kind: 'database', description: 'Mapped User record matched username constraint.' }],
        };
      }),
    }).resolve([item({
      id: 'DATA-DB-001',
      name: 'valid-user',
      description: 'Existing valid customer account',
      type: 'database-record',
      lifecycle: 'existing',
      strategy: 'select-existing',
      relatedEntityIds: ['User'],
      constraints: [{ type: 'value', field: 'username', operator: 'equals', value: 'demo', description: 'username equals demo', provenance: [] }],
      setup: [{ type: 'select', description: 'Select User', executorHint: 'database' }],
    })]);

    expect(result.status).toBe('ready');
    expect(result.resolutions[0]?.status).toBe('DISCOVERED');
    expect(result.resolutions[0]?.source).toBe('database');
    expect(result.runtimeData.resolve('runtime.DATA-DB-001')).toBe('demo');
    expect(result.metrics.databaseDiscoveryCalls).toBe(1);
    expect(calls).toBe(1);
  });

  it('does not call a database adapter when read capability is unavailable', async () => {
    let calls = 0;
    const result = await new DataNeedCoordinator({
      inventory: inventory({
        database: {
          available: true,
          readable: false,
          writable: false,
          discovery: async () => {
            calls++;
            return undefined;
          },
        },
      }),
    }).resolve([item({
      id: 'DATA-DB-002',
      name: 'existing-order',
      description: 'Existing approved order',
      type: 'database-record',
      lifecycle: 'existing',
      strategy: 'select-existing',
      relatedEntityIds: ['Order'],
      setup: [{ type: 'select', description: 'Select Order', executorHint: 'database' }],
    })]);

    expect(result.status).toBe('blocked');
    expect(result.resolutions[0]?.status).toBe('NEEDS_CAPABILITY');
    expect(calls).toBe(0);
    expect(result.metrics.databaseDiscoveryCalls).toBe(0);
  });

  it('discovers an API resource only through an allowlisted operation', async () => {
    let calls = 0;
    const result = await new DataNeedCoordinator({
      inventory: apiInventory(async (request) => {
        calls++;
        expect(request.operation?.id).toBe('OP-DATA-API-001');
        return {
          value: 'customer-001',
          evidence: [{ kind: 'api', description: 'Explicit GET operation returned the existing customer.' }],
        };
      }),
    }).resolve([item({
      id: 'DATA-API-001',
      name: 'existing-customer',
      description: 'Existing customer resource',
      type: 'external-response',
      lifecycle: 'existing',
      strategy: 'select-existing',
      setup: [{ type: 'select', description: 'Read customer', executorHint: 'api' }],
    })]);

    expect(result.status).toBe('ready');
    expect(result.resolutions[0]?.status).toBe('DISCOVERED');
    expect(result.resolutions[0]?.source).toBe('api');
    expect(result.metrics.apiDiscoveryCalls).toBe(1);
    expect(calls).toBe(1);
  });

  it('does not call an API adapter when the operation is not allowlisted', async () => {
    let calls = 0;
    const result = await new DataNeedCoordinator({
      inventory: inventory({
        environment: {
          id: 'ENV-API-NO',
          resources: [{ id: 'api-test', type: 'api', name: 'API', capabilities: ['read'], metadata: {} }],
          capabilities: [],
        },
        api: {
          available: true,
          readable: true,
          mutable: false,
          allowedOperationIds: [],
          discovery: async () => {
            calls++;
            return undefined;
          },
        },
      }),
    }).resolve([item({
      id: 'DATA-API-002',
      name: 'existing-resource',
      description: 'Existing external resource',
      type: 'external-response',
      lifecycle: 'existing',
      strategy: 'select-existing',
      setup: [{ type: 'select', description: 'Read resource', executorHint: 'api' }],
    })]);

    expect(result.resolutions[0]?.status).toBe('NEEDS_CAPABILITY');
    expect(calls).toBe(0);
  });

  it('uses the existing Data Resolver value-generator plan for synthetic data', async () => {
    const result = await new DataNeedCoordinator({
      inventory: inventory(),
      generationSeed: 'stable-seed',
    }).resolve([item({
      id: 'DATA-GENERATED-001',
      name: 'unique-email',
      description: 'Unique generated email',
      type: 'input',
      strategy: 'generate',
    })]);

    expect(result.resolutions[0]?.status).toBe('GENERATED');
    expect(result.plan.operations[0]?.resolver).toBe('value-generator');
    expect(result.runtimeData.resolve('DATA-GENERATED-001')).toBeTruthy();
  });

  it('never generates an existing customer', async () => {
    const result = await new DataNeedCoordinator({ inventory: inventory() }).resolve([item({
      id: 'DATA-CUSTOMER-001',
      name: 'customer',
      description: 'Existing customer in APPROVED state',
      type: 'database-record',
      lifecycle: 'existing',
      strategy: 'unknown',
    })]);

    expect(result.resolutions[0]?.status).toBe('NEEDS_CAPABILITY');
    expect(result.resolutions[0]?.status).not.toBe('GENERATED');
  });

  it('keeps secret values in protected runtime memory only', async () => {
    const secret = 'super-secret-password';
    const secretProvider: SecretProvider = {
      async resolve() {
        return { value: secret, redacted: '***' };
      },
    };
    const result = await new DataNeedCoordinator({ inventory: inventory() }).resolve([item({
      id: 'DATA-SECRET-001',
      name: 'invalid-password',
      description: 'Invalid password credential',
      strategy: 'generate',
    })], {
      inputs: [{ name: 'invalid-password', value: 'secret://login/password' }],
      secretProvider,
    });

    expect(result.resolutions[0]?.status).toBe('RESOLVED');
    expect(result.resolutions[0]?.value).toBeUndefined();
    expect(JSON.stringify(result.resolutions)).not.toContain(secret);
    expect(JSON.stringify(result.runtimeData.safeSnapshot())).not.toContain(secret);
    expect(result.runtimeData.resolve('DATA-SECRET-001')).toBe(secret);
    result.runtimeData.clear();
    expect(result.runtimeData.resolve('DATA-SECRET-001')).toBeUndefined();
  });

  it('does not fall back to generation when an explicit secret reference is unavailable', async () => {
    const result = await new DataNeedCoordinator({ inventory: inventory() }).resolve([item({
      id: 'DATA-MISSING-SECRET',
      name: 'invalid-password',
      description: 'Invalid password credential',
      strategy: 'generate',
    })], {
      inputs: [{ name: 'invalid-password', value: 'secret://login/missing-password' }],
      secretProvider: {
        async resolve() {
          throw new Error('secret unavailable');
        },
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.resolutions[0]?.status).toBe('NEEDS_CAPABILITY');
    expect(result.resolutions[0]?.source).toBe('secret');
    expect(result.resolutions[0]?.status).not.toBe('GENERATED');
    expect(result.runtimeData.resolve('DATA-MISSING-SECRET')).toBeUndefined();
  });

  it('resolves dependencies in producer-before-consumer order', async () => {
    const account = item({
      id: 'DATA-PRODUCER',
      name: 'account',
      description: 'Supplied account',
      type: 'account',
      lifecycle: 'existing',
      strategy: 'reuse-existing',
    });
    const derived = item({
      id: 'DATA-CONSUMER',
      name: 'derived-token',
      description: 'Derived generated input',
      strategy: 'derive',
      dependencies: ['DATA-PRODUCER'],
    });
    const result = await new DataNeedCoordinator({ inventory: inventory(), generationSeed: 'dependency-seed' }).resolve(
      [derived, account],
      { inputs: [{ name: 'account', value: 'demo' }] },
    );

    expect(result.status).toBe('ready');
    expect(result.resolutions.map((resolution) => resolution.dataItemId)).toEqual(['DATA-PRODUCER', 'DATA-CONSUMER']);
    expect(result.runtimeData.resolve('DATA-CONSUMER')).toBe('demo');
  });

  it('propagates unexpected discovery failures for ERROR handling', async () => {
    await expect(new DataNeedCoordinator({
      inventory: databaseInventory(async () => {
        throw new Error('database connection failed');
      }),
    }).resolve([item({
      id: 'DATA-DB-ERROR',
      name: 'existing-user',
      description: 'Existing User',
      type: 'database-record',
      lifecycle: 'existing',
      strategy: 'select-existing',
      relatedEntityIds: ['User'],
      setup: [{ type: 'select', description: 'Select User', executorHint: 'database' }],
    })])).rejects.toThrow('Runtime database capability failed');
  });
});
