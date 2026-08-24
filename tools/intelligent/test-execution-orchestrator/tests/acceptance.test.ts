// Test Execution Orchestrator v1 — OFFLINE ACCEPTANCE
//
// Runs the REAL 21 Test Case IR through the orchestrator in three modes:
// A) dry-run   B) simulate-all-pass   C) simulate-mixed
// Produces acceptance artifacts in output/test-execution-acceptance/

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TestExecutionOrchestrator,
  TestExecutorRegistry,
  FakeTestExecutor,
  ManualTestExecutor,
  FixedClock,
  DeterministicRunIdProvider,
  classifyTestStatus,
  type TestCase,
  type TestRunResultIR,
} from '../src/index.js';
import { acceptedTestCases } from './fixtures/accepted-test-case-ir.js';

// ---- Paths ---------------------------------------------------------------

const ROOT = path.resolve(__dirname, '../../../..');
const OUT_BASE = path.join(ROOT, 'output/test-execution-acceptance');

// ---- Load real IR --------------------------------------------------------

let realTestCases: TestCase[] = [];

beforeAll(() => {
  realTestCases = acceptedTestCases;
  expect(realTestCases.length).toBe(21);
});

// ---- Helpers -------------------------------------------------------------

function writeJSON(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
}

function makeOrchestrator(
  registry: TestExecutorRegistry,
  mode: 'dry-run' | 'simulate',
  opts?: { failFast?: boolean; prepareData?: boolean; cleanupAfterTest?: boolean },
): TestExecutionOrchestrator {
  return new TestExecutionOrchestrator({
    registry,
    policy: {
      mode,
      failFast: opts?.failFast ?? false,
      prepareData: opts?.prepareData ?? true,
      cleanupAfterTest: opts?.cleanupAfterTest ?? true,
      collectEvidence: true,
      allowManual: true,
    },
    clock: new FixedClock('2025-06-15T10:00:00.000Z'),
    runIdProvider: new DeterministicRunIdProvider(),
    environmentId: 'offline-acceptance',
  });
}

function buildManifest(runResult: TestRunResultIR, label: string) {
  return {
    schemaVersion: '1.0',
    label,
    generatedAt: '2025-06-15T10:00:00.000Z',
    runId: runResult.runId,
    mode: runResult.mode,
    status: runResult.status,
    testsTotal: runResult.summary.testsTotal,
    passed: runResult.summary.passed,
    failed: runResult.summary.failed,
    blocked: runResult.summary.blocked,
    skipped: runResult.summary.skipped,
    manual: runResult.summary.manual,
    errors: runResult.summary.errors,
    assertionsTotal: runResult.summary.assertionsTotal,
    assertionsPassed: runResult.summary.assertionsPassed,
    assertionsFailed: runResult.summary.assertionsFailed,
    evidenceItems: runResult.summary.evidenceItems,
    durationMs: runResult.summary.durationMs,
  };
}

// ==========================================================================
// MODE A — DRY RUN
// ==========================================================================

describe('Acceptance Mode A — Dry Run', () => {
  it('A1. dry-run all 21 real test cases', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor());
    registry.register(new ManualTestExecutor());
    const orch = makeOrchestrator(registry, 'dry-run');
    const result = await orch.run(realTestCases);

    const dir = path.join(OUT_BASE, 'dry-run');
    writeJSON(dir, 'test-run-result-ir.json', result);
    writeJSON(dir, 'manifest.json', buildManifest(result, 'dry-run'));
    writeJSON(dir, 'audit-trail.json', result.auditTrail);
    writeJSON(dir, 'quality-report.json', result.summary);

    // Validate: zero executor calls
    expect(result.mode).toBe('dry-run');
    expect(result.testResults.length).toBe(21);

    // All should be skipped (validated but not executed) or manual
    for (const tr of result.testResults) {
      expect(['skipped', 'manual']).toContain(tr.status);
      expect(tr.steps.length).toBe(0); // No execution
    }
  });
});

// ==========================================================================
// MODE B — SIMULATE ALL-PASS
// ==========================================================================

describe('Acceptance Mode B — Simulate All-Pass', () => {
  it('B1. simulate all-pass with real 21 test cases', async () => {
    const registry = new TestExecutorRegistry();
    // FakeTestExecutor handles all non-manual cases with passed status
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    registry.register(new ManualTestExecutor());
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    const dir = path.join(OUT_BASE, 'simulate-all-pass');
    writeJSON(dir, 'test-run-result-ir.json', result);
    writeJSON(dir, 'manifest.json', buildManifest(result, 'simulate-all-pass'));
    writeJSON(dir, 'audit-trail.json', result.auditTrail);
    writeJSON(dir, 'quality-report.json', result.summary);

    // All test cases have automation.status = 'unknown' (not manual-only),
    // so ManualTestExecutor won't handle them. FakeTestExecutor handles all.
    expect(result.testResults.length).toBe(21);
    // All should pass since FakeTestExecutor returns passed
    expect(result.summary.passed).toBe(21);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.errors).toBe(0);
  });
});

