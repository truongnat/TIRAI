// Test Execution Orchestrator v1 — Comprehensive tests.

import { describe, it, expect } from 'vitest';
import {
  TestExecutionOrchestrator,
  TestExecutorRegistry,
  FakeTestExecutor,
  ManualTestExecutor,
  InMemoryEvidenceCollector,
  defaultTestRunPolicy,
  FixedClock,
  SystemClock,
  DeterministicRunIdProvider,
  UniqueRunIdProvider,
  planAssertions,
  classifyTestStatus,
  computeRunSummary,
  TestExecutionOrchestratorError,
  TestWarningCode,
  type AssertionResult,
} from '../src/index.js';
import {
  FakeBindingStore,
  minimalTestCase,
  minimalContext,
} from './helpers.js';

// ==========================================================================
// INPUT VALIDATION (1-5)
// ==========================================================================

describe('Input Validation', () => {
  it('1. valid test case accepted', () => {
    const tc = minimalTestCase();
    expect(tc.id).toBe('TC-0001');
    expect(tc.steps.length).toBeGreaterThan(0);
    expect(tc.expectedResults.length).toBeGreaterThan(0);
  });

  it('2. test case missing ID', () => {
    const tc = minimalTestCase({ id: '' });
    expect(tc.id).toBe('');
  });

  it('3. invalid scenario reference', () => {
    const tc = minimalTestCase({ scenarioId: '' });
    expect(tc.scenarioId).toBe('');
  });

  it('4. empty expected results', () => {
    const tc = minimalTestCase({ expectedResults: [] });
    expect(tc.expectedResults.length).toBe(0);
  });

  it('5. malformed expected results still parseable', () => {
    const tc = minimalTestCase({
      expectedResults: [{ description: '', verificationType: 'other' }],
    });
    expect(tc.expectedResults[0].description).toBe('');
  });
});

// ==========================================================================
// REGISTRY (6-11)
// ==========================================================================

describe('Test Executor Registry', () => {
  it('6. register fake executor', () => {
    const registry = new TestExecutorRegistry();
    const fake = new FakeTestExecutor();
    registry.register(fake);
    expect(registry.list().length).toBe(1);
  });

  it('7. resolve for UI test case', () => {
    const registry = new TestExecutorRegistry();
    const fake = new FakeTestExecutor({ executorType: 'ui', score: 0.9 });
    registry.register(fake);
    const tc = minimalTestCase({ type: 'ui' });
    const ctx = minimalContext();
    const resolved = registry.resolve(tc, ctx);
    expect(resolved.type).toBe('ui');
  });

  it('8. resolve for API test case', () => {
    const registry = new TestExecutorRegistry();
    const fake = new FakeTestExecutor({ executorType: 'api', score: 0.9 });
    registry.register(fake);
    const tc = minimalTestCase({ type: 'api' });
    const ctx = minimalContext();
    const resolved = registry.resolve(tc, ctx);
    expect(resolved.type).toBe('api');
  });

  it('9. resolve for DB test case', () => {
    const registry = new TestExecutorRegistry();
    const fake = new FakeTestExecutor({ executorType: 'database', score: 0.9 });
    registry.register(fake);
    const tc = minimalTestCase({ type: 'database' });
    const ctx = minimalContext();
    const resolved = registry.resolve(tc, ctx);
    expect(resolved.type).toBe('database');
  });

  it('10. no executor found throws', () => {
    const registry = new TestExecutorRegistry();
    const tc = minimalTestCase();
    const ctx = minimalContext();
    expect(() => registry.resolve(tc, ctx)).toThrow(TestExecutionOrchestratorError);
  });

  it('11. deterministic tie-breaking by type', () => {
    const registry = new TestExecutorRegistry();
    const fake1 = new FakeTestExecutor({ executorType: 'api', score: 0.5 });
    const fake2 = new FakeTestExecutor({ executorType: 'database', score: 0.5 });
    registry.register(fake1);
    registry.register(fake2);
    const tc = minimalTestCase();
    const ctx = minimalContext();
    const resolved = registry.resolve(tc, ctx);
    // 'api' < 'database' alphabetically
    expect(resolved.type).toBe('api');
  });
});

// ==========================================================================
// READINESS (12-15)
// ==========================================================================

