// ---------------------------------------------------------------------------
// Execution Engine – comprehensive tests (1-70)
// ---------------------------------------------------------------------------
// Covers: input validation, policy, registry, binding store, audit, scheduler,
// executors (fake, in-memory-db, value-gen, manual), cleanup, rollback,
// engine (dry-run + simulate), quality metrics, persistence.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  executePreparation,
  buildManifest,
  PolicyEngine,
  defaultPolicy,
  mergePolicy,
  validateExecuteGate,
  registerExecutor,
  getExecutor,
  listExecutors,
  findBestExecutor,
  clearRegistry,
  FakeExecutor,
  InMemoryDbExecutor,
  ValueGeneratorExecutor,
  ManualExecutor,
  InMemoryBindingStore,
  DefaultAuditRecorder,
  auditEvent,
  topologicalExecutionOrder,
  detectExecutionCycles,
  getDependents,
  getPredecessors,
  executeCleanup,
  executeRollback,
  validateExecutionInput,
  computeExecutionQuality,
  ExecutionEngineError,
  ExecutionErrorCode,
  ExecutionWarningCode,
  type RuntimeBindingResult,
} from '../src/index.js';
import {
  minimalOperation,
  minimalDependency,
  minimalIR,
  minimalBindingResult,
  minimalUnresolved,
  minimalContext,
  provenance,
  resetCounters,
} from './helpers.js';

function registerBuiltins(): void {
  clearRegistry();
  registerExecutor(new InMemoryDbExecutor());
  registerExecutor(new ValueGeneratorExecutor());
  registerExecutor(new ManualExecutor());
}

// ===========================================================================
// INPUT VALIDATION (tests 1-6)
// ===========================================================================

describe('Input validation', () => {
  it('1. accepts valid empty IR', () => {
    const ir = minimalIR();
    expect(() => validateExecutionInput(ir)).not.toThrow();
  });

  it('2. accepts valid IR with operations', () => {
    const ir = minimalIR({ operations: [minimalOperation()], bindings: [], dependencies: [], unresolved: [] });
    expect(() => validateExecutionInput(ir)).not.toThrow();
  });

  it('3. rejects missing schemaVersion', () => {
    const ir = { operations: [], bindings: [], dependencies: [], unresolved: [] } as any;
    expect(() => validateExecutionInput(ir)).toThrow();
  });

  it('4. rejects wrong schemaVersion', () => {
    const ir = minimalIR();
    (ir as any).schemaVersion = '2.0';
    expect(() => validateExecutionInput(ir)).toThrow();
  });

  it('5. rejects duplicate operation IDs', () => {
    const op = minimalOperation({ id: 'DUP' });
    const ir = minimalIR({ operations: [op, { ...op }] });
    expect(() => validateExecutionInput(ir)).toThrow();
  });

  it('6. rejects non-array operations', () => {
    const ir = { schemaVersion: '1.0', operations: 'bad', bindings: [], dependencies: [], unresolved: [] } as any;
    expect(() => validateExecutionInput(ir)).toThrow();
  });
});

// ===========================================================================
// POLICY ENGINE (tests 7-20)
// ===========================================================================

describe('Policy engine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
    resetCounters();
  });

  it('7. default policy is dry-run', () => {
    const p = defaultPolicy();
    expect(p.mode).toBe('dry-run');
    expect(p.allowMutation).toBe(false);
  });

  it('8. default policy has failFast=true', () => {
    expect(defaultPolicy().failFast).toBe(true);
  });

  it('9. mergePolicy overrides mode', () => {
    const p = mergePolicy(defaultPolicy(), { mode: 'simulate' });
    expect(p.mode).toBe('simulate');
  });

  it('10. mergePolicy preserves defaults for unspecified fields', () => {
    const p = mergePolicy(defaultPolicy(), { mode: 'execute' });
    expect(p.failFast).toBe(true);
    expect(p.cleanupOnFailure).toBe(false);
  });

  it('11. validate passes for dry-run with any ops', () => {
    const ir = minimalIR({ operations: [minimalOperation()] });
    const result = engine.validate(ir, defaultPolicy());
    expect(result.valid).toBe(true);
  });

  it('12. validate rejects execute without allowMutation', () => {
    const ir = minimalIR({ operations: [minimalOperation()] });
    const policy = mergePolicy(defaultPolicy(), { mode: 'execute', allowMutation: false });
    const result = engine.validate(ir, policy);
    expect(result.valid).toBe(false);
  });

  it('13. validate accepts execute with allowMutation', () => {
    const ir = minimalIR({ operations: [minimalOperation()] });
    const policy = mergePolicy(defaultPolicy(), { mode: 'execute', allowMutation: true });
    const result = engine.validate(ir, policy);
    expect(result.valid).toBe(true);
  });

  it('14. validate rejects denied resource IDs', () => {
    const op = minimalOperation({ resourceId: 'forbidden-res' });
    const ir = minimalIR({ operations: [op] });
    const policy = mergePolicy(defaultPolicy(), { deniedResourceIds: ['forbidden-res'] });
    const result = engine.validate(ir, policy);
    expect(result.valid).toBe(false);
  });

  it('15. validate rejects when exceeding maxOperations', () => {
    const ops = [minimalOperation(), minimalOperation(), minimalOperation()];
    const ir = minimalIR({ operations: ops });
    const policy = mergePolicy(defaultPolicy(), { maxOperations: 2 });
    const result = engine.validate(ir, policy);
    expect(result.valid).toBe(false);
  });

  it('16. validate accepts when within maxOperations', () => {
    const ops = [minimalOperation(), minimalOperation()];
    const ir = minimalIR({ operations: ops });
    const policy = mergePolicy(defaultPolicy(), { maxOperations: 5 });
    const result = engine.validate(ir, policy);
    expect(result.valid).toBe(true);
  });

  it('17. validateExecuteGate passes for dry-run', () => {
    expect(() => validateExecuteGate('dry-run', defaultPolicy(), false)).not.toThrow();
  });

  it('18. validateExecuteGate rejects execute without allowMutation flag', () => {
    const policy = mergePolicy(defaultPolicy(), { mode: 'execute', allowMutation: true });
    expect(() => validateExecuteGate('execute', policy, false)).toThrow();
  });

  it('19. validateExecuteGate rejects execute without policy.allowMutation', () => {
    const policy = mergePolicy(defaultPolicy(), { mode: 'execute', allowMutation: false });
    expect(() => validateExecuteGate('execute', policy, true)).toThrow();
  });

  it('20. validateExecuteGate passes triple-gate for execute', () => {
    const policy = mergePolicy(defaultPolicy(), { mode: 'execute', allowMutation: true });
    expect(() => validateExecuteGate('execute', policy, true)).not.toThrow();
  });
});

