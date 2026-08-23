// Runtime, commands, preparation, cleanup, audit, and quality tests.
// Spec §44-56, §57-66, §67-71, §94-98, §99-107, §175-178.

import { describe, it, expect } from 'vitest';
import { FakeProjectRuntimeManager } from '../src/runtime/fake-runtime.js';
import { FakeProjectCommandExecutor } from '../src/execution/fake-command-executor.js';
import { FakeSecretProvider } from '../src/execution/fake-secret-provider.js';
import { runPreparation } from '../src/preparation/preparation.js';
import { runCleanup } from '../src/cleanup/cleanup.js';
import { InMemoryRunAuditRecorder } from '../src/audit/audit-recorder.js';
import { computeRunQuality } from '../src/quality/metrics.js';
import { makePolicy, makeInput, makeDataPlan, makeTestRunResult, makeTestRunSummary, makeCommandCatalog } from './fixtures.js';

// ---- Runtime (§50-56) -----------------------------------------------------

describe('runtime — FakeProjectRuntimeManager', () => {
  it('starts in stopped state', () => {
    const rt = new FakeProjectRuntimeManager();
    expect(rt.getState()).toBe('stopped');
  });

  it('transitions to ready on start (§52)', () => {
    const rt = new FakeProjectRuntimeManager();
    rt.start();
    expect(rt.getState()).toBe('ready');
  });

  it('waitUntilReady returns current state (§53)', async () => {
    const rt = new FakeProjectRuntimeManager();
    await rt.start();
    const state = await rt.waitUntilReady();
    expect(state).toBe('ready');
  });

  it('stops cleanly (§54)', async () => {
    const rt = new FakeProjectRuntimeManager();
    await rt.start();
    await rt.stop();
    expect(rt.getState()).toBe('stopped');
  });

  it('start fails when configured (§55)', async () => {
    const rt = new FakeProjectRuntimeManager({ startShouldFail: true });
    const state = await rt.start();
    expect(state).toBe('error');
    expect(rt.getState()).toBe('error');
  });

  it('supports managed mode (§51)', async () => {
    const rt = new FakeProjectRuntimeManager();
    await rt.start();
    await rt.waitUntilReady();
    expect(rt.getState()).toBe('ready');
    await rt.stop();
    expect(rt.getState()).toBe('stopped');
  });
});

// ---- Commands (§57-61) ----------------------------------------------------

describe('commands — FakeProjectCommandExecutor', () => {
  it('validates declared command (§57)', () => {
    const catalog = makeCommandCatalog();
    const exec = new FakeProjectCommandExecutor(catalog);
    const result = exec.validate(catalog.commands[0]);
    expect(result).toBeNull();
  });

  it('rejects undeclared command (§58)', () => {
    const catalog = makeCommandCatalog();
    const exec = new FakeProjectCommandExecutor(catalog);
    const result = exec.validate({ id: 'unknown-cmd', purpose: 'other', command: 'rm', args: ['-rf', '/'], envRefs: [], safeForAutomation: false });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('RUNNER_RESOURCE_DENIED');
  });

  it('executes fake command (§60)', async () => {
    const catalog = makeCommandCatalog();
    const exec = new FakeProjectCommandExecutor(catalog);
    const result = await exec.execute(catalog.commands[0]);
    expect(result.exitCode).toBe(0);
    expect(result.commandId).toBe('cmd-start');
    expect(result.stdout).toContain('[fake]');
  });

  it('tracks executed commands', async () => {
    const catalog = makeCommandCatalog();
    const exec = new FakeProjectCommandExecutor(catalog);
    await exec.execute(catalog.commands[0]);
    await exec.execute(catalog.commands[1]);
    expect(exec.getExecutedCommands()).toEqual(['cmd-start', 'cmd-build']);
  });

  it('terminate is no-op', async () => {
    const exec = new FakeProjectCommandExecutor(makeCommandCatalog());
    await expect(exec.terminate()).resolves.toBeUndefined();
  });
});