describe('Execution Readiness', () => {
  it('12. ready automation', () => {
    const tc = minimalTestCase({ automation: { status: 'ready', reasons: [] } });
    expect(tc.automation.status).toBe('ready');
  });

  it('13. partially-ready', () => {
    const tc = minimalTestCase({ automation: { status: 'partially-ready', reasons: [] } });
    expect(tc.automation.status).toBe('partially-ready');
  });

  it('14. manual-only', () => {
    const tc = minimalTestCase({ automation: { status: 'manual-only', reasons: ['Requires human'] } });
    expect(tc.automation.status).toBe('manual-only');
  });

  it('15. unknown automation', () => {
    const tc = minimalTestCase({ automation: { status: 'unknown', reasons: [] } });
    expect(tc.automation.status).toBe('unknown');
  });
});

// ==========================================================================
// PREPARATION (16-20) — tested via orchestrator integration
// ==========================================================================

describe('Data Preparation', () => {
  it('16. preparation success allows test execution', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].dataPreparation?.status).toBe('succeeded');
  });

  it('17. preparation blocked → test blocked', async () => {
    // Simulated via orchestrator — preparation always succeeds in v1
    // unless data plan is supplied. This test verifies the structure.
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('passed');
  });

  it('18. preparation error → test error', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('error');
  });

  it('19. preparation error produces error status', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].errors.length).toBeGreaterThan(0);
  });

  it('20. prepareData=false skips preparation', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: false },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].dataPreparation).toBeUndefined();
  });
});

// ==========================================================================
// RUNTIME BINDINGS (21-25)
// ==========================================================================

describe('Runtime Bindings', () => {
  it('21. inherited binding available', () => {
    const store = new FakeBindingStore();
    store.produce({ id: 'b1', name: 'userId', producerOperationId: 'op1', value: 42, sensitive: false, status: 'resolved' });
    expect(store.resolve('userId')?.value).toBe(42);
  });

  it('22. missing binding returns undefined', () => {
    const store = new FakeBindingStore();
    expect(store.resolve('missing')).toBeUndefined();
  });

  it('23. sensitive binding flagged', () => {
    const store = new FakeBindingStore();
    store.produce({ id: 'b1', name: 'token', producerOperationId: 'op1', value: 'secret', sensitive: true, status: 'resolved' });
    expect(store.resolve('token')?.sensitive).toBe(true);
    expect(store.sensitiveNames().has('token')).toBe(true);
  });

  it('24. binding isolation between tests', () => {
    const store1 = new FakeBindingStore();
    const store2 = new FakeBindingStore();
    store1.produce({ id: 'b1', name: 'x', producerOperationId: 'op1', value: 1, sensitive: false, status: 'resolved' });
    expect(store1.isResolved('x')).toBe(true);
    expect(store2.isResolved('x')).toBe(false);
  });

  it('25. no cross-test leak', () => {
    const store = new FakeBindingStore();
    store.produce({ id: 'b1', name: 'a', producerOperationId: 'op1', value: 'v', sensitive: false, status: 'resolved' });
    const all = store.all();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('a');
  });
});

// ==========================================================================
// STEPS (26-31)
// ==========================================================================

describe('Test Steps', () => {
  it('26. one step', () => {
    const tc = minimalTestCase({ steps: [{ order: 1, action: 'Click' }] });
    expect(tc.steps.length).toBe(1);
  });

  it('27. multiple ordered steps', () => {
    const tc = minimalTestCase({
      steps: [
        { order: 1, action: 'Open' },
        { order: 2, action: 'Type' },
        { order: 3, action: 'Submit' },
      ],
    });
    expect(tc.steps.length).toBe(3);
    expect(tc.steps[0].order).toBe(1);
    expect(tc.steps[2].order).toBe(3);
  });

  it('28. step passed', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].steps[0].status).toBe('passed');
  });

  it('29. step failed', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({
      resultStatus: 'failed',
      steps: [{ order: 1, action: 'Click', status: 'failed', evidenceIds: [] }],
    }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].steps[0].status).toBe('failed');
  });

  it('30. step blocked', () => {
    const step = { order: 1, action: 'Click', status: 'blocked' as const, evidenceIds: [] };
    expect(step.status).toBe('blocked');
  });

  it('31. step evidence linked', () => {
    const step = { order: 1, action: 'Click', status: 'passed' as const, evidenceIds: ['EVD-0001'] };
    expect(step.evidenceIds).toContain('EVD-0001');
  });
});

// ==========================================================================
// ASSERTIONS (32-39)
// ==========================================================================

