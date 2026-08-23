// Test fixtures — shared builders for all test files.
//
// Provides factory functions for creating valid test inputs with sensible
// defaults. Each builder accepts partial overrides.

import type {
  ProjectExecutionProfile,
  ExecutionMappingIR,
  TestCaseExecutionMapping,
  TestCase,
  TestDataPlanIR,
  ExecutableDataPreparationIR,
  EndToEndRunnerPolicy,
  EndToEndRunnerInput,
  EndToEndRunnerOptions,
  EnvironmentSafety,
  MappingStatus,
  ClassificationExecutorType,
  TestRunResultIR,
  TestExecutionResultIR,
  TestRunSummary,
  ProjectCommandCatalog,
  InputArtifactHashes,
  RunnerAuditEvent,
  EndToEndRunResultIR,
  PreflightResult,
} from '../src/models.js';
import { defaultPolicy } from '../src/policy.js';

// ---- Profile fixture (spec §36-39) ----------------------------------------

export function makeProfile(overrides?: Partial<ProjectExecutionProfile>): ProjectExecutionProfile {
  return {
    schemaVersion: '1.0',
    project: {
      id: 'proj-001',
      name: 'Test Project',
      version: '1.0.0',
      root: '/tmp/test-project',
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
    },
    environment: {
      id: 'local',
      name: 'Local Development',
      safety: 'isolated',
      baseUrl: 'http://localhost:3000',
    },
    bindings: { definitions: [] },
    secrets: { references: [] },
    commands: { commands: [] },
    capabilities: {
      ui: true,
      api: true,
      database: true,
      multiTenant: false,
      localStart: true,
      testDataMutation: true,
      browserExecution: true,
      apiExecution: true,
      databaseExecution: true,
    },
    provenance: [{ source: 'test', adapterId: 'test-adapter' }],
    fingerprint: 'fp-abc123',
    ...overrides,
  } as ProjectExecutionProfile;
}

export function makeProductionProfile(): ProjectExecutionProfile {
  return makeProfile({
    environment: {
      id: 'prod',
      name: 'Production',
      safety: 'production' as EnvironmentSafety,
      baseUrl: 'https://prod.example.com',
    },
    fingerprint: 'fp-prod-001',
  });
}

export function makeSharedNonprodProfile(): ProjectExecutionProfile {
  return makeProfile({
    environment: {
      id: 'staging',
      name: 'Staging',
      safety: 'shared-nonprod' as EnvironmentSafety,
      baseUrl: 'https://staging.example.com',
    },
    fingerprint: 'fp-staging-001',
  });
}

// ---- TestCase fixture (spec §29-35) ---------------------------------------

let tcCounter = 0;
export function makeTestCase(overrides?: Partial<TestCase>): TestCase {
  tcCounter++;
  return {
    id: `TC-${String(tcCounter).padStart(4, '0')}`,
    scenarioId: 'SCN-001',
    requirementIds: ['REQ-001'],
    title: `Test Case ${tcCounter}`,
    objective: 'Verify something',
    type: 'ui',
    priority: 'medium',
    preconditions: [],
    inputs: [],
    dataNeeds: [],
    steps: [{ order: 1, action: 'Do something' }],
    expectedResults: [{ description: 'Something happens', verificationType: 'visual' }],
    cleanup: [],
    automation: 'ready',
    provenance: [{ requirementId: 'REQ-001' }],
    confidence: 0.9,
    ...overrides,
  } as TestCase;
}

export function resetTestCaseCounter(): void {
  tcCounter = 0;
}

export function makeTestCases(count: number, overrides?: Partial<TestCase>): TestCase[] {
  return Array.from({ length: count }, (_, i) =>
    makeTestCase({ id: `TC-${String(i + 1).padStart(4, '0')}`, ...overrides }),
  );
}

// ---- ExecutionMappingIR fixture (spec §40-44) -----------------------------

export function makeMapping(overrides?: Partial<TestCaseExecutionMapping>): TestCaseExecutionMapping {
  return {
    testCaseId: 'TC-0001',
    executorType: 'ui' as ClassificationExecutorType,
    confidence: 0.9,
    status: 'ready' as MappingStatus,
    source: [],
    unresolvedIds: [],
    provenance: [{ requirementId: 'REQ-001' }],
    ...overrides,
  };
}