// ---- Secret provider (§69-71) ---------------------------------------------

describe('execution — FakeSecretProvider', () => {
  it('resolves known secrets', async () => {
    const sp = new FakeSecretProvider({ DB_PASS: 'secret123' });
    expect(await sp.resolve('DB_PASS')).toBe('secret123');
  });

  it('returns undefined for unknown secrets', async () => {
    const sp = new FakeSecretProvider();
    expect(await sp.resolve('UNKNOWN')).toBeUndefined();
  });

  it('has() returns true for known secrets', async () => {
    const sp = new FakeSecretProvider({ KEY: 'val' });
    expect(await sp.has('KEY')).toBe(true);
    expect(await sp.has('MISSING')).toBe(false);
  });
});

// ---- Preparation (§62-66) -------------------------------------------------

describe('preparation — runPreparation', () => {
  it('skips in validate mode', async () => {
    const policy = makePolicy({ mode: 'validate' });
    const input = makeInput();
    const result = await runPreparation(input, policy);
    expect(result.status).toBe('skipped');
    expect(result.operationsTotal).toBe(0);
  });

  it('skips in dry-run mode', async () => {
    const policy = makePolicy({ mode: 'dry-run' });
    const result = await runPreparation(makeInput(), policy);
    expect(result.status).toBe('skipped');
  });

  it('succeeds in simulate mode (§157)', async () => {
    const policy = makePolicy({ mode: 'simulate' });
    const dataPlan = makeDataPlan({ dataItems: [{ id: 'DI-1', name: 'a', description: '', type: 'input', lifecycle: 'temporary', strategy: 'create-new' }] } as any);
    const input = makeInput({ dataPlan });
    const result = await runPreparation(input, policy);
    expect(result.status).toBe('succeeded');
    expect(result.operationsTotal).toBe(1);
    expect(result.operationsSucceeded).toBe(1);
  });

  it('succeeds in execute mode (§158)', async () => {
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const result = await runPreparation(makeInput(), policy);
    expect(result.status).toBe('succeeded');
  });

  it('reports zero operations when no data plan', async () => {
    const policy = makePolicy({ mode: 'simulate' });
    const result = await runPreparation(makeInput(), policy);
    expect(result.operationsTotal).toBe(0);
  });
});

// ---- Cleanup (§94-98) -----------------------------------------------------

describe('cleanup — runCleanup', () => {
  it('cleans up when policy says so (§94)', async () => {
    const policy = makePolicy({ cleanupAfterRun: true });
    const result = await runCleanup(policy);
    expect(result.testCleanup.attempted).toBe(true);
    expect(result.testCleanup.succeeded).toBe(true);
    expect(result.dataCleanup.attempted).toBe(true);
    expect(result.failures).toBe(0);
  });

  it('skips cleanup when disabled (§98)', async () => {
    const policy = makePolicy({ cleanupAfterRun: false });
    const result = await runCleanup(policy);
    expect(result.testCleanup.attempted).toBe(false);
    expect(result.dataCleanup.attempted).toBe(false);
  });

  it('stops runtime manager when present', async () => {
    const rt = new FakeProjectRuntimeManager();
    await rt.start();
    const policy = makePolicy({ cleanupAfterRun: true });
    const result = await runCleanup(policy, rt);
    expect(result.runtimeCleanup.attempted).toBe(true);
    expect(result.runtimeCleanup.succeeded).toBe(true);
    expect(rt.getState()).toBe('stopped');
  });

  it('handles runtime stop failure (§95)', async () => {
    const rt = new FakeProjectRuntimeManager({ startShouldFail: true });
    await rt.start(); // goes to error state
    // Override stop to throw
    rt.stop = async () => { throw new Error('stop failed'); };
    const policy = makePolicy({ cleanupAfterRun: true });
    const result = await runCleanup(policy, rt);
    expect(result.runtimeCleanup.attempted).toBe(true);
    expect(result.runtimeCleanup.succeeded).toBe(false);
    expect(result.failures).toBe(1);
  });

  it('no runtime cleanup when no manager', async () => {
    const policy = makePolicy({ cleanupAfterRun: true });
    const result = await runCleanup(policy);
    expect(result.runtimeCleanup.attempted).toBe(false);
  });
});