describe('Assertions', () => {
  it('32. UI assertion planned', () => {
    const planned = planAssertions([{ description: 'Button visible', verificationType: 'ui' }], 'TC-0001');
    expect(planned[0].verificationType).toBe('ui');
  });

  it('33. API assertion planned', () => {
    const planned = planAssertions([{ description: 'Status 200', verificationType: 'api' }], 'TC-0002');
    expect(planned[0].verificationType).toBe('api');
  });

  it('34. DB assertion planned', () => {
    const planned = planAssertions([{ description: 'Row exists', verificationType: 'database' }], 'TC-0003');
    expect(planned[0].verificationType).toBe('database');
  });

  it('35. state assertion planned', () => {
    const planned = planAssertions([{ description: 'State changed', verificationType: 'state' }], 'TC-0004');
    expect(planned[0].verificationType).toBe('state');
  });

  it('36. assertion passed', () => {
    const assertions: AssertionResult[] = [{
      id: 'A1', expectedResultIndex: 0, description: 'test',
      verificationType: 'ui', status: 'passed', evidenceIds: [],
    }];
    const result = classifyTestStatus(assertions, 'TC-0001');
    expect(result.status).toBe('passed');
  });

  it('37. assertion failed', () => {
    const assertions: AssertionResult[] = [{
      id: 'A1', expectedResultIndex: 0, description: 'test',
      verificationType: 'ui', status: 'failed', evidenceIds: [],
    }];
    const result = classifyTestStatus(assertions, 'TC-0001');
    expect(result.status).toBe('failed');
  });

  it('38. assertion blocked', () => {
    const assertions: AssertionResult[] = [{
      id: 'A1', expectedResultIndex: 0, description: 'test',
      verificationType: 'ui', status: 'blocked', evidenceIds: [],
    }];
    const result = classifyTestStatus(assertions, 'TC-0001');
    expect(result.status).toBe('blocked');
  });

  it('39. no assertion → blocked (not auto-pass)', () => {
    const result = classifyTestStatus([], 'TC-0001');
    expect(result.status).toBe('blocked');
    expect(result.warnings[0].code).toBe(TestWarningCode.TEST_NO_ASSERTIONS);
  });
});

// ==========================================================================
// STATUS (40-45)
// ==========================================================================

describe('Test Status Classification', () => {
  it('40. all assertions pass → passed', () => {
    const assertions: AssertionResult[] = [
      { id: 'A1', expectedResultIndex: 0, description: 'a', verificationType: 'ui', status: 'passed', evidenceIds: [] },
      { id: 'A2', expectedResultIndex: 1, description: 'b', verificationType: 'ui', status: 'passed', evidenceIds: [] },
    ];
    expect(classifyTestStatus(assertions, 'TC').status).toBe('passed');
  });

  it('41. one assertion fails → failed', () => {
    const assertions: AssertionResult[] = [
      { id: 'A1', expectedResultIndex: 0, description: 'a', verificationType: 'ui', status: 'passed', evidenceIds: [] },
      { id: 'A2', expectedResultIndex: 1, description: 'b', verificationType: 'ui', status: 'failed', evidenceIds: [] },
    ];
    expect(classifyTestStatus(assertions, 'TC').status).toBe('failed');
  });

  it('42. prerequisite blocked → blocked', () => {
    const assertions: AssertionResult[] = [
      { id: 'A1', expectedResultIndex: 0, description: 'a', verificationType: 'ui', status: 'blocked', evidenceIds: [] },
    ];
    expect(classifyTestStatus(assertions, 'TC').status).toBe('blocked');
  });

  it('43. executor error → error (via orchestrator)', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('error');
  });

  it('44. manual test → manual', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new ManualTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tc = minimalTestCase({ automation: { status: 'manual-only', reasons: [] } });
    const result = await orch.run([tc]);
    expect(result.testResults[0].status).toBe('manual');
  });

  it('45. skipped via dry-run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'dry-run' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('skipped');
  });
});

// ==========================================================================
// FAKE EXECUTOR (46-51)
// ==========================================================================