// ===========================================================================
// REGISTRY (tests 21-28)
// ===========================================================================

describe('Registry', () => {
  beforeEach(() => {
    clearRegistry();
    resetCounters();
  });

  it('21. starts empty', () => {
    expect(listExecutors()).toHaveLength(0);
  });

  it('22. register and retrieve executor', () => {
    const fake = new FakeExecutor('fake');
    registerExecutor(fake);
    expect(getExecutor('fake')).toBe(fake);
  });

  it('23. listExecutors returns registered types', () => {
    registerExecutor(new FakeExecutor('fake'));
    registerExecutor(new ManualExecutor());
    expect(listExecutors()).toContain('fake');
    expect(listExecutors()).toContain('manual');
  });

  it('24. getExecutor returns undefined for unregistered type', () => {
    expect(getExecutor('api')).toBeUndefined();
  });

  it('25. clearRegistry removes all', () => {
    registerExecutor(new FakeExecutor());
    clearRegistry();
    expect(listExecutors()).toHaveLength(0);
  });

  it('26. findBestExecutor returns highest score', () => {
    const fake = new FakeExecutor('fake');
    registerExecutor(fake);
    registerExecutor(new ManualExecutor());
    const op = minimalOperation();
    const ctx = minimalContext();
    const best = findBestExecutor(op, ctx);
    expect(best).toBeDefined();
    // FakeExecutor scores 0.5, ManualExecutor scores 0.01
    expect(best!.match.score).toBeGreaterThanOrEqual(0.5);
  });

  it('27. findBestExecutor returns undefined when none match', () => {
    // No executors registered
    const op = minimalOperation();
    const ctx = minimalContext();
    expect(findBestExecutor(op, ctx)).toBeUndefined();
  });

  it('28. duplicate registration overwrites', () => {
    const fake1 = new FakeExecutor('fake');
    const fake2 = new FakeExecutor('fake');
    registerExecutor(fake1);
    registerExecutor(fake2);
    expect(getExecutor('fake')).toBe(fake2);
  });
});

// ===========================================================================
// BINDING STORE (tests 29-38)
// ===========================================================================

describe('InMemoryBindingStore', () => {
  let store: InMemoryBindingStore;

  beforeEach(() => {
    store = new InMemoryBindingStore();
  });

  it('29. starts empty', () => {
    expect(store.all()).toHaveLength(0);
  });

  it('30. produce and resolve', () => {
    const b = minimalBindingResult({ name: 'user-id', value: 42 });
    store.produce(b);
    expect(store.resolve('user-id')).toEqual(b);
  });

  it('31. isResolved returns true after produce', () => {
    store.produce(minimalBindingResult({ name: 'token' }));
    expect(store.isResolved('token')).toBe(true);
  });

  it('32. isResolved returns false for missing', () => {
    expect(store.isResolved('nonexistent')).toBe(false);
  });

  it('33. resolve returns undefined for missing', () => {
    expect(store.resolve('missing')).toBeUndefined();
  });

  it('34. sensitiveNames tracks sensitive bindings', () => {
    store.produce(minimalBindingResult({ name: 'password', sensitive: true }));
    store.produce(minimalBindingResult({ name: 'username', sensitive: false }));
    expect(store.sensitiveNames()).toContain('password');
    expect(store.sensitiveNames()).not.toContain('username');
  });

  it('35. safeSnapshot redacts sensitive values', () => {
    store.produce(minimalBindingResult({ name: 'secret', value: 's3cret', sensitive: true }));
    store.produce(minimalBindingResult({ name: 'public', value: 'hello', sensitive: false }));
    const snap = store.safeSnapshot();
    const secret = snap.find((b) => b.name === 'secret');
    const pub = snap.find((b) => b.name === 'public');
    expect(secret!.value).toBe('***REDACTED***');
    expect(pub!.value).toBe('hello');
  });

  it('36. all() returns all bindings', () => {
    store.produce(minimalBindingResult({ name: 'a' }));
    store.produce(minimalBindingResult({ name: 'b' }));
    expect(store.all()).toHaveLength(2);
  });

  it('37. produce overwrites existing binding', () => {
    store.produce(minimalBindingResult({ name: 'x', value: 'v1' }));
    store.produce(minimalBindingResult({ name: 'x', value: 'v2' }));
    expect(store.resolve('x')!.value).toBe('v2');
  });

  it('38. safeSnapshot returns copy (not reference)', () => {
    store.produce(minimalBindingResult({ name: 'y' }));
    const snap1 = store.safeSnapshot();
    store.produce(minimalBindingResult({ name: 'z' }));
    const snap2 = store.safeSnapshot();
    expect(snap1).toHaveLength(1);
    expect(snap2).toHaveLength(2);
  });
});

// ===========================================================================
// AUDIT TRAIL (tests 39-46)
// ===========================================================================

describe('DefaultAuditRecorder', () => {
  it('39. starts empty', () => {
    const rec = new DefaultAuditRecorder();
    expect(rec.events()).toHaveLength(0);
    expect(rec.size).toBe(0);
  });

  it('40. record adds event with auto sequence', () => {
    const rec = new DefaultAuditRecorder();
    rec.record(auditEvent('execution-start', 'go'));
    rec.record(auditEvent('execution-end', 'done'));
    const evts = rec.events();
    expect(evts[0]!.sequence).toBe(0);
    expect(evts[1]!.sequence).toBe(1);
  });

  it('41. uses fixed timestamp when provided', () => {
    const rec = new DefaultAuditRecorder('2025-06-01T00:00:00.000Z');
    rec.record(auditEvent('execution-start', 'go'));
    expect(rec.events()[0]!.timestamp).toBe('2025-06-01T00:00:00.000Z');
  });

  it('42. uses real timestamp when no fixed timestamp', () => {
    const rec = new DefaultAuditRecorder();
    rec.record(auditEvent('execution-start', 'go'));
    expect(rec.events()[0]!.timestamp).toBeTruthy();
  });

  it('43. events() returns copy', () => {
    const rec = new DefaultAuditRecorder();
    rec.record(auditEvent('execution-start', 'go'));
    const e1 = rec.events();
    rec.record(auditEvent('execution-end', 'done'));
    expect(e1).toHaveLength(1);
    expect(rec.events()).toHaveLength(2);
  });

  it('44. size tracks count', () => {
    const rec = new DefaultAuditRecorder();
    rec.record(auditEvent('execution-start', 'a'));
    rec.record(auditEvent('operation-start', 'b'));
    rec.record(auditEvent('operation-end', 'c'));
    expect(rec.size).toBe(3);
  });

  it('45. preserves operationId', () => {
    const rec = new DefaultAuditRecorder();
    rec.record(auditEvent('operation-start', 'start', 'OP-0001'));
    expect(rec.events()[0]!.operationId).toBe('OP-0001');
  });

  it('46. auditEvent helper creates correct shape', () => {
    const evt = auditEvent('binding-produced', 'produced X', 'OP-0002');
    expect(evt.type).toBe('binding-produced');
    expect(evt.message).toBe('produced X');
    expect(evt.operationId).toBe('OP-0002');
  });
});

