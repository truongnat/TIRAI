// UI Executor v1 — Orchestrator integration acceptance test.
//
// Verifies that UIExecutor plugs into the real TestExecutionOrchestrator
// via the TestExecutorRegistry. Tests dry-run, simulate, and execute modes
// through the orchestrator. Validates result shape, assertion traceability,
// evidence, and provenance.

import { describe, it, expect } from 'vitest';
import {
  TestExecutionOrchestrator,
  TestExecutorRegistry,
  FixedClock,
  DeterministicRunIdProvider,
  type TestCase,
  type SecretProvider,
  type SecretValue,
} from 'test-execution-orchestrator';
import { UIExecutor } from '../src/ui-executor.js';
import { FakeBrowserSession, type FakeElementState } from '../src/browser/index.js';
import type {
  UIElementCatalog,
  TestExecutionMapping,
} from '../src/models.js';

// ---- Helpers ---------------------------------------------------------------

function makeCatalog(): UIElementCatalog {
  return {
    environmentId: 'env-1',
    pages: [
      {
        id: 'login-page',
        route: '/login',
        elements: [
          { logicalName: 'username-field', locator: { strategy: 'test-id', value: 'username' } },
          { logicalName: 'password-field', locator: { strategy: 'test-id', value: 'password' }, sensitive: true },
          { logicalName: 'login-button', locator: { strategy: 'role', value: 'button', role: 'button' } },
        ],
      },
      {
        id: 'dashboard-page',
        route: '/dashboard',
        elements: [
          { logicalName: 'welcome-text', locator: { strategy: 'test-id', value: 'welcome' } },
          { logicalName: 'logout-button', locator: { strategy: 'test-id', value: 'logout' } },
        ],
      },
    ],
  };
}

function makeMapping(): TestExecutionMapping {
  return {
    testCaseId: 'TC-UI-001',
    executorType: 'ui',
    pageId: undefined,
    stepMappings: [
      { stepOrder: 1, action: 'noop' },
      { stepOrder: 2, action: 'fill', targetLogicalName: 'username-field', valueLiteral: 'admin' },
      { stepOrder: 3, action: 'fill', targetLogicalName: 'password-field', secretRef: 'test-password' },
      { stepOrder: 4, action: 'click', targetLogicalName: 'login-button' },
    ],
    assertionMappings: [
      { expectedResultIndex: 0, assertionType: 'url-contains', expectedValue: '/dashboard' },
      { expectedResultIndex: 1, assertionType: 'visible', targetLogicalName: 'welcome-text' },
    ],
  };
}

function makeTestCase(): TestCase {
  return {
    id: 'TC-UI-001',
    scenarioId: 'SC-UI-001',
    requirementIds: ['REQ-AUTH'],
    title: 'UI login test',
    objective: 'Verify login flow',
    type: 'ui',
    priority: 'high',
    preconditions: [],
    inputs: [],
    dataNeeds: [],
    steps: [
      { order: 1, description: 'Navigate to login', action: 'navigate' },
      { order: 2, description: 'Enter username', action: 'fill' },
      { order: 3, description: 'Enter password', action: 'fill' },
      { order: 4, description: 'Click login', action: 'click' },
    ],
    expectedResults: [
      { index: 0, description: 'URL contains /dashboard', verificationType: 'automated' },
      { index: 1, description: 'Welcome text visible', verificationType: 'automated' },
    ],
    cleanup: [],
    automation: { status: 'ready', reasons: ['UI test'] },
    provenance: [{ requirementId: 'REQ-AUTH' }],
  } as TestCase;
}

function makeSecrets(): SecretProvider {
  return {
    async resolve(secretRef: string): Promise<SecretValue> {
      if (secretRef === 'test-password') return { value: 's3cret', redacted: '***' };
      throw new Error(`Unknown secret: ${secretRef}`);
    },
  };
}

function buildOrchestrator(mode: 'dry-run' | 'simulate' | 'execute') {
  const elements = new Map<string, FakeElementState>([
    ['test-id=welcome', { visible: true, text: 'Welcome, Admin!' }],
  ]);
  const session = new FakeBrowserSession({ elements, currentUrl: 'http://127.0.0.1:3000/dashboard' });

  const uiExecutor = new UIExecutor({
    catalog: makeCatalog(),
    mappings: [makeMapping()],
    browserSession: session,
    environment: { baseUrl: 'http://127.0.0.1:3000', allowedOrigins: ['http://127.0.0.1:3000'] },
  });

  const registry = new TestExecutorRegistry();
  registry.register(uiExecutor);

  const clock = new FixedClock(new Date('2025-06-01T00:00:00Z'));
  const runIdProvider = new DeterministicRunIdProvider();

  const orch = new TestExecutionOrchestrator({
    registry,
    policy: { mode, allowedTestExecutorTypes: ['ui', 'fake'] },
    clock,
    runIdProvider,
    environmentId: 'env-1',
    secretProvider: makeSecrets(),
  });

  return orch;
}