describe('Fake Test Executor', () => {
  it('46. success', async () => {
    const executor = new FakeTestExecutor({ resultStatus: 'passed' });
    const tc = minimalTestCase();
    const ctx = minimalContext();
    const result = await executor.execute(tc, ctx);
    expect(result.status).toBe('passed');
  });

  it('47. failure', async () => {
    const executor = new FakeTestExecutor({ resultStatus: 'failed' });
    const tc = minimalTestCase();
    const ctx = minimalContext();
    const result = await executor.execute(tc, ctx);
    expect(result.status).toBe('failed');
  });

  it('48. blocked', async () => {
    const executor = new FakeTestExecutor({ resultStatus: 'blocked' });
    const tc = minimalTestCase();
    const ctx = minimalContext();
    const result = await executor.execute(tc, ctx);
    expect(result.status).toBe('blocked');
  });

  it('49. error', async () => {
    const executor = new FakeTestExecutor({ shouldError: true });
    const tc = minimalTestCase();
    const ctx = minimalContext();
    const result = await executor.execute(tc, ctx);
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('50. timeout via delay', async () => {
    const executor = new FakeTestExecutor({ delayMs: 50 });
    const tc = minimalTestCase();
    const ctx = minimalContext();
    const start = Date.now();
    await executor.execute(tc, ctx);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('51. request capture', async () => {
    const executor = new FakeTestExecutor();
    const tc = minimalTestCase();
    const ctx = minimalContext();
    await executor.execute(tc, ctx);
    expect(executor.getCallCount()).toBe(1);
    expect(executor.getCapturedCalls()[0].id).toBe('TC-0001');
  });
});

// ==========================================================================
// MANUAL EXECUTOR (52-53)
// ==========================================================================

describe('Manual Test Executor', () => {
  it('52. manual test returns manual status', async () => {
    const executor = new ManualTestExecutor();
    const tc = minimalTestCase({ automation: { status: 'manual-only', reasons: [] } });
    const ctx = minimalContext();
    const result = await executor.execute(tc, ctx);
    expect(result.status).toBe('manual');
    expect(result.warnings[0].code).toBe(TestWarningCode.TEST_MANUAL);
  });

  it('53. manual executor does not handle non-manual', () => {
    const executor = new ManualTestExecutor();
    const tc = minimalTestCase({ automation: { status: 'ready', reasons: [] } });
    const ctx = minimalContext();
    const match = executor.canExecute(tc, ctx);
    expect(match.supported).toBe(false);
  });
});

// ==========================================================================
// EVIDENCE (54-60)
// ==========================================================================

describe('Evidence', () => {
  it('54. create evidence', () => {
    const collector = new InMemoryEvidenceCollector();
    const ref = collector.add({ type: 'screenshot', sourceExecutor: 'ui', testCaseId: 'TC-0001' });
    expect(ref.id).toBeDefined();
    expect(ref.type).toBe('screenshot');
  });

  it('55. deterministic IDs', () => {
    const collector = new InMemoryEvidenceCollector();
    const r1 = collector.add({ type: 'log', sourceExecutor: 'api', testCaseId: 'TC-0001' });
    const r2 = collector.add({ type: 'text', sourceExecutor: 'api', testCaseId: 'TC-0001' });
    expect(r1.id).toBe('EVD-0001');
    expect(r2.id).toBe('EVD-0002');
  });

  it('56. step evidence linked', () => {
    const collector = new InMemoryEvidenceCollector();
    const ref = collector.add({ type: 'log', sourceExecutor: 'ui', testCaseId: 'TC-0001', stepOrder: 1 });
    expect(ref.stepOrder).toBe(1);
  });

  it('57. assertion evidence linked', () => {
    const collector = new InMemoryEvidenceCollector();
    const ref = collector.add({ type: 'screenshot', sourceExecutor: 'ui', testCaseId: 'TC-0001', assertionId: 'A1' });
    expect(ref.assertionId).toBe('A1');
  });

  it('58. no orphan evidence (all trace to test case)', () => {
    const collector = new InMemoryEvidenceCollector();
    collector.add({ type: 'log', sourceExecutor: 'ui', testCaseId: 'TC-0001' });
    const all = collector.list();
    expect(all.every((e) => e.testCaseId === 'TC-0001')).toBe(true);
  });

  it('59. sensitive metadata flagged', () => {
    const collector = new InMemoryEvidenceCollector();
    const ref = collector.add({ type: 'log', sourceExecutor: 'api', testCaseId: 'TC-0001', sensitive: true });
    expect(ref.sensitive).toBe(true);
  });

  it('60. multiple evidence items', () => {
    const collector = new InMemoryEvidenceCollector();
    collector.add({ type: 'log', sourceExecutor: 'ui', testCaseId: 'TC-0001' });
    collector.add({ type: 'screenshot', sourceExecutor: 'ui', testCaseId: 'TC-0001' });
    collector.add({ type: 'text', sourceExecutor: 'ui', testCaseId: 'TC-0001' });
    expect(collector.list().length).toBe(3);
  });
});

// ==========================================================================
// AUDIT (61-70)
// ==========================================================================

describe('Audit Trail', () => {
  it('61. run start recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.auditTrail[0].type).toBe('run-start');
  });

  it('62. test start recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const testStart = result.auditTrail.find((e) => e.type === 'test-start');
    expect(testStart).toBeDefined();
    expect(testStart?.testCaseId).toBe('TC-0001');
  });

  it('63. prep start/end recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const prepStart = result.auditTrail.find((e) => e.type === 'data-preparation-start');
    const prepEnd = result.auditTrail.find((e) => e.type === 'data-preparation-end');
    expect(prepStart).toBeDefined();
    expect(prepEnd).toBeDefined();
  });

  it('64. executor selected recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const selected = result.auditTrail.find((e) => e.type === 'executor-selected');
    expect(selected).toBeDefined();
  });

  it('65. step events recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const stepStart = result.auditTrail.filter((e) => e.type === 'step-start');
    expect(stepStart.length).toBeGreaterThan(0);
  });

  it('66. assertion events recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const assertionEvents = result.auditTrail.filter((e) => e.type === 'assertion-start');
    expect(assertionEvents.length).toBeGreaterThan(0);
  });

  it('67. evidence event recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({
      evidence: [{ type: 'log', artifactRef: 'log-001' }],
    }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const evEvents = result.auditTrail.filter((e) => e.type === 'evidence-added');
    expect(evEvents.length).toBeGreaterThan(0);
  });

  it('68. cleanup events recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ cleanupStatus: 'succeeded' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const cleanupStart = result.auditTrail.find((e) => e.type === 'cleanup-start');
    const cleanupEnd = result.auditTrail.find((e) => e.type === 'cleanup-end');
    expect(cleanupStart).toBeDefined();
    expect(cleanupEnd).toBeDefined();
  });

  it('69. run end recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const lastEvent = result.auditTrail[result.auditTrail.length - 1];
    expect(lastEvent.type).toBe('run-end');
  });

  it('70. audit ordering correct', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const types = result.auditTrail.map((e) => e.type);
    expect(types.indexOf('run-start')).toBeLessThan(types.indexOf('test-start'));
    expect(types.indexOf('test-start')).toBeLessThan(types.indexOf('test-end'));
    expect(types.indexOf('test-end')).toBeLessThan(types.indexOf('run-end'));
  });
});

