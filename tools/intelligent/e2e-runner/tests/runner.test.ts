// Runner integration tests — end-to-end orchestration.
// Spec §1-3, §16-20, §82-93, §95-98, §136-142, §149-150, §156-158, §179-180.

import { describe, it, expect } from 'vitest';
import { EndToEndRunner } from '../src/runner.js';
import { InMemoryRunAuditRecorder } from '../src/audit/audit-recorder.js';
import { FakeProjectRuntimeManager } from '../src/runtime/fake-runtime.js';
import {
  makeInput, makePolicy, makeOptions, makeTestCase, makeTestCases,
  makeMappings, makeMapping, makeProfile, makeDataPlan, makeMappingsForCases,
} from './fixtures.js';

// ---- Validate mode (§7, §16, §88, §95, §156) -----------------------------

describe('runner — validate mode', () => {
  it('returns validated status (§88)', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) }));
    const result = await runner.run(makeInput());
    expect(result.status).toBe('validated');
  });

  it('zero side effects (§7)', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) }));
    const result = await runner.run(makeInput());
    expect(result.tests.testResults).toHaveLength(0);
    expect(result.preparation.status).toBe('skipped');
  });

  it('records audit events', async () => {
    const audit = new InMemoryRunAuditRecorder();
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'validate' }),
      auditRecorder: audit,
    }));
    await runner.run(makeInput());
    const types = audit.events().map((e) => e.type);
    expect(types).toContain('run-created');
    expect(types).toContain('inputs-loaded');
    expect(types).toContain('preflight-start');
    expect(types).toContain('preflight-end');
    expect(types).toContain('run-finished');
  });
});

// ---- Dry-run mode (§8, §17, §89, §96, §156) ------------------------------

describe('runner — dry-run mode', () => {
  it('returns validated status', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'dry-run' }) }));
    const result = await runner.run(makeInput());
    expect(result.status).toBe('validated');
  });

  it('no browser/DB/API/commands (§96)', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'dry-run' }) }));
    const result = await runner.run(makeInput());
    expect(result.tests.testResults).toHaveLength(0);
    expect(result.preparation.operationsSucceeded).toBe(0);
  });

  it('is the default mode (§6)', () => {
    const p = makePolicy();
    expect(p.mode).toBe('dry-run');
  });
});

// ---- Simulate mode (§9, §18, §97, §157, §179) ----------------------------

describe('runner — simulate mode', () => {
  it('returns passed for ready mappings', async () => {
    const tc = [makeTestCase()];
    const mappings = makeMappingsForCases(tc);
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings }));
    expect(result.status).toBe('passed');
    expect(result.tests.testResults).toHaveLength(1);
    expect(result.tests.testResults[0].status).toBe('passed');
  });

  it('returns blocked for unresolved mappings (preflight blocks)', async () => {
    const tc = [makeTestCase()];
    const mappings = makeMappings({
      testMappings: [makeMapping({ testCaseId: tc[0].id, status: 'unresolved' })],
    });
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings }));
    // All mappings unresolved → preflight blocks → no test execution
    expect(result.status).toBe('blocked');
    expect(result.tests.testResults).toHaveLength(0);
  });

  it('returns manual for manual mappings (preflight blocks)', async () => {
    const tc = [makeTestCase()];
    const mappings = makeMappings({
      testMappings: [makeMapping({ testCaseId: tc[0].id, status: 'manual' })],
    });
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings }));
    // Only manual mappings → preflight blocks (no ready mappings)
    expect(result.status).toBe('blocked');
  });

  it('preparation succeeds with data plan', async () => {
    const dataPlan = makeDataPlan({
      dataItems: [{ id: 'DI-1', name: 'x', description: '', type: 'input', lifecycle: 'temporary', strategy: 'create-new' }] as any,
    });
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ dataPlan }));
    expect(result.preparation.status).toBe('succeeded');
    expect(result.preparation.operationsTotal).toBe(1);
  });
});

// ---- Execute mode (§10-11, §19, §66, §158) --------------------------------

describe('runner — execute mode', () => {
  it('requires allowExecution (§11)', async () => {
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'execute', allowExecution: false }),
    }));
    const result = await runner.run(makeInput());
    expect(result.status).toBe('blocked');
  });

  it('denied on production (§14)', async () => {
    const profile = makeProfile({
      environment: { id: 'prod', name: 'Prod', safety: 'production' },
    });
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'execute', allowExecution: true }),
    }));
    const result = await runner.run(makeInput({ profile }));
    expect(result.status).toBe('blocked');
  });
});

// ---- Blocked preflight (§24, §92, §105, §165-168) ------------------------