export function makeMappings(overrides?: Partial<ExecutionMappingIR>): ExecutionMappingIR {
  return {
    schemaVersion: '1.0',
    testMappings: [makeMapping()],
    unresolved: [],
    catalogs: {},
    quality: { totalMappings: 1, readyMappings: 1, averageConfidence: 0.9 },
    ...overrides,
  } as ExecutionMappingIR;
}

export function makeMappingsForCases(testCases: TestCase[], status: MappingStatus = 'ready'): ExecutionMappingIR {
  return {
    schemaVersion: '1.0',
    testMappings: testCases.map((tc) =>
      makeMapping({ testCaseId: tc.id, status }),
    ),
    unresolved: [],
    catalogs: {},
    quality: {
      totalMappings: testCases.length,
      readyMappings: status === 'ready' ? testCases.length : 0,
      averageConfidence: 0.9,
    },
  } as ExecutionMappingIR;
}

// ---- TestDataPlanIR fixture (spec §45-49) ---------------------------------

export function makeDataPlan(overrides?: Partial<TestDataPlanIR>): TestDataPlanIR {
  return {
    schemaVersion: '1.0',
    testCases: [],
    dataItems: [
      {
        id: 'DI-001',
        name: 'test-user',
        description: 'A test user account',
        type: 'account',
        lifecycle: 'temporary',
        strategy: 'create-new',
      },
    ],
    dependencyGraph: [],
    reusableSets: [],
    unresolved: [],
    quality: { totalItems: 1, resolvedItems: 1, unresolvedItems: 0 },
    ...overrides,
  } as TestDataPlanIR;
}

// ---- Prepared data fixture ------------------------------------------------

export function makePreparedData(overrides?: Partial<ExecutableDataPreparationIR>): ExecutableDataPreparationIR {
  return {
    schemaVersion: '1.0',
    operations: [],
    runtimeBindings: [],
    cleanupOperations: [],
    quality: { totalOperations: 0, resolvedOperations: 0 },
    ...overrides,
  } as ExecutableDataPreparationIR;
}

// ---- Runner input fixture -------------------------------------------------

export function makeInput(overrides?: {
  profile?: ProjectExecutionProfile;
  testCases?: TestCase[];
  mappings?: ExecutionMappingIR;
  dataPlan?: TestDataPlanIR;
  preparedData?: ExecutableDataPreparationIR;
}): EndToEndRunnerInput {
  const testCases = overrides?.testCases ?? [makeTestCase()];
  return {
    profile: overrides?.profile ?? makeProfile(),
    testCases,
    mappings: overrides?.mappings ?? makeMappingsForCases(testCases),
    dataPlan: overrides?.dataPlan,
    preparedData: overrides?.preparedData,
  };
}

// ---- Policy fixture -------------------------------------------------------

export function makePolicy(overrides?: Partial<EndToEndRunnerPolicy>): EndToEndRunnerPolicy {
  return defaultPolicy(overrides);
}

export function makeExecutePolicy(overrides?: Partial<EndToEndRunnerPolicy>): EndToEndRunnerPolicy {
  return defaultPolicy({
    mode: 'execute',
    allowExecution: true,
    allowDatabaseMutation: true,
    allowApiMutation: true,
    allowBrowserExecution: true,
    allowCommands: true,
    ...overrides,
  });
}

// ---- Runner options fixture -----------------------------------------------

export function makeOptions(overrides?: Partial<EndToEndRunnerOptions>): EndToEndRunnerOptions {
  return {
    policy: makePolicy(),
    ...overrides,
  };
}

// ---- TestRunResultIR fixture ----------------------------------------------

export function makeTestRunResult(overrides?: Partial<TestRunResultIR>): TestRunResultIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    runId: 'RUN-001',
    mode: 'dry-run',
    startedAt: now,
    finishedAt: now,
    status: 'passed',
    testResults: [],
    summary: makeTestRunSummary(),
    evidence: [],
    auditTrail: [],
    ...overrides,
  };
}