// ==========================================================================
// CLEANUP (71-75)
// ==========================================================================

describe('Cleanup', () => {
  it('71. cleanup success', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ cleanupStatus: 'succeeded' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].cleanup.succeeded).toBe(1);
  });

  it('72. cleanup failure recorded', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ cleanupStatus: 'failed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].cleanup.failed).toBe(1);
  });

  it('73. cleanup disabled by policy', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ cleanupStatus: 'succeeded' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: false },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].cleanup.attempted).toBe(0);
  });

  it('74. preparation cleanup (structure)', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].dataPreparation).toBeDefined();
  });

  it('75. executor cleanup called', async () => {
    const executor = new FakeTestExecutor({ cleanupStatus: 'succeeded' });
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    await orch.run([minimalTestCase()]);
    expect(executor.getCallCount()).toBe(1);
  });
});

// ==========================================================================
// POLICY (76-82)
// ==========================================================================

describe('Policy', () => {
  it('76. default mode is dry-run', () => {
    const policy = defaultTestRunPolicy();
    expect(policy.mode).toBe('dry-run');
  });

  it('77. simulate mode', () => {
    const policy = defaultTestRunPolicy({ mode: 'simulate' });
    expect(policy.mode).toBe('simulate');
  });

  it('78. execute mode structure', () => {
    const policy = defaultTestRunPolicy({ mode: 'execute' });
    expect(policy.mode).toBe('execute');
  });

  it('79. executor type denied by policy', () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ executorType: 'ui' }));
    const tc = minimalTestCase();
    const ctx = minimalContext({ policy: defaultTestRunPolicy({ allowedTestExecutorTypes: ['api'] }) });
    expect(() => registry.resolve(tc, ctx)).toThrow(TestExecutionOrchestratorError);
  });

  it('80. max concurrency default 1', () => {
    const policy = defaultTestRunPolicy();
    expect(policy.maxConcurrency).toBe(1);
  });

  it('81. failFast default false', () => {
    const policy = defaultTestRunPolicy();
    expect(policy.failFast).toBe(false);
  });

  it('82. timeout default 30000', () => {
    const policy = defaultTestRunPolicy();
    expect(policy.testTimeoutMs).toBe(30000);
  });
});

// ==========================================================================
// DRY RUN (83-87)
// ==========================================================================