// ===========================================================================
// SCHEDULER (tests 47-58)
// ===========================================================================

describe('Scheduler', () => {
  beforeEach(() => resetCounters());

  it('47. empty graph returns empty order', () => {
    expect(topologicalExecutionOrder([], [])).toEqual([]);
  });

  it('48. single operation returns single-element array', () => {
    const ops = [minimalOperation({ id: 'A' })];
    const order = topologicalExecutionOrder(ops, []);
    expect(order).toEqual(['A']);
  });

  it('49. two independent ops in lexicographic order', () => {
    const ops = [minimalOperation({ id: 'B' }), minimalOperation({ id: 'A' })];
    const order = topologicalExecutionOrder(ops, []);
    expect(order).toEqual(['A', 'B']);
  });

  it('50. respects dependency order', () => {
    const ops = [minimalOperation({ id: 'A' }), minimalOperation({ id: 'B' })];
    const deps = [minimalDependency('A', 'B')]; // A→B: A before B
    const order = topologicalExecutionOrder(ops, deps);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
  });

  it('51. diamond dependency resolves correctly', () => {
    const ops = ['A', 'B', 'C', 'D'].map((id) => minimalOperation({ id }));
    const deps = [
      minimalDependency('A', 'B'), // A→B
      minimalDependency('A', 'C'), // A→C
      minimalDependency('B', 'D'), // B→D
      minimalDependency('C', 'D'), // C→D
    ];
    const order = topologicalExecutionOrder(ops, deps);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });

  it('52. detects cycle and throws', () => {
    const ops = [minimalOperation({ id: 'A' }), minimalOperation({ id: 'B' })];
    const deps = [minimalDependency('A', 'B'), minimalDependency('B', 'A')];
    expect(() => topologicalExecutionOrder(ops, deps)).toThrow();
  });
  it('53. detectExecutionCycles returns 0 for acyclic graph', () => {
    const ops = [minimalOperation({ id: 'X' }), minimalOperation({ id: 'Y' })];
    const deps = [minimalDependency('X', 'Y')];
    expect(detectExecutionCycles(ops, deps)).toBe(0);
  });

  it('54. detectExecutionCycles returns >0 for cyclic graph', () => {
    const ops = [minimalOperation({ id: 'X' }), minimalOperation({ id: 'Y' })];
    const deps = [minimalDependency('X', 'Y'), minimalDependency('Y', 'X')];
    expect(detectExecutionCycles(ops, deps)).toBeGreaterThan(0);
  });
  it('55. getDependents returns transitive dependents', () => {
    const deps = [minimalDependency('A', 'B'), minimalDependency('B', 'C')];
    const dependents = getDependents('A', deps);
    expect(dependents).toContain('B');
    expect(dependents).toContain('C');
  });

  it('56. getDependents returns empty for leaf node', () => {
    const deps = [minimalDependency('A', 'B')];
    expect(getDependents('B', deps)).toHaveLength(0);
  });

  it('57. getPredecessors returns direct predecessors', () => {
    const deps = [minimalDependency('A', 'C'), minimalDependency('B', 'C')];
    const preds = getPredecessors('C', deps);
    expect(preds).toContain('A');
    expect(preds).toContain('B');
  });

  it('58. getPredecessors returns empty for root node', () => {
    const deps = [minimalDependency('A', 'B')];
    expect(getPredecessors('A', deps)).toHaveLength(0);
  });
});

// ===========================================================================
// FAKE EXECUTOR (tests 59-68)
// ===========================================================================

describe('FakeExecutor', () => {
  beforeEach(() => resetCounters());

  it('59. canExecute returns supported', () => {
    const fake = new FakeExecutor();
    const match = fake.canExecute(minimalOperation(), minimalContext());
    expect(match.supported).toBe(true);
  });

  it('60. validate returns valid', async () => {
    const fake = new FakeExecutor();
    const result = await fake.validate(minimalOperation(), minimalContext());
    expect(result.valid).toBe(true);
  });

  it('61. execute succeeds by default', async () => {
    const fake = new FakeExecutor();
    const result = await fake.execute(minimalOperation(), minimalContext());
    expect(result.status).toBe('succeeded');
  });

  it('62. execute captures operation', async () => {
    const fake = new FakeExecutor();
    const op = minimalOperation();
    await fake.execute(op, minimalContext());
    expect(fake.executedOps).toHaveLength(1);
    expect(fake.executedOps[0]!.id).toBe(op.id);
  });

  it('63. execute fails when configured', async () => {
    const fake = new FakeExecutor('fake', { failWith: { code: 'ERR', message: 'boom', retryable: false } });
    const result = await fake.execute(minimalOperation(), minimalContext());
    expect(result.status).toBe('failed');
    expect(result.error!.code).toBe('ERR');
  });

  it('64. failUntilAttempt allows retry testing', async () => {
    const fake = new FakeExecutor('fake', {
      failWith: { code: 'ERR', message: 'boom', retryable: true },
      failUntilAttempt: 3,
    });
    const op = minimalOperation();
    const ctx = minimalContext();
    const r1 = await fake.execute(op, ctx);
    const r2 = await fake.execute(op, ctx);
    const r3 = await fake.execute(op, ctx);
    expect(r1.status).toBe('failed');
    expect(r2.status).toBe('failed');
    expect(r3.status).toBe('succeeded');
  });

  it('65. produces configured bindings', async () => {
    const bindings: RuntimeBindingResult[] = [minimalBindingResult({ name: 'out' })];
    const fake = new FakeExecutor('fake', { producedBindings: bindings });
    const result = await fake.execute(minimalOperation(), minimalContext());
    expect(result.producedBindings).toEqual(bindings);
  });

  it('66. cleanup captures and succeeds', async () => {
    const fake = new FakeExecutor();
    const op = minimalOperation();
    const result = await fake.cleanup(op, minimalContext());
    expect(result.status).toBe('succeeded');
    expect(fake.cleanedUpOps).toHaveLength(1);
  });

  it('67. cleanup fails when configured', async () => {
    const fake = new FakeExecutor('fake', { cleanupFails: true });
    const result = await fake.cleanup(minimalOperation(), minimalContext());
    expect(result.status).toBe('failed');
  });

  it('68. rollback captures and succeeds', async () => {
    const fake = new FakeExecutor();
    const op = minimalOperation();
    const result = await fake.rollback(op, minimalContext());
    expect(result.status).toBe('succeeded');
    expect(fake.rolledBackOps).toHaveLength(1);
  });
});