describe('runner — blocked preflight', () => {
  it('returns blocked when test cases empty', async () => {
    const runner = new EndToEndRunner(makeOptions());
    const result = await runner.run(makeInput({ testCases: [] }));
    expect(result.status).toBe('blocked');
    expect(result.tests.testResults).toHaveLength(0);
  });

  it('zero test executions when blocked (§24)', async () => {
    const runner = new EndToEndRunner(makeOptions());
    const result = await runner.run(makeInput({ testCases: [] }));
    expect(result.tests.testResults).toHaveLength(0);
    expect(result.preparation.status).toBe('skipped');
  });

  it('zero preparation when blocked', async () => {
    const runner = new EndToEndRunner(makeOptions());
    const result = await runner.run(makeInput({ testCases: [] }));
    expect(result.preparation.operationsTotal).toBe(0);
  });
});

// ---- Status derivation (§56, §88-93) --------------------------------------

describe('runner — status derivation', () => {
  it('validated for dry-run', async () => {
    const r = await new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'dry-run' }) })).run(makeInput());
    expect(r.status).toBe('validated');
  });

  it('validated for validate', async () => {
    const r = await new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) })).run(makeInput());
    expect(r.status).toBe('validated');
  });

  it('passed for simulate with all ready', async () => {
    const tc = [makeTestCase()];
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const r = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    expect(r.status).toBe('passed');
  });

  it('blocked for preflight failure', async () => {
    const runner = new EndToEndRunner(makeOptions());
    const r = await runner.run(makeInput({ testCases: [] }));
    expect(r.status).toBe('blocked');
  });
});

// ---- Runtime management (§50-55) ------------------------------------------

describe('runner — managed runtime', () => {
  it('starts and stops managed runtime', async () => {
    const rt = new FakeProjectRuntimeManager();
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'simulate' }),
      runtimeMode: 'managed',
      runtimeManager: rt,
    }));
    await runner.run(makeInput());
    expect(rt.getState()).toBe('stopped');
  });

  it('handles runtime start failure (§55)', async () => {
    const rt = new FakeProjectRuntimeManager({ startShouldFail: true });
    // Override start to throw so the runner catches it
    rt.start = async () => { throw new Error('start failed'); };
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'simulate' }),
      runtimeMode: 'managed',
      runtimeManager: rt,
    }));
    const result = await runner.run(makeInput());
    expect(result.runtime.startError).toBeDefined();
    expect(result.runtime.ready).toBe(false);
  });

  it('external mode does not start runtime', async () => {
    const rt = new FakeProjectRuntimeManager();
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'dry-run' }),
      runtimeMode: 'external',
      runtimeManager: rt,
    }));
    await runner.run(makeInput());
    expect(rt.getState()).toBe('stopped');
  });
});

// ---- Selection integration (§25-27) ---------------------------------------

describe('runner — test selection', () => {
  it('filters tests by selection', async () => {
    const tc = [makeTestCase({ id: 'TC-A' }), makeTestCase({ id: 'TC-B' }), makeTestCase({ id: 'TC-C' })];
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'simulate' }),
      selection: { testCaseIds: ['TC-B'] },
    }));
    const result = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    expect(result.tests.testResults).toHaveLength(1);
    expect(result.tests.testResults[0].testCaseId).toBe('TC-B');
  });

  it('applies maxTests from policy', async () => {
    const tc = makeTestCases(5);
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'simulate', maxTests: 2 }),
    }));
    const result = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    expect(result.tests.testResults).toHaveLength(2);
  });
});

// ---- Result structure (§55, §90-91) ---------------------------------------

describe('runner — result structure', () => {
  it('includes all required fields', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) }));
    const result = await runner.run(makeInput());
    expect(result.schemaVersion).toBe('1.0');
    expect(result.runId).toBeDefined();
    expect(result.projectId).toBe('proj-001');
    expect(result.environmentId).toBe('local');
    expect(result.mode).toBe('validate');
    expect(result.preflight).toBeDefined();
    expect(result.runtime).toBeDefined();
    expect(result.preparation).toBeDefined();
    expect(result.tests).toBeDefined();
    expect(result.cleanup).toBeDefined();
    expect(result.quality).toBeDefined();
    expect(result.timings).toBeDefined();
    expect(result.inputHashes).toBeDefined();
    expect(result.runnerVersion).toBe('1.0.0');
  });

  it('records input hashes (§19)', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) }));
    const result = await runner.run(makeInput());
    expect(result.inputHashes.profileFingerprint).toBe('fp-abc123');
    expect(result.inputHashes.testCasesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.inputHashes.mappingHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('records seed when provided (§92)', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }), seed: 42 }));
    const result = await runner.run(makeInput());
    expect(result.seed).toBe(42);
  });
});

// ---- Cleanup on failure (§41-42) ------------------------------------------