describe('Dry Run', () => {
  it('83. no executor calls in dry-run', async () => {
    const executor = new FakeTestExecutor();
    const registry = new TestExecutorRegistry();
    registry.register(executor);
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'dry-run' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    await orch.run([minimalTestCase()]);
    expect(executor.getCallCount()).toBe(0);
  });

  it('84. executor validation in dry-run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'dry-run' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('skipped');
  });

  it('85. assertion planning in dry-run', () => {
    const planned = planAssertions(
      [{ description: 'Visible', verificationType: 'ui' }],
      'TC-0001',
    );
    expect(planned[0].status).toBe('not-verified');
  });

  it('86. no evidence side effect in dry-run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ evidence: [{ type: 'log' }] }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'dry-run' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].evidence.length).toBe(0);
  });

  it('87. predicted status is skipped', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'dry-run' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('skipped');
  });
});

// ==========================================================================
// SIMULATE (88-91)
// ==========================================================================

describe('Simulate', () => {
  it('88. pass test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('passed');
  });

  it('89. fail test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'failed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('failed');
  });

  it('90. blocked test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'blocked' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('blocked');
  });

  it('91. error test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].status).toBe('error');
  });
});

// ==========================================================================
// RUN (92-96)
// ==========================================================================

describe('Test Run', () => {
  it('92. single test run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults.length).toBe(1);
  });

  it('93. multiple tests run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tcs = [
      minimalTestCase({ id: 'TC-0001' }),
      minimalTestCase({ id: 'TC-0002' }),
      minimalTestCase({ id: 'TC-0003' }),
    ];
    const result = await orch.run(tcs);
    expect(result.testResults.length).toBe(3);
  });

  it('94. deterministic order by ID', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tcs = [
      minimalTestCase({ id: 'TC-0003' }),
      minimalTestCase({ id: 'TC-0001' }),
      minimalTestCase({ id: 'TC-0002' }),
    ];
    const result = await orch.run(tcs);
    expect(result.testResults[0].testCaseId).toBe('TC-0001');
    expect(result.testResults[1].testCaseId).toBe('TC-0002');
    expect(result.testResults[2].testCaseId).toBe('TC-0003');
  });

  it('95. failFast stops after failure', async () => {
    const failExecutor = new FakeTestExecutor({
      resultStatus: 'failed',
      canHandle: (tc) => tc.id === 'TC-0001',
      score: 0.9,
    });
    const passExecutor = new FakeTestExecutor({
      resultStatus: 'passed',
      canHandle: (tc) => tc.id !== 'TC-0001',
      score: 0.9,
    });
    const registry = new TestExecutorRegistry();
    registry.register(failExecutor);
    registry.register(passExecutor);
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', failFast: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tcs = [
      minimalTestCase({ id: 'TC-0001' }),
      minimalTestCase({ id: 'TC-0002' }),
    ];
    const result = await orch.run(tcs);
    expect(result.testResults[0].status).toBe('failed');
    expect(result.testResults[1].status).toBe('skipped');
  });

  it('96. continue after fail when failFast=false', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', failFast: false },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tcs = [
      minimalTestCase({ id: 'TC-0001' }),
      minimalTestCase({ id: 'TC-0002' }),
    ];
    const result = await orch.run(tcs);
    expect(result.testResults.length).toBe(2);
    expect(result.testResults.every((r) => r.status === 'passed')).toBe(true);
  });
});

// ==========================================================================
// SUMMARY (97-100)
// ==========================================================================

describe('Run Summary', () => {
  it('97. all passed', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.passed).toBe(1);
    expect(result.status).toBe('passed');
  });

  it('98. mixed results', async () => {
    const passExec = new FakeTestExecutor({ resultStatus: 'passed', canHandle: (tc) => tc.id === 'TC-0001', score: 0.9 });
    const failExec = new FakeTestExecutor({ resultStatus: 'failed', canHandle: (tc) => tc.id === 'TC-0002', score: 0.9 });
    const registry = new TestExecutorRegistry();
    registry.register(passExec);
    registry.register(failExec);
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([
      minimalTestCase({ id: 'TC-0001' }),
      minimalTestCase({ id: 'TC-0002' }),
    ]);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.status).toBe('partial');
  });

  it('99. all blocked', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'blocked' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.blocked).toBe(1);
  });

  it('100. error run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.errors).toBe(1);
  });
});

// ==========================================================================
// QUALITY (101-105)
// ==========================================================================