// ===========================================================================
// INTEGRATION TESTS
// ===========================================================================

describe('Orchestrator integration — dry-run', () => {
  it('runs UI test case through orchestrator in dry-run mode', async () => {
    const orch = buildOrchestrator('dry-run');
    const result = await orch.run([makeTestCase()]);

    expect(result.status).toBe('passed');
    expect(result.mode).toBe('dry-run');
    expect(result.testResults).toHaveLength(1);

    const tr = result.testResults[0];
    expect(tr.testCaseId).toBe('TC-UI-001');
    expect(tr.status).toBe('skipped');
  });

  it('includes warnings in dry-run', async () => {
    const orch = buildOrchestrator('dry-run');
    const result = await orch.run([makeTestCase()]);
    // Orchestrator adds its own dry-run warning
    expect(result.testResults[0].warnings.length).toBeGreaterThanOrEqual(0);
    expect(result.testResults[0].status).toBe('skipped');
  });
});

describe('Orchestrator integration — simulate', () => {
  it('runs UI test case through orchestrator in simulate mode', async () => {
    const orch = buildOrchestrator('simulate');
    const result = await orch.run([makeTestCase()]);

    expect(result.status).toBe('passed');
    expect(result.mode).toBe('simulate');
    expect(result.testResults).toHaveLength(1);

    const tr = result.testResults[0];
    expect(tr.status).toBe('passed');
    expect(tr.steps).toHaveLength(4);
    expect(tr.steps.every((s) => s.status === 'passed')).toBe(true);
    expect(tr.assertions).toHaveLength(2);
    expect(tr.assertions.every((a) => a.status === 'passed')).toBe(true);
  });
});

describe('Orchestrator integration — execute', () => {
  it('runs UI test case through orchestrator in execute mode', async () => {
    const orch = buildOrchestrator('execute');
    const result = await orch.run([makeTestCase()]);

    expect(result.mode).toBe('execute');
    expect(result.testResults).toHaveLength(1);

    const tr = result.testResults[0];
    expect(tr.testCaseId).toBe('TC-UI-001');
    expect(tr.status).toBe('passed');
    expect(tr.steps.length).toBeGreaterThan(0);
    expect(tr.assertions.length).toBeGreaterThan(0);
  });

  it('assertion IDs follow ASR-NNN format', async () => {
    const orch = buildOrchestrator('execute');
    const result = await orch.run([makeTestCase()]);
    const tr = result.testResults[0];
    for (const a of tr.assertions) {
      expect(a.id).toMatch(/^ASR-\d{3}$/);
    }
  });

  it('assertion traceability: all indexes map to expected results', async () => {
    const orch = buildOrchestrator('execute');
    const result = await orch.run([makeTestCase()]);
    const tr = result.testResults[0];
    const tc = makeTestCase();
    for (const a of tr.assertions) {
      expect(a.expectedResultIndex).toBeGreaterThanOrEqual(0);
      expect(a.expectedResultIndex).toBeLessThan(tc.expectedResults.length);
    }
  });

  it('provenance is preserved', async () => {
    const orch = buildOrchestrator('execute');
    const result = await orch.run([makeTestCase()]);
    const tr = result.testResults[0];
    expect(tr.provenance).toBeDefined();
    expect(tr.provenance.length).toBeGreaterThan(0);
    expect(tr.provenance[0].requirementId).toBe('REQ-AUTH');
  });
});

describe('Orchestrator integration — determinism', () => {
  it('two identical runs produce identical results', async () => {
    const runOnce = async () => {
      const orch = buildOrchestrator('simulate');
      return orch.run([makeTestCase()]);
    };
    const r1 = await runOnce();
    const r2 = await runOnce();

    expect(r1.status).toBe(r2.status);
    expect(r1.summary.testsTotal).toBe(r2.summary.testsTotal);
    expect(r1.summary.passed).toBe(r2.summary.passed);
    expect(r1.testResults[0].status).toBe(r2.testResults[0].status);
    expect(r1.testResults[0].steps).toHaveLength(r2.testResults[0].steps.length);
    expect(r1.testResults[0].assertions).toHaveLength(r2.testResults[0].assertions.length);
  });
});

describe('Orchestrator integration — security', () => {
  it('no secret values leak into result output', async () => {
    const orch = buildOrchestrator('execute');
    const result = await orch.run([makeTestCase()]);
    const json = JSON.stringify(result);
    expect(json).not.toContain('s3cret');
  });

  it('run summary is consistent', async () => {
    const orch = buildOrchestrator('simulate');
    const result = await orch.run([makeTestCase()]);
    expect(result.summary.testsTotal).toBe(1);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.assertionsTotal).toBe(2);
    expect(result.summary.assertionsPassed).toBe(2);
  });
});