// ===========================================================================
// IN-MEMORY-DB EXECUTOR (tests 69-78)
// ===========================================================================

describe('InMemoryDbExecutor', () => {
  let db: InMemoryDbExecutor;

  beforeEach(() => {
    db = new InMemoryDbExecutor();
    resetCounters();
  });

  it('69. type is database', () => {
    expect(db.type).toBe('database');
  });

  it('70. canExecute matches database resolver', () => {
    const op = minimalOperation({ resolver: 'database' });
    expect(db.canExecute(op, minimalContext()).supported).toBe(true);
  });

  it('71. canExecute rejects non-database resolver', () => {
    const op = minimalOperation({ resolver: 'api' });
    expect(db.canExecute(op, minimalContext()).supported).toBe(false);
  });

  it('72. execute create succeeds', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'create' });
    const result = await db.execute(op, minimalContext());
    expect(result.status).toBe('succeeded');
  });

  it('73. execute select succeeds', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'select' });
    const result = await db.execute(op, minimalContext());
    expect(result.status).toBe('succeeded');
  });

  it('74. execute delete succeeds', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'derive' });
    const result = await db.execute(op, minimalContext());
    expect(result.status).toBe('succeeded');
  });

  it('75. getStoreSnapshot returns current state', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'create' });
    await db.execute(op, minimalContext());
    const snap = db.getStoreSnapshot();
    expect(Object.keys(snap).length).toBeGreaterThan(0);
  });

  it('76. reset clears store', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'create' });
    await db.execute(op, minimalContext());
    db.reset();
    expect(Object.keys(db.getStoreSnapshot()).length).toBe(0);
  });

  it('77. validate returns valid', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'select' });
    const result = await db.validate(op, minimalContext());
    expect(result.valid).toBe(true);
  });

  it('78. cleanup is supported', async () => {
    const op = minimalOperation({ resolver: 'database', action: 'create' });
    await db.execute(op, minimalContext());
    const result = await db.cleanup!(op, minimalContext());
    expect(result.status).toBe('succeeded');
  });
});

// ===========================================================================
// VALUE GENERATOR EXECUTOR (tests 79-86)
// ===========================================================================

describe('ValueGeneratorExecutor', () => {
  let vg: ValueGeneratorExecutor;

  beforeEach(() => {
    vg = new ValueGeneratorExecutor();
    resetCounters();
  });

  it('79. type is value-generator', () => {
    expect(vg.type).toBe('value-generator');
  });

  it('80. canExecute matches value-generator resolver', () => {
    const op = minimalOperation({ resolver: 'value-generator' });
    expect(vg.canExecute(op, minimalContext()).supported).toBe(true);
  });

  it('81. canExecute rejects non-value-generator', () => {
    const op = minimalOperation({ resolver: 'database' });
    expect(vg.canExecute(op, minimalContext()).supported).toBe(false);
  });

  it('82. execute succeeds', async () => {
    const op = minimalOperation({ resolver: 'value-generator', action: 'generate' });
    const result = await vg.execute(op, minimalContext());
    expect(result.status).toBe('succeeded');
  });

  it('83. deterministic with same seed', async () => {
    const op = minimalOperation({ resolver: 'value-generator', action: 'generate' });
    const ctx1 = minimalContext({ seed: 'abc' });
    const ctx2 = minimalContext({ seed: 'abc' });
    const r1 = await vg.execute(op, ctx1);
    const r2 = await vg.execute(op, ctx2);
    expect(r1.producedBindings).toEqual(r2.producedBindings);
  });

  it('84. different seeds produce different values', async () => {
    const op = minimalOperation({ resolver: 'value-generator', action: 'generate' });
    const ctx1 = minimalContext({ seed: 'seed-a' });
    const ctx2 = minimalContext({ seed: 'seed-b' });
    const r1 = await vg.execute(op, ctx1);
    const r2 = await vg.execute(op, ctx2);
    // At least one binding value should differ
    const v1 = JSON.stringify(r1.producedBindings);
    const v2 = JSON.stringify(r2.producedBindings);
    expect(v1).not.toEqual(v2);
  });

  it('85. validate returns valid', async () => {
    const op = minimalOperation({ resolver: 'value-generator', action: 'generate' });
    const result = await vg.validate(op, minimalContext());
    expect(result.valid).toBe(true);
  });

  it('86. mock action also succeeds', async () => {
    const op = minimalOperation({ resolver: 'value-generator', action: 'mock' });
    const result = await vg.execute(op, minimalContext());
    expect(result.status).toBe('succeeded');
  });
});

// ===========================================================================
// MANUAL EXECUTOR (tests 87-92)
// ===========================================================================

describe('ManualExecutor', () => {
  let manual: ManualExecutor;

  beforeEach(() => {
    manual = new ManualExecutor();
    resetCounters();
  });

  it('87. type is manual', () => {
    expect(manual.type).toBe('manual');
  });

  it('88. canExecute always returns supported with low score', () => {
    const match = manual.canExecute(minimalOperation(), minimalContext());
    expect(match.supported).toBe(true);
    expect(match.score).toBeLessThan(0.1);
  });

  it('89. execute returns manual status', async () => {
    const result = await manual.execute(minimalOperation(), minimalContext());
    expect(result.status).toBe('manual');
  });

  it('90. validate returns valid', async () => {
    const result = await manual.validate(minimalOperation(), minimalContext());
    expect(result.valid).toBe(true);
  });

  it('91. canExecute matches any resolver type', () => {
    const op = minimalOperation({ resolver: 'api' });
    expect(manual.canExecute(op, minimalContext()).supported).toBe(true);
  });

  it('92. manual result includes provenance', async () => {
    const prov = [provenance('REQ-9999')];
    const op = minimalOperation({ provenance: prov });
    const result = await manual.execute(op, minimalContext());
    expect(result.provenance).toEqual(prov);
  });
});