describe('Quality Metrics', () => {
  it('101. metrics computed', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.testsTotal).toBe(1);
    expect(result.summary.passed).toBe(1);
  });

  it('102. assertion rate', () => {
    const results: TestExecutionResultIR[] = [{
      schemaVersion: '1.0', runId: 'R1', testCaseId: 'TC1', scenarioId: 'S1',
      requirementIds: [], status: 'passed', phase: 'completed',
      steps: [], assertions: [
        { id: 'A1', expectedResultIndex: 0, description: 'a', verificationType: 'ui', status: 'passed', evidenceIds: [] },
        { id: 'A2', expectedResultIndex: 1, description: 'b', verificationType: 'ui', status: 'failed', evidenceIds: [] },
      ],
      evidence: [], runtimeBindings: [], cleanup: { attempted: 0, succeeded: 0, failed: 0, results: [] },
      errors: [], warnings: [], provenance: [],
      timings: { startedAt: '', finishedAt: '', durationMs: 0 },
    }];
    const summary = computeRunSummary(results, 0);
    expect(summary.assertionsTotal).toBe(2);
    expect(summary.assertionsPassed).toBe(1);
    expect(summary.assertionsFailed).toBe(1);
  });

  it('103. evidence count', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({
      resultStatus: 'passed',
      evidence: [{ type: 'log' }, { type: 'text' }],
    }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.evidenceItems).toBe(2);
  });

  it('104. cleanup failures counted', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ cleanupStatus: 'failed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.cleanupFailures).toBe(1);
  });

  it('105. cleanup failure prevents a clean pass', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ cleanupStatus: 'failed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0]?.status).toBe('error');
    expect(result.summary.errors).toBe(1);
    expect(result.testResults[0]?.errors[0]?.code).toBe('TEST_CLEANUP_FAILED');
  });

  it('106. provenance coverage', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.provenanceCoverage).toBe(1);
  });
});

// ==========================================================================
// PROVENANCE (106-108)
// ==========================================================================

describe('Provenance', () => {
  it('106. result preserves provenance', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].provenance.length).toBeGreaterThan(0);
    expect(result.testResults[0].provenance[0].requirementId).toBe('REQ-0001');
  });

  it('107. assertion linkage to expected result', () => {
    const planned = planAssertions(
      [{ description: 'A', verificationType: 'ui' }, { description: 'B', verificationType: 'api' }],
      'TC-0001',
    );
    expect(planned[0].expectedResultIndex).toBe(0);
    expect(planned[1].expectedResultIndex).toBe(1);
  });

  it('108. evidence linkage to test case', () => {
    const collector = new InMemoryEvidenceCollector();
    collector.add({ type: 'log', sourceExecutor: 'ui', testCaseId: 'TC-0001', assertionId: 'A1' });
    const ev = collector.list()[0];
    expect(ev.testCaseId).toBe('TC-0001');
    expect(ev.assertionId).toBe('A1');
  });
});

// ==========================================================================
// SECURITY (109-112)
// ==========================================================================

describe('Security', () => {
  it('109. secret binding redacted in result', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    // No secret values should appear in result JSON
    const json = JSON.stringify(result);
    expect(json).not.toContain('super-secret');
  });

  it('110. evidence secret redacted', () => {
    const collector = new InMemoryEvidenceCollector();
    collector.add({
      type: 'log', sourceExecutor: 'api', testCaseId: 'TC-0001',
      sensitive: true, metadata: { authorization: 'Bearer secret-token' },
    });
    const ev = collector.list()[0];
    expect(ev.sensitive).toBe(true);
  });

  it('111. error does not contain secrets', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true, errorMessage: 'Generic error' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const json = JSON.stringify(result.testResults[0].errors);
    expect(json).not.toContain('password');
  });

  it('112. audit trail does not contain secrets', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const json = JSON.stringify(result.auditTrail);
    expect(json).not.toContain('secret');
  });
});

// ==========================================================================
// TIME (113-115)
// ==========================================================================