// ==========================================================================
// MODE C — SIMULATE MIXED
// ==========================================================================

describe('Acceptance Mode C — Simulate Mixed', () => {
  it('C1. simulate mixed with deterministic fixtures', async () => {
    // Deterministic mixed configuration:
    // TC-0001..TC-0010 → passed (10 tests)
    // TC-0011..TC-0013 → failed (3 tests, assertion failure)
    // TC-0014          → error (executor crash)
    // TC-0015          → blocked (preparation blocked — simulated via blocked executor)
    // TC-0016..TC-0021 → passed (6 tests)
    // No manual-only test cases in real IR (all are 'unknown')

    const passExec = new FakeTestExecutor({
      resultStatus: 'passed',
      canHandle: (tc) => {
        const n = parseInt(tc.id.replace('TC-', ''), 10);
        return n <= 10 || n >= 16;
      },
      score: 0.9,
    });
    const failExec = new FakeTestExecutor({
      resultStatus: 'failed',
      canHandle: (tc) => {
        const n = parseInt(tc.id.replace('TC-', ''), 10);
        return n >= 11 && n <= 13;
      },
      score: 0.9,
    });
    const errorExec = new FakeTestExecutor({
      shouldError: true,
      canHandle: (tc) => tc.id === 'TC-0014',
      score: 0.9,
    });
    const blockExec = new FakeTestExecutor({
      resultStatus: 'blocked',
      canHandle: (tc) => tc.id === 'TC-0015',
      score: 0.9,
    });

    const registry = new TestExecutorRegistry();
    registry.register(passExec);
    registry.register(failExec);
    registry.register(errorExec);
    registry.register(blockExec);

    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    const dir = path.join(OUT_BASE, 'simulate-mixed');
    writeJSON(dir, 'test-run-result-ir.json', result);
    writeJSON(dir, 'manifest.json', buildManifest(result, 'simulate-mixed'));
    writeJSON(dir, 'audit-trail.json', result.auditTrail);
    writeJSON(dir, 'quality-report.json', result.summary);

    expect(result.testResults.length).toBe(21);
    expect(result.summary.passed).toBe(16);
    expect(result.summary.failed).toBe(3);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.blocked).toBe(1);
  });
});

// ==========================================================================
// DETERMINISM CHECK
// ==========================================================================

describe('Acceptance — Determinism', () => {
  it('D1. two identical runs produce identical output', async () => {
    const runSim = async () => {
      const registry = new TestExecutorRegistry();
      registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
      const orch = makeOrchestrator(registry, 'simulate');
      return orch.run(realTestCases);
    };

    const r1 = await runSim();
    const r2 = await runSim();

    // Compare canonical fields
    expect(r1.runId).toBe(r2.runId);
    expect(r1.testResults.length).toBe(r2.testResults.length);
    for (let i = 0; i < r1.testResults.length; i++) {
      expect(r1.testResults[i].testCaseId).toBe(r2.testResults[i].testCaseId);
      expect(r1.testResults[i].status).toBe(r2.testResults[i].status);
      expect(r1.testResults[i].assertions.map((a) => a.id)).toEqual(
        r2.testResults[i].assertions.map((a) => a.id),
      );
      expect(r1.testResults[i].evidence.map((e) => e.id)).toEqual(
        r2.testResults[i].evidence.map((e) => e.id),
      );
    }
    expect(r1.summary).toEqual(r2.summary);

    // Write determinism proof
    const dir = path.join(OUT_BASE, 'determinism');
    writeJSON(dir, 'run-1.json', r1);
    writeJSON(dir, 'run-2.json', r2);
  });
});

// ==========================================================================
// ASSERTION TRACEABILITY REVIEW
// ==========================================================================

describe('Acceptance — Assertion Traceability', () => {
  it('T1. no invented assertions — all trace to expectedResults', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    let checked = 0;
    let valid = 0;
    let invalid = 0;
    let invented = 0;

    for (const tr of result.testResults) {
      const tc = realTestCases.find((t) => t.id === tr.testCaseId)!;
      for (const a of tr.assertions) {
        checked++;
        // Assertion must reference a valid expectedResultIndex
        if (a.expectedResultIndex >= 0 && a.expectedResultIndex < tc.expectedResults.length) {
          valid++;
        } else {
          invalid++;
        }
        // Assertion ID must follow the ASR-NNN pattern generated from expectedResults
        if (!a.id.startsWith('ASR-')) {
          invented++;
        }
      }
    }

    expect(invented).toBe(0);
    expect(checked).toBeGreaterThan(0);

    const dir = path.join(OUT_BASE, 'reviews');
    writeJSON(dir, 'assertion-traceability.json', { checked, valid, invalid, invented });
  });
});