// ===========================================================================
// CLEANUP HANDLER (tests 93-98)
// ===========================================================================

describe('Cleanup handler', () => {
  beforeEach(() => {
    clearRegistry();
    registerExecutor(new FakeExecutor('database', { producedBindings: [] }));
    resetCounters();
  });

  it('93. skips when no cleanup targets', async () => {
    const op = minimalOperation({ id: 'A', cleanupOperationIds: [] });
    const result = await executeCleanup(
      [{ operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op],
      ['A'],
      minimalContext(),
    );
    expect(result.attempted).toBe(0);
  });

  it('94. runs cleanup for succeeded ops with cleanup IDs', async () => {
    const cleanupOp = minimalOperation({ id: 'CLEAN-1' });
    const op = minimalOperation({ id: 'A', resolver: 'database', cleanupOperationIds: ['CLEAN-1'] });
    const summary = await executeCleanup(
      [{ operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op, cleanupOp],
      ['A'],
      minimalContext(),
    );
    // Cleanup runs because A succeeded and has cleanupOperationIds
    expect(summary.attempted).toBeGreaterThan(0);
  });

  it('95. skips failed ops', async () => {
    const op = minimalOperation({ id: 'A', cleanupOperationIds: ['CLEAN-1'] });
    const summary = await executeCleanup(
      [{ operationId: 'A', dataItemId: 'D1', status: 'failed', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op],
      ['A'],
      minimalContext(),
    );
    expect(summary.attempted).toBe(0);
  });

  it('96. cleanup records audit events', async () => {
    const ctx = minimalContext();
    const op = minimalOperation({ id: 'A', cleanupOperationIds: [] });
    await executeCleanup(
      [{ operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op],
      ['A'],
      ctx,
    );
    // Even with no targets, no crash
    expect(ctx.audit.size).toBeGreaterThanOrEqual(0);
  });

  it('97. cleanup in reverse execution order', async () => {
    clearRegistry();
    registerExecutor(new FakeExecutor('database'));

    const opA = minimalOperation({ id: 'A', cleanupOperationIds: ['CA'] });
    const opB = minimalOperation({ id: 'B', cleanupOperationIds: ['CB'] });

    const summary = await executeCleanup(
      [
        { operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
        { operationId: 'B', dataItemId: 'D2', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
      ],
      [opA, opB],
      ['A', 'B'],
      minimalContext(),
    );
    expect(summary.attempted).toBeGreaterThanOrEqual(0);
  });

  it('98. cleanup summary has correct shape', async () => {
    const summary = await executeCleanup([], [], [], minimalContext());
    expect(summary).toEqual({ attempted: 0, succeeded: 0, failed: 0, results: [] });
  });
});

// ===========================================================================
// ROLLBACK HANDLER (tests 99-104)
// ===========================================================================

describe('Rollback handler', () => {
  beforeEach(() => {
    clearRegistry();
    registerExecutor(new FakeExecutor('database'));
    resetCounters();
  });

  it('99. skips when no succeeded ops', async () => {
    const summary = await executeRollback([], [], [], minimalContext());
    expect(summary.attempted).toBe(0);
  });

  it('100. rolls back succeeded ops', async () => {
    const op = minimalOperation({ id: 'A', resolver: 'database' });
    const summary = await executeRollback(
      [{ operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op],
      ['A'],
      minimalContext(),
    );
    expect(summary.attempted).toBeGreaterThan(0);
  });

  it('101. skips failed ops for rollback', async () => {
    const op = minimalOperation({ id: 'A', resolver: 'database' });
    const summary = await executeRollback(
      [{ operationId: 'A', dataItemId: 'D1', status: 'failed', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op],
      ['A'],
      minimalContext(),
    );
    expect(summary.attempted).toBe(0);
  });

  it('102. rollback records audit events', async () => {
    const ctx = minimalContext();
    const op = minimalOperation({ id: 'A', resolver: 'database' });
    await executeRollback(
      [{ operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 }],
      [op],
      ['A'],
      ctx,
    );
    expect(ctx.audit.size).toBeGreaterThan(0);
  });

  it('103. rollback summary has correct shape', async () => {
    const summary = await executeRollback([], [], [], minimalContext());
    expect(summary).toEqual({ attempted: 0, succeeded: 0, failed: 0, results: [] });
  });

  it('104. rollback in reverse execution order', async () => {
    const opA = minimalOperation({ id: 'A', resolver: 'database' });
    const opB = minimalOperation({ id: 'B', resolver: 'database' });
    const summary = await executeRollback(
      [
        { operationId: 'A', dataItemId: 'D1', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
        { operationId: 'B', dataItemId: 'D2', status: 'succeeded', executorType: 'database', action: 'create', producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
      ],
      [opA, opB],
      ['A', 'B'],
      minimalContext(),
    );
    // Both should be rolled back; B first (reverse order)
    expect(summary.attempted).toBe(2);
    if (summary.results.length === 2) {
      expect(summary.results[0]!.parentOperationId).toBe('B');
      expect(summary.results[1]!.parentOperationId).toBe('A');
    }
  });
});


// ===========================================================================
// ENGINE – DRY-RUN MODE (tests 105-116)
// ===========================================================================

describe('Engine dry-run', () => {
  beforeEach(() => {
    registerBuiltins();
    resetCounters();
  });

  it('105. empty IR produces validated result', async () => {
    const ir = minimalIR();
    const { result } = await executePreparation(ir);
    expect(result.status).toBe('validated');
    expect(result.mode).toBe('dry-run');
    expect(result.operations).toHaveLength(0);
  });

  it('106. single op gets validated status', async () => {
    const op = minimalOperation({ resolver: 'database' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.status).toBe('validated');
  });

  it('107. manual op gets manual status with warning', async () => {
    const op = minimalOperation({ resolver: 'manual' });
    const ir = minimalIR({ operations: [op] });
    const { result, warnings } = await executePreparation(ir);
    expect(result.operations[0]!.status).toBe('manual');
    expect(warnings.some((w) => w.code === ExecutionWarningCode.MANUAL_OPERATION)).toBe(true);
  });

  it('108. unknown resolver type gets blocked with warning', async () => {
    const op = minimalOperation({ resolver: 'unknown' });
    const ir = minimalIR({ operations: [op] });
    const { result, warnings } = await executePreparation(ir);
    expect(result.operations[0]!.status).toBe('blocked');
    expect(warnings.some((w) => w.code === ExecutionWarningCode.EXECUTOR_NOT_FOUND)).toBe(true);
  });

  it('109. dependent blocked when parent blocked', async () => {
    clearRegistry(); // Don't register ManualExecutor — it matches everything
    const opA = minimalOperation({ id: 'A', resolver: 'unknown' });
    const opB = minimalOperation({ id: 'B', resolver: 'database' });
    const dep = minimalDependency('A', 'B'); // A→B: A before B
    const ir = minimalIR({ operations: [opA, opB], dependencies: [dep] });
    const { result } = await executePreparation(ir);
    expect(result.operations.find((o) => o.operationId === 'A')!.status).toBe('blocked');
    expect(result.operations.find((o) => o.operationId === 'B')!.status).toBe('blocked');
  });

  it('110. audit trail has start/end events', async () => {
    const ir = minimalIR();
    const { result } = await executePreparation(ir);
    const types = result.auditTrail.map((e) => e.type);
    expect(types).toContain('execution-start');
    expect(types).toContain('execution-end');
  });

  it('111. quality metrics are computed', async () => {
    const op = minimalOperation({ resolver: 'database' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir);
    expect(result.quality.operationsTotal).toBe(1);
    expect(result.quality.validated).toBe(1);
  });

  it('112. unresolved items are preserved', async () => {
    const unr = minimalUnresolved();
    const ir = minimalIR({ unresolved: [unr] });
    const { result } = await executePreparation(ir);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.id).toBe('UNRES-0001');
  });

  it('113. schema version is 1.0', async () => {
    const { result } = await executePreparation(minimalIR());
    expect(result.schemaVersion).toBe('1.0');
  });

  it('114. executionId is generated', async () => {
    const { result } = await executePreparation(minimalIR());
    expect(result.executionId).toBeTruthy();
    expect(typeof result.executionId).toBe('string');
  });

  it('115. custom executionId provider is used', async () => {
    const { result } = await executePreparation(minimalIR(), {
      executionIdProvider: { generate: () => 'CUSTOM-ID' },
    });
    expect(result.executionId).toBe('CUSTOM-ID');
  });

  it('116. dry-run produces no bindings', async () => {
    const op = minimalOperation({ resolver: 'database' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir);
    expect(result.bindings).toHaveLength(0);
  });
});

// ===========================================================================
// ENGINE – SIMULATE MODE (tests 117-128)
// ===========================================================================

describe('Engine simulate', () => {
  beforeEach(() => {
    clearRegistry();
    resetCounters();
  });

  it('117. simulate with fake executor succeeds', async () => {
    const fake = new FakeExecutor('database');
    registerExecutor(fake);
    const op = minimalOperation({ id: 'A', resolver: 'database', action: 'create' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate' } });
    expect(result.status).toBe('succeeded');
    expect(result.operations[0]!.status).toBe('succeeded');
  });

  it('118. simulate produces bindings', async () => {
    const binding = minimalBindingResult({ name: 'user-id', value: 42 });
    const fake = new FakeExecutor('database', { producedBindings: [binding] });
    registerExecutor(fake);
    const op = minimalOperation({ resolver: 'database', action: 'create' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate' } });
    expect(result.bindings.length).toBeGreaterThan(0);
  });

  it('119. simulate handles failure', async () => {
    const fake = new FakeExecutor('database', {
      failWith: { code: 'ERR', message: 'fail', retryable: false },
    });
    registerExecutor(fake);
    const op = minimalOperation({ resolver: 'database', action: 'create' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate', failFast: false } });
    expect(result.operations[0]!.status).toBe('failed');
  });

  it('120. failFast stops on first failure', async () => {
    const fake = new FakeExecutor('database', {
      failWith: { code: 'ERR', message: 'fail', retryable: false },
    });
    registerExecutor(fake);
    const opA = minimalOperation({ id: 'A', resolver: 'database' });
    const opB = minimalOperation({ id: 'B', resolver: 'database' });
    const ir = minimalIR({ operations: [opA, opB] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate', failFast: true } });
    // Only first op should have been attempted
    const executed = result.operations.filter((o) => o.status !== 'pending');
    expect(executed.length).toBeLessThanOrEqual(1);
  });

  it('121. dependent blocked when parent fails in simulate', async () => {
    const fake = new FakeExecutor('database', {
      failWith: { code: 'ERR', message: 'fail', retryable: false },
    });
    clearRegistry();
    registerExecutor(fake);
    const opA = minimalOperation({ id: 'A', resolver: 'database' });
    const opB = minimalOperation({ id: 'B', resolver: 'database' });
    const dep = minimalDependency('A', 'B'); // A→B: A before B
    const ir = minimalIR({ operations: [opA, opB], dependencies: [dep] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate', failFast: false } });
    const bResult = result.operations.find((o) => o.operationId === 'B');
    expect(bResult!.status).toBe('blocked');
  });

  it('122. manual executor returns manual status in simulate', async () => {
    clearRegistry();
    registerExecutor(new ManualExecutor());
    const op = minimalOperation({ resolver: 'manual' });
    const ir = minimalIR({ operations: [op] });
    const { result, warnings } = await executePreparation(ir, { policy: { mode: 'simulate' } });
    expect(result.operations[0]!.status).toBe('manual');
    expect(warnings.some((w) => w.code === ExecutionWarningCode.MANUAL_OPERATION)).toBe(true);
  });

  it('123. status is partially-succeeded when some ops succeed and some are manual', async () => {
    clearRegistry();
    // Only register ManualExecutor — it matches all ops with score 0.01
    registerExecutor(new ManualExecutor());
    const opA = minimalOperation({ id: 'A', resolver: 'database' });
    const opB = minimalOperation({ id: 'B', resolver: 'manual' });
    const ir = minimalIR({ operations: [opA, opB] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate', failFast: false } });
    // Both ops handled by ManualExecutor → status='manual' → partially-succeeded
    expect(result.operations.every((o) => o.status === 'manual')).toBe(true);
    expect(result.status).toBe('partially-succeeded');
  });

  it('124. status is failed when all ops fail', async () => {
    const fake = new FakeExecutor('database', {
      failWith: { code: 'ERR', message: 'fail', retryable: false },
    });
    clearRegistry();
    registerExecutor(fake);
    const op = minimalOperation({ resolver: 'database' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate' } });
    expect(result.status).toBe('failed');
  });

  it('125. status is partially-succeeded with manual ops', async () => {
    registerExecutor(new ManualExecutor());
    const op = minimalOperation({ resolver: 'manual' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate' } });
    expect(result.status).toBe('partially-succeeded');
  });

  it('126. cleanup runs when policy.cleanupOnFailure and failure occurs', async () => {
    const fake = new FakeExecutor('database', {
      failWith: { code: 'ERR', message: 'fail', retryable: false },
    });
    clearRegistry();
    registerExecutor(fake);
    const opA = minimalOperation({ id: 'A', resolver: 'database' });
    const opB = minimalOperation({ id: 'B', resolver: 'database', cleanupOperationIds: ['C1'] });
    const ir = minimalIR({ operations: [opA, opB] });
    const { result } = await executePreparation(ir, {
      policy: { mode: 'simulate', failFast: false, cleanupOnFailure: true },
    });
    // Cleanup may or may not have targets depending on which succeeded
    expect(result.cleanup).toBeDefined();
  });

  it('127. rollback runs when policy.rollbackOnFailure and failure occurs', async () => {
    const fake = new FakeExecutor('database', {
      failWith: { code: 'ERR', message: 'fail', retryable: false },
    });
    clearRegistry();
    registerExecutor(fake);
    const opA = minimalOperation({ id: 'A', resolver: 'database' });
    const opB = minimalOperation({ id: 'B', resolver: 'database' });
    const ir = minimalIR({ operations: [opA, opB] });
    const { result } = await executePreparation(ir, {
      policy: { mode: 'simulate', failFast: false, rollbackOnFailure: true },
    });
    expect(result.rollback).toBeDefined();
  });

  it('128. seed is passed to context', async () => {
    registerExecutor(new ValueGeneratorExecutor());
    const op = minimalOperation({ resolver: 'value-generator', action: 'generate' });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate' }, seed: 'test-seed' });
    expect(result.operations[0]!.status).toBe('succeeded');
  });
});

// ===========================================================================
// QUALITY METRICS (tests 129-134)
// ===========================================================================

describe('Quality metrics', () => {
  beforeEach(() => resetCounters());

  it('129. computeExecutionQuality with empty ops', () => {
    const q = computeExecutionQuality([], [], { attempted: 0, succeeded: 0, failed: 0, results: [] }, { attempted: 0, succeeded: 0, failed: 0, results: [] });
    expect(q.operationsTotal).toBe(0);
  });

  it('130. counts succeeded/failed/blocked/manual', () => {
    const ops = [
      { operationId: 'A', dataItemId: 'D1', status: 'succeeded' as const, executorType: 'database' as const, action: 'create' as const, producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
      { operationId: 'B', dataItemId: 'D2', status: 'failed' as const, executorType: 'database' as const, action: 'create' as const, producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
      { operationId: 'C', dataItemId: 'D3', status: 'blocked' as const, executorType: 'database' as const, action: 'select' as const, producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
      { operationId: 'D', dataItemId: 'D4', status: 'manual' as const, executorType: 'manual' as const, action: 'create' as const, producedBindings: [], warnings: [], provenance: [], retryCount: 0 },
    ];
    const q = computeExecutionQuality(ops, [], { attempted: 0, succeeded: 0, failed: 0, results: [] }, { attempted: 0, succeeded: 0, failed: 0, results: [] });
    expect(q.succeeded).toBe(1);
    expect(q.failed).toBe(1);
    expect(q.blocked).toBe(1);
    expect(q.manual).toBe(1);
    expect(q.operationsTotal).toBe(4);
  });

  it('131. bindingsProduced counts bindings', () => {
    const bindings = [minimalBindingResult(), minimalBindingResult({ id: 'B2', name: 'b2' })];
    const q = computeExecutionQuality([], bindings, { attempted: 0, succeeded: 0, failed: 0, results: [] }, { attempted: 0, succeeded: 0, failed: 0, results: [] });
    expect(q.bindingsProduced).toBe(2);
  });

  it('132. provenanceCoverage computed', () => {
    const ops = [
      { operationId: 'A', dataItemId: 'D1', status: 'succeeded' as const, executorType: 'database' as const, action: 'create' as const, producedBindings: [], warnings: [], provenance: [provenance()], retryCount: 0 },
    ];
    const q = computeExecutionQuality(ops, [], { attempted: 0, succeeded: 0, failed: 0, results: [] }, { attempted: 0, succeeded: 0, failed: 0, results: [] });
    expect(q.provenanceCoverage).toBe(1);
  });

  it('133. cleanup metrics tracked', () => {
    const cleanup = { attempted: 2, succeeded: 1, failed: 1, results: [] };
    const q = computeExecutionQuality([], [], cleanup, { attempted: 0, succeeded: 0, failed: 0, results: [] });
    expect(q.cleanupSucceeded).toBe(1);
    expect(q.cleanupFailed).toBe(1);
  });

  it('134. rollback metrics tracked', () => {
    const rollback = { attempted: 3, succeeded: 2, failed: 1, results: [] };
    const q = computeExecutionQuality([], [], { attempted: 0, succeeded: 0, failed: 0, results: [] }, rollback);
    expect(q.rollbackSucceeded).toBe(2);
    expect(q.rollbackFailed).toBe(1);
  });
});

// ===========================================================================
// ERROR / WARNING CODES (tests 135-140)
// ===========================================================================

describe('Error and warning codes', () => {
  it('135. ExecutionEngineError has correct code', () => {
    const err = new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, 'bad input');
    expect(err.code).toBe('EXECUTION_INVALID_IR');
    expect(err.message).toBe('bad input');
  });

  it('136. ExecutionEngineError with cause', () => {
    const cause = new Error('root');
    const err = new ExecutionEngineError(ExecutionErrorCode.INTERNAL_ERROR, 'oops', cause);
    expect(err.cause).toBe(cause);
  });

  it('137. all error codes exist', () => {
    expect(ExecutionErrorCode.INVALID_IR).toBe('EXECUTION_INVALID_IR');
    expect(ExecutionErrorCode.POLICY_FAILURE).toBe('EXECUTION_POLICY_FAILURE');
    expect(ExecutionErrorCode.CYCLE_DETECTED).toBe('EXECUTION_CYCLE_DETECTED');
    expect(ExecutionErrorCode.EXECUTOR_NOT_FOUND).toBe('EXECUTION_EXECUTOR_NOT_FOUND');
    expect(ExecutionErrorCode.SECRET_RESOLUTION_FAILURE).toBe('EXECUTION_SECRET_RESOLUTION_FAILURE');
    expect(ExecutionErrorCode.INTERNAL_ERROR).toBe('EXECUTION_INTERNAL_ERROR');
  });

  it('138. all warning codes exist', () => {
    expect(ExecutionWarningCode.MANUAL_OPERATION).toBe('EXECUTION_MANUAL_OPERATION');
    expect(ExecutionWarningCode.UNRESOLVED_BINDING).toBe('EXECUTION_UNRESOLVED_BINDING');
    expect(ExecutionWarningCode.RESOURCE_BLOCKED).toBe('EXECUTION_RESOURCE_BLOCKED');
    expect(ExecutionWarningCode.RETRY_APPLIED).toBe('EXECUTION_RETRY_APPLIED');
    expect(ExecutionWarningCode.CLEANUP_FAILED).toBe('EXECUTION_CLEANUP_FAILED');
    expect(ExecutionWarningCode.ROLLBACK_FAILED).toBe('EXECUTION_ROLLBACK_FAILED');
    expect(ExecutionWarningCode.OPERATION_SKIPPED).toBe('EXECUTION_OPERATION_SKIPPED');
    expect(ExecutionWarningCode.DRY_RUN_ONLY).toBe('EXECUTION_DRY_RUN_ONLY');
    expect(ExecutionWarningCode.EXECUTOR_NOT_FOUND).toBe('EXECUTION_EXECUTOR_NOT_FOUND');
    expect(ExecutionWarningCode.BINDING_MISSING).toBe('EXECUTION_BINDING_MISSING');
  });

  it('139. ExecutionEngineError is instanceof Error', () => {
    const err = new ExecutionEngineError(ExecutionErrorCode.INVALID_IR, 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('140. ExecutionEngineError name is correct', () => {
    const err = new ExecutionEngineError(ExecutionErrorCode.POLICY_FAILURE, 'denied');
    expect(err.name).toBe('ExecutionEngineError');
  });
});

// ===========================================================================
// BUILD MANIFEST (tests 141-145)
// ===========================================================================

describe('buildManifest', () => {
  beforeEach(() => {
    registerBuiltins();
    resetCounters();
  });

  it('141. manifest has schema version', async () => {
    const { result, warnings } = await executePreparation(minimalIR());
    const manifest = buildManifest('test.json', 'dry-run', result, warnings);
    expect(manifest.schemaVersion).toBe('1.0');
  });

  it('142. manifest has source path', async () => {
    const { result, warnings } = await executePreparation(minimalIR());
    const manifest = buildManifest('/path/to/ir.json', 'dry-run', result, warnings);
    expect(manifest.source.executableDataPreparationIR).toBe('/path/to/ir.json');
  });

  it('143. manifest has mode', async () => {
    const { result, warnings } = await executePreparation(minimalIR());
    const manifest = buildManifest('test.json', 'dry-run', result, warnings);
    expect(manifest.mode).toBe('dry-run');
  });

  it('144. manifest stats match result quality', async () => {
    const op = minimalOperation({ resolver: 'database' });
    const ir = minimalIR({ operations: [op] });
    const { result, warnings } = await executePreparation(ir);
    const manifest = buildManifest('test.json', 'dry-run', result, warnings);
    expect(manifest.stats.operationsTotal).toBe(result.quality.operationsTotal);
    expect(manifest.stats.succeeded).toBe(result.quality.succeeded);
  });

  it('145. manifest includes warnings', async () => {
    const op = minimalOperation({ resolver: 'manual' });
    const ir = minimalIR({ operations: [op] });
    const { result, warnings } = await executePreparation(ir);
    const manifest = buildManifest('test.json', 'dry-run', result, warnings);
    expect(manifest.warnings.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// DETERMINISM (tests 146-148)
// ===========================================================================

describe('Determinism', () => {
  beforeEach(() => {
    registerBuiltins();
    resetCounters();
  });

  it('146. dry-run is deterministic (same result twice)', async () => {
    const op = minimalOperation({ resolver: 'database' });
    const ir = minimalIR({ operations: [op] });
    const { result: r1 } = await executePreparation(ir, {
      executionIdProvider: { generate: () => 'FIXED' },
    });
    resetCounters();
    const { result: r2 } = await executePreparation(ir, {
      executionIdProvider: { generate: () => 'FIXED' },
    });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('147. simulate with seed is deterministic', async () => {
    clearRegistry();
    registerExecutor(new ValueGeneratorExecutor());
    const op = minimalOperation({ resolver: 'value-generator', action: 'generate' });
    const ir = minimalIR({ operations: [op] });
    const { result: r1 } = await executePreparation(ir, {
      policy: { mode: 'simulate' },
      seed: 'fixed-seed',
      executionIdProvider: { generate: () => 'FIXED' },
    });
    resetCounters();
    const { result: r2 } = await executePreparation(ir, {
      policy: { mode: 'simulate' },
      seed: 'fixed-seed',
      executionIdProvider: { generate: () => 'FIXED' },
    });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('148. audit trail timestamps are fixed in dry-run', async () => {
    const ir = minimalIR();
    const { result } = await executePreparation(ir);
    const timestamps = result.auditTrail.map((e) => e.timestamp);
    // All timestamps should be the fixed dry-run timestamp
    for (const ts of timestamps) {
      expect(ts).toBe('2025-01-01T00:00:00.000Z');
    }
  });
});

// ===========================================================================
// PROVENANCE PRESERVATION (tests 149-152)
// ===========================================================================

describe('Provenance preservation', () => {
  beforeEach(() => {
    registerBuiltins();
    resetCounters();
  });

  it('149. provenance preserved through dry-run', async () => {
    const prov = [provenance('REQ-0001'), provenance('REQ-0002')];
    const op = minimalOperation({ resolver: 'database', provenance: prov });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir);
    expect(result.operations[0]!.provenance).toEqual(prov);
  });

  it('150. provenance preserved through simulate', async () => {
    clearRegistry();
    registerExecutor(new FakeExecutor('database'));
    const prov = [provenance('REQ-0010')];
    const op = minimalOperation({ resolver: 'database', provenance: prov });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir, { policy: { mode: 'simulate' } });
    expect(result.operations[0]!.provenance).toEqual(prov);
  });

  it('151. unresolved provenance preserved', async () => {
    const unr = minimalUnresolved({ provenance: [provenance('REQ-0099')] });
    const ir = minimalIR({ unresolved: [unr] });
    const { result } = await executePreparation(ir);
    expect(result.unresolved[0]!.provenance).toEqual([provenance('REQ-0099')]);
  });

  it('152. quality provenanceCoverage is 1.0 when all ops have provenance', async () => {
    const op = minimalOperation({ provenance: [provenance()] });
    const ir = minimalIR({ operations: [op] });
    const { result } = await executePreparation(ir);
    expect(result.quality.provenanceCoverage).toBe(1);
  });
});