export function makeTestRunSummary(overrides?: Partial<TestRunSummary>): TestRunSummary {
  return {
    testsTotal: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    manual: 0,
    errors: 0,
    assertionsTotal: 0,
    assertionsPassed: 0,
    assertionsFailed: 0,
    assertionsBlocked: 0,
    evidenceItems: 0,
    cleanupFailures: 0,
    provenanceCoverage: 0,
    durationMs: 0,
    ...overrides,
  };
}

export function makeTestExecutionResult(overrides?: Partial<TestExecutionResultIR>): TestExecutionResultIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    runId: 'RUN-001',
    testCaseId: 'TC-0001',
    scenarioId: 'SCN-001',
    requirementIds: ['REQ-001'],
    status: 'passed',
    phase: 'completed',
    steps: [],
    assertions: [],
    evidence: [],
    runtimeBindings: [],
    cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
    errors: [],
    warnings: [],
    provenance: [{ requirementId: 'REQ-001' }],
    timings: { startedAt: now, finishedAt: now, durationMs: 0 },
    ...overrides,
  };
}

// ---- Input hashes fixture -------------------------------------------------

export function makeInputHashes(overrides?: Partial<InputArtifactHashes>): InputArtifactHashes {
  return {
    profileFingerprint: 'fp-abc123',
    testCasesHash: 'hash-tc',
    mappingHash: 'hash-map',
    ...overrides,
  };
}

// ---- Command catalog fixture ----------------------------------------------

export function makeCommandCatalog(): ProjectCommandCatalog {
  return {
    commands: [
      {
        id: 'cmd-start',
        purpose: 'start',
        command: 'npm',
        args: ['start'],
        envRefs: [],
        safeForAutomation: true,
      },
      {
        id: 'cmd-build',
        purpose: 'build',
        command: 'npm',
        args: ['run', 'build'],
        envRefs: [],
        safeForAutomation: true,
      },
    ],
  };
}

// ---- Audit events fixture -------------------------------------------------

export function makeAuditEvents(count: number = 3): RunnerAuditEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    sequence: i,
    type: 'run-created' as const,
    timestamp: new Date().toISOString(),
    message: `Event ${i}`,
  }));
}

// ---- Full EndToEndRunResultIR fixture -------------------------------------

export function makeRunResult(overrides?: Partial<EndToEndRunResultIR>): EndToEndRunResultIR {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    runId: 'RUN-001',
    projectId: 'proj-001',
    environmentId: 'local',
    mode: 'dry-run',
    status: 'validated',
    preflight: { status: 'ready', checks: [], blockers: [], warnings: [] },
    runtime: { mode: 'external', started: false, ready: false, stopped: false },
    preparation: {
      status: 'skipped',
      operationsTotal: 0,
      operationsSucceeded: 0,
      operationsFailed: 0,
      bindingsProduced: 0,
      durationMs: 0,
      errors: [],
    },
    tests: makeTestRunResult(),
    cleanup: {
      testCleanup: { attempted: false, succeeded: true },
      dataCleanup: { attempted: false, succeeded: true },
      runtimeCleanup: { attempted: false, succeeded: true },
      failures: 0,
    },
    evidence: [],
    warnings: [],
    errors: [],
    quality: {
      testsTotal: 0,
      testsPassed: 0,
      testsFailed: 0,
      testsBlocked: 0,
      testsManual: 0,
      testsError: 0,
      assertionsTotal: 0,
      assertionsPassed: 0,
      assertionsFailed: 0,
      evidenceCount: 0,
      cleanupFailures: 0,
      provenanceCoverage: 0,
      durationMs: 0,
    },
    timings: {
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      preflightMs: 0,
      runtimeStartMs: 0,
      preparationMs: 0,
      executionMs: 0,
      cleanupMs: 0,
      reportingMs: 0,
    },
    inputHashes: makeInputHashes(),
    runnerVersion: '1.0.0',
    ...overrides,
  };
}

// ---- Preflight result fixture ---------------------------------------------

export function makePreflightResult(overrides?: Partial<PreflightResult>): PreflightResult {
  return {
    status: 'ready',
    checks: [],
    blockers: [],
    warnings: [],
    ...overrides,
  };
}