// ---- Audit (§99-107) ------------------------------------------------------

describe('audit — InMemoryRunAuditRecorder', () => {
  it('records events with sequence (§99)', () => {
    const recorder = new InMemoryRunAuditRecorder();
    recorder.record('run-created', 'Run created');
    recorder.record('inputs-loaded', 'Loaded');
    const events = recorder.events();
    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(0);
    expect(events[1].sequence).toBe(1);
  });

  it('records all event types (§100-107)', () => {
    const recorder = new InMemoryRunAuditRecorder();
    recorder.record('run-created', 'created');
    recorder.record('inputs-loaded', 'loaded');
    recorder.record('preflight-start', 'pf start');
    recorder.record('preflight-end', 'pf end');
    recorder.record('runtime-start', 'rt start');
    recorder.record('runtime-end', 'rt end');
    recorder.record('preparation-start', 'prep start');
    recorder.record('preparation-end', 'prep end');
    recorder.record('tests-start', 'test start');
    recorder.record('tests-end', 'test end');
    recorder.record('cleanup-start', 'clean start');
    recorder.record('cleanup-end', 'clean end');
    recorder.record('report-written', 'report');
    recorder.record('run-finished', 'done');
    expect(recorder.events()).toHaveLength(14);
  });

  it('includes timestamps', () => {
    const recorder = new InMemoryRunAuditRecorder();
    recorder.record('run-created', 'test');
    expect(recorder.events()[0].timestamp).toBeDefined();
  });

  it('includes details when provided', () => {
    const recorder = new InMemoryRunAuditRecorder();
    recorder.record('run-created', 'test', { runId: 'RUN-1' });
    expect(recorder.events()[0].details).toEqual({ runId: 'RUN-1' });
  });

  it('returns copy of events', () => {
    const recorder = new InMemoryRunAuditRecorder();
    recorder.record('run-created', 'test');
    const e1 = recorder.events();
    const e2 = recorder.events();
    expect(e1).not.toBe(e2);
    expect(e1).toEqual(e2);
  });
});

// ---- Quality (§175-178) ---------------------------------------------------

describe('quality — computeRunQuality', () => {
  it('computes quality from test results', () => {
    const testResults = makeTestRunResult({
      summary: makeTestRunSummary({
        testsTotal: 10, passed: 7, failed: 1, blocked: 1, manual: 1, errors: 0,
        assertionsTotal: 20, assertionsPassed: 18, assertionsFailed: 2,
        evidenceItems: 5, provenanceCoverage: 0.8, durationMs: 1000,
      }),
    });
    const q = computeRunQuality(testResults, 1500, 0);
    expect(q.testsTotal).toBe(10);
    expect(q.testsPassed).toBe(7);
    expect(q.testsFailed).toBe(1);
    expect(q.testsBlocked).toBe(1);
    expect(q.testsManual).toBe(1);
    expect(q.assertionsTotal).toBe(20);
    expect(q.assertionsPassed).toBe(18);
    expect(q.assertionsFailed).toBe(2);
    expect(q.evidenceCount).toBe(5);
    expect(q.durationMs).toBe(1500);
  });

  it('includes cleanup failures (§178)', () => {
    const q = computeRunQuality(makeTestRunResult(), 100, 3);
    expect(q.cleanupFailures).toBe(3);
  });

  it('reports zero quality for empty results', () => {
    const q = computeRunQuality(makeTestRunResult(), 0, 0);
    expect(q.testsTotal).toBe(0);
    expect(q.durationMs).toBe(0);
  });
});