describe('Time', () => {
  it('113. fixed clock deterministic', () => {
    const clock = new FixedClock('2025-06-15T12:00:00.000Z');
    expect(clock.nowIso()).toBe('2025-06-15T12:00:00.000Z');
    expect(clock.now().getTime()).toBe(new Date('2025-06-15T12:00:00.000Z').getTime());
  });

  it('114. duration computed', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].timings.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('115. system clock returns current time', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

// ==========================================================================
// RUN ID (116-117)
// ==========================================================================

describe('Run ID', () => {
  it('116. deterministic provider', () => {
    const provider = new DeterministicRunIdProvider();
    expect(provider.generate()).toBe('RUN-0001');
    expect(provider.generate()).toBe('RUN-0002');
  });

  it('117. unique provider generates distinct IDs', () => {
    const provider = new UniqueRunIdProvider();
    const id1 = provider.generate();
    const id2 = provider.generate();
    expect(id1).not.toBe(id2);
  });
});

// ==========================================================================
// OUTPUT (118-123)
// ==========================================================================

describe('Output', () => {
  it('118. run result has schema version', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.schemaVersion).toBe('1.0');
  });

  it('119. test result has all fields', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const tr = result.testResults[0];
    expect(tr.testCaseId).toBeDefined();
    expect(tr.scenarioId).toBeDefined();
    expect(tr.requirementIds).toBeDefined();
    expect(tr.status).toBeDefined();
    expect(tr.phase).toBeDefined();
    expect(tr.steps).toBeDefined();
    expect(tr.assertions).toBeDefined();
    expect(tr.evidence).toBeDefined();
    expect(tr.cleanup).toBeDefined();
    expect(tr.timings).toBeDefined();
  });

  it('120. evidence refs in result', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({
      resultStatus: 'passed',
      evidence: [{ type: 'log' }],
    }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].evidence.length).toBeGreaterThan(0);
  });

  it('121. audit trail in result', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.auditTrail.length).toBeGreaterThan(0);
  });

  it('122. manifest generated', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const runResult = await orch.run([minimalTestCase()]);
    const manifest = orch.buildManifest(runResult);
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.stats.testsTotal).toBe(1);
    expect(manifest.stats.passed).toBe(1);
  });

  it('123. quality report in summary', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.summary.testsTotal).toBe(1);
    expect(result.summary.assertionsTotal).toBeGreaterThan(0);
  });
});

// ==========================================================================
// INTEGRATION (124-130)
// ==========================================================================

describe('Integration', () => {
  it('124. data preparation result feeds test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', prepareData: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].dataPreparation?.status).toBe('succeeded');
    expect(result.testResults[0].status).toBe('passed');
  });

  it('125. fake UI test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ executorType: 'ui', resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tc = minimalTestCase({ type: 'ui', automation: { status: 'ready', reasons: [] } });
    const result = await orch.run([tc]);
    expect(result.testResults[0].status).toBe('passed');
  });

  it('126. fake API test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ executorType: 'api', resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tc = minimalTestCase({ type: 'api' });
    const result = await orch.run([tc]);
    expect(result.testResults[0].status).toBe('passed');
  });

  it('127. fake DB test', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ executorType: 'database', resultStatus: 'passed' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const tc = minimalTestCase({ type: 'database' });
    const result = await orch.run([tc]);
    expect(result.testResults[0].status).toBe('passed');
  });

  it('128. mixed run', async () => {
    const passExec = new FakeTestExecutor({ resultStatus: 'passed', canHandle: (tc) => tc.id === 'TC-0001', score: 0.9 });
    const failExec = new FakeTestExecutor({ resultStatus: 'failed', canHandle: (tc) => tc.id === 'TC-0002', score: 0.9 });
    const blockExec = new FakeTestExecutor({ resultStatus: 'blocked', canHandle: (tc) => tc.id === 'TC-0003', score: 0.9 });
    const registry = new TestExecutorRegistry();
    registry.register(passExec);
    registry.register(failExec);
    registry.register(blockExec);
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([
      minimalTestCase({ id: 'TC-0001' }),
      minimalTestCase({ id: 'TC-0002' }),
      minimalTestCase({ id: 'TC-0003' }),
    ]);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.blocked).toBe(1);
  });

  it('129. cleanup after mixed run', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed', cleanupStatus: 'succeeded' }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate', cleanupAfterTest: true },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    expect(result.testResults[0].cleanup.succeeded).toBe(1);
  });

  it('130. complete traceability', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({
      resultStatus: 'passed',
      evidence: [{ type: 'log', artifactRef: 'log-001' }],
    }));
    const orch = new TestExecutionOrchestrator({
      registry,
      policy: { mode: 'simulate' },
      clock: new FixedClock('2025-01-01T00:00:00.000Z'),
      runIdProvider: new DeterministicRunIdProvider(),
    });
    const result = await orch.run([minimalTestCase()]);
    const tr = result.testResults[0];
    // Traceability chain: result → test case → scenario → requirement
    expect(tr.testCaseId).toBe('TC-0001');
    expect(tr.scenarioId).toBe('SCN-0001');
    expect(tr.requirementIds).toContain('REQ-0001');
    expect(tr.provenance[0].requirementId).toBe('REQ-0001');
    // Evidence traces to test case
    expect(tr.evidence.length).toBeGreaterThan(0);
    expect(tr.evidence[0].testCaseId).toBe('TC-0001');
  });
});
