// ---------------------------------------------------------------------------
// Test helpers – shared builders for data-resolver tests
// ---------------------------------------------------------------------------

import type {
  TestDataItem,
  TestDataPlanIR,
  EnvironmentProfile,
  EnvironmentResource,
  ResourceMapping,
  ResolutionContext,
  DataDependency,
  TestProvenance,
  DataConstraint,
} from '../src/models.js';

// ---- Minimal builders -----------------------------------------------------

export function minimalDataItem(overrides?: Partial<TestDataItem>): TestDataItem {
  return {
    id: 'DATA-0001',
    name: 'Test data item',
    description: 'A test data item',
    type: 'input',
    lifecycle: 'temporary',
    strategy: 'generate',
    constraints: [],
    dependencies: [],
    relatedTestCaseIds: [],
    relatedRequirementIds: [],
    relatedEntityIds: [],
    setup: [{ type: 'generate', description: 'Generate test data' }],
    cleanup: [{ type: 'delete', description: 'Delete test data' }],
    provenance: [],
    confidence: 0.7,
    ...overrides,
  };
}

export function minimalDataPlan(overrides?: Partial<TestDataPlanIR>): TestDataPlanIR {
  return {
    schemaVersion: '1.0',
    testCases: [],
    dataItems: [],
    dependencyGraph: [],
    reusableSets: [],
    unresolved: [],
    quality: {
      testCasesTotal: 0,
      testCasesWithCompleteDataPlan: 0,
      testCasesPartiallyPlanned: 0,
      dataItems: 0,
      reusableDataSets: 0,
      dependencies: 0,
      unresolved: 0,
      cyclicDependencies: 0,
      provenanceCoverage: 0,
      strategyCoverage: 0,
    },
    ...overrides,
  };
}

export function minimalEnvironment(overrides?: Partial<EnvironmentProfile>): EnvironmentProfile {
  return {
    id: 'test-env',
    resources: [],
    capabilities: [],
    ...overrides,
  };
}

export function dbResource(id = 'db-1'): EnvironmentResource {
  return {
    id,
    type: 'database',
    name: 'Test DB',
    capabilities: ['select', 'insert'],
    metadata: { engine: 'postgres' },
  };
}

export function apiResource(id = 'api-1'): EnvironmentResource {
  return {
    id,
    type: 'api',
    name: 'Test API',
    capabilities: ['GET', 'POST'],
    metadata: { baseUrl: 'http://localhost:3000' },
  };
}

export function fileResource(id = 'fs-1'): EnvironmentResource {
  return {
    id,
    type: 'filesystem',
    name: 'Test FS',
    capabilities: ['read', 'write'],
    metadata: { baseDir: '/tmp/test' },
  };
}

export function configResource(id = 'cfg-1'): EnvironmentResource {
  return {
    id,
    type: 'configuration',
    name: 'Test Config',
    capabilities: ['read', 'write'],
    metadata: {},
  };
}

export function stateResource(id = 'state-1'): EnvironmentResource {
  return {
    id,
    type: 'state-store',
    name: 'Test State',
    capabilities: ['read', 'write'],
    metadata: {},
  };
}

export function accountStoreResource(id = 'acct-1'): EnvironmentResource {
  return {
    id,
    type: 'account-store',
    name: 'Test Account Store',
    capabilities: ['create', 'read'],
    metadata: {},
  };
}

export function minimalContext(overrides?: Partial<ResolutionContext>): ResolutionContext {
  return {
    environment: minimalEnvironment(),
    dataItems: [],
    dependencies: [],
    mappings: [],
    options: { manualFallback: true },
    ...overrides,
  };
}

export function provenance(reqId = 'REQ-0001'): TestProvenance {
  return { requirementId: reqId };
}

export function constraint(desc: string, type: DataConstraint['type'] = 'other'): DataConstraint {
  return { type, description: desc, provenance: [] };
}

export function dependency(
  id: string,
  source: string,
  target: string,
  type: DataDependency['type'] = 'requires',
): DataDependency {
  return { id, sourceDataItemId: source, targetDataItemId: target, type };
}

export function mapping(logicalEntity: string, resourceId: string): ResourceMapping {
  return { logicalEntity, resourceId };
}