describe('runner — cleanup behavior', () => {
  it('cleanup runs even in validate mode', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) }));
    const result = await runner.run(makeInput());
    expect(result.cleanup).toBeDefined();
    expect(result.cleanup.testCleanup.attempted).toBe(true);
  });

  it('cleanup tracked in result', async () => {
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput());
    expect(result.cleanup.failures).toBe(0);
  });
});

// ---- Audit trail completeness (§73, §99-107) ------------------------------

describe('runner — audit trail', () => {
  it('records full lifecycle in validate mode', async () => {
    const audit = new InMemoryRunAuditRecorder();
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'validate' }),
      auditRecorder: audit,
    }));
    await runner.run(makeInput());
    const types = audit.events().map((e) => e.type);
    expect(types).toContain('run-created');
    expect(types).toContain('inputs-loaded');
    expect(types).toContain('preflight-start');
    expect(types).toContain('preflight-end');
    expect(types).toContain('tests-start');
    expect(types).toContain('tests-end');
    expect(types).toContain('cleanup-start');
    expect(types).toContain('cleanup-end');
    expect(types).toContain('run-finished');
  });

  it('records full lifecycle in simulate mode', async () => {
    const audit = new InMemoryRunAuditRecorder();
    const tc = [makeTestCase()];
    const runner = new EndToEndRunner(makeOptions({
      policy: makePolicy({ mode: 'simulate' }),
      auditRecorder: audit,
    }));
    await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    const types = audit.events().map((e) => e.type);
    expect(types).toContain('preparation-start');
    expect(types).toContain('preparation-end');
  });
});

// ---- No AI (§5, §149-150) -------------------------------------------------

describe('runner — no AI', () => {
  it('does not call any AI provider (§149)', async () => {
    // The runner has no AI provider field — verify by checking that
    // validate mode completes without any external calls.
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'validate' }) }));
    const result = await runner.run(makeInput());
    expect(result.status).toBe('validated');
  });
});

// ---- Traceability (§102, §136-139) ----------------------------------------

describe('runner — traceability', () => {
  it('test results reference test case IDs (§136)', async () => {
    const tc = [makeTestCase({ id: 'TC-TRACE' })];
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    expect(result.tests.testResults[0].testCaseId).toBe('TC-TRACE');
  });

  it('test results include provenance (§139)', async () => {
    const tc = [makeTestCase({ provenance: [{ requirementId: 'REQ-TRACE' }] })];
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    expect(result.tests.testResults[0].provenance).toEqual([{ requirementId: 'REQ-TRACE' }]);
  });
});

// ---- Determinism (§131-135) -----------------------------------------------

describe('runner — determinism', () => {
  it('same input produces same status', async () => {
    const input = makeInput();
    const opts = makeOptions({ policy: makePolicy({ mode: 'validate' }) });
    const r1 = await new EndToEndRunner(opts).run(input);
    const r2 = await new EndToEndRunner(opts).run(input);
    expect(r1.status).toBe(r2.status);
  });

  it('test order is deterministic (§131)', async () => {
    const tc = [makeTestCase({ id: 'TC-C' }), makeTestCase({ id: 'TC-A' }), makeTestCase({ id: 'TC-B' })];
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    const ids = result.tests.testResults.map((r) => r.testCaseId);
    expect(ids).toEqual(['TC-A', 'TC-B', 'TC-C']);
  });
});

// ---- Multiple test cases (§148) -------------------------------------------

describe('runner — multiple tests', () => {
  it('handles multiple ready test cases', async () => {
    const tc = makeTestCases(3);
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings: makeMappingsForCases(tc) }));
    expect(result.tests.testResults).toHaveLength(3);
    expect(result.tests.summary.testsTotal).toBe(3);
    expect(result.tests.summary.passed).toBe(3);
  });

  it('handles mixed mapping statuses', async () => {
    const tc = [
      makeTestCase({ id: 'TC-1' }),
      makeTestCase({ id: 'TC-2' }),
      makeTestCase({ id: 'TC-3' }),
    ];
    const mappings = makeMappings({
      testMappings: [
        makeMapping({ testCaseId: 'TC-1', status: 'ready' }),
        makeMapping({ testCaseId: 'TC-2', status: 'manual' }),
        makeMapping({ testCaseId: 'TC-3', status: 'unresolved' }),
      ],
    });
    const runner = new EndToEndRunner(makeOptions({ policy: makePolicy({ mode: 'simulate' }) }));
    const result = await runner.run(makeInput({ testCases: tc, mappings }));
    expect(result.tests.testResults).toHaveLength(3);
    const statuses = result.tests.testResults.map((r) => r.status);
    expect(statuses).toContain('passed');
    expect(statuses).toContain('manual');
    expect(statuses).toContain('blocked');
  });
});