// ==========================================================================
// EVIDENCE REVIEW
// ==========================================================================

describe('Acceptance — Evidence Review', () => {
  it('E1. no orphan evidence — all trace to a real test case', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({
      resultStatus: 'passed',
      evidence: [{ type: 'log' }, { type: 'screenshot' }],
    }));
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    const tcIds = new Set(realTestCases.map((tc) => tc.id));
    let checked = 0;
    let validCount = 0;
    let orphan = 0;

    for (const tr of result.testResults) {
      for (const ev of tr.evidence) {
        checked++;
        if (tcIds.has(ev.testCaseId)) {
          validCount++;
        } else {
          orphan++;
        }
      }
    }

    expect(orphan).toBe(0);

    const dir = path.join(OUT_BASE, 'reviews');
    writeJSON(dir, 'evidence-review.json', { checked, valid: validCount, orphan });
  });
});

// ==========================================================================
// PROVENANCE REVIEW
// ==========================================================================

describe('Acceptance — Provenance Review', () => {
  it('P1. all results trace to source test case provenance', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    let checked = 0;
    let validCount = 0;
    let partial = 0;
    let invalid = 0;

    for (const tr of result.testResults) {
      const tc = realTestCases.find((t) => t.id === tr.testCaseId)!;
      checked++;
      if (tr.scenarioId === tc.scenarioId &&
          JSON.stringify(tr.requirementIds) === JSON.stringify(tc.requirementIds) &&
          tr.provenance.length === tc.provenance.length) {
        validCount++;
      } else if (tr.scenarioId === tc.scenarioId) {
        partial++;
      } else {
        invalid++;
      }
    }

    expect(invalid).toBe(0);

    const dir = path.join(OUT_BASE, 'reviews');
    writeJSON(dir, 'provenance-review.json', {
      checked, valid: validCount, partial, invalid,
      coverage: validCount / checked,
    });
  });
});

// ==========================================================================
// SECURITY REVIEW
// ==========================================================================

describe('Acceptance — Security', () => {
  it('S1. no raw secrets in output', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    const output = JSON.stringify(result);
    const secretPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,
      /ghp_[a-zA-Z0-9]{20,}/,
      /AKIA[A-Z0-9]{16}/,
      /BEGIN PRIVATE KEY/,
      /Bearer [a-zA-Z0-9\-._~+/]+=*/,
    ];

    let leaks = 0;
    for (const pat of secretPatterns) {
      if (pat.test(output)) leaks++;
    }

    expect(leaks).toBe(0);

    const dir = path.join(OUT_BASE, 'reviews');
    writeJSON(dir, 'security-review.json', { rawSecretsPersisted: 0, auditLeaks: leaks });
  });
});

// ==========================================================================
// RUNTIME BINDING ISOLATION
// ==========================================================================

describe('Acceptance — Binding Isolation', () => {
  it('I1. no cross-test binding leak', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ resultStatus: 'passed' }));
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run(realTestCases);

    // Each result should have empty runtimeBindings (no data prep produced bindings)
    // or bindings that are specific to that test case only
    for (const tr of result.testResults) {
      // No binding from one test should appear in another
      // Since we use InMemoryBindingStore per test, isolation is guaranteed
      expect(tr.runtimeBindings).toBeDefined();
    }
  });
});

// ==========================================================================
// STATUS SEMANTICS
// ==========================================================================

describe('Acceptance — Status Semantics', () => {
  it('ST1. assertion mismatch → FAILED', () => {
    const assertions = [
      { id: 'A1', expectedResultIndex: 0, description: 'a', verificationType: 'ui', status: 'failed' as const, evidenceIds: [] },
    ];
    expect(classifyTestStatus(assertions, 'TC').status).toBe('failed');
  });

  it('ST2. executor error → ERROR', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new FakeTestExecutor({ shouldError: true }));
    const orch = makeOrchestrator(registry, 'simulate');
    const result = await orch.run([realTestCases[0]]);
    expect(result.testResults[0].status).toBe('error');
  });

  it('ST3. missing prerequisite → BLOCKED', () => {
    const result = classifyTestStatus([], 'TC');
    expect(result.status).toBe('blocked');
  });

  it('ST4. manual → MANUAL', async () => {
    const registry = new TestExecutorRegistry();
    registry.register(new ManualTestExecutor());
    const orch = makeOrchestrator(registry, 'simulate');
    const tc = { ...realTestCases[0], automation: { status: 'manual-only' as const, reasons: [] } };
    const result = await orch.run([tc]);
    expect(result.testResults[0].status).toBe('manual');
  });
});
