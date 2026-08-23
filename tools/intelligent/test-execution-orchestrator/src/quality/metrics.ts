// Test Execution Orchestrator v1 — Quality metrics.

import type {
  TestExecutionResultIR,
  TestRunSummary,
  TestExecutorType,
  AssertionResult,
} from '../models.js';

export function computeRunSummary(
  results: TestExecutionResultIR[],
  durationMs: number,
): TestRunSummary {
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  let manual = 0;
  let errors = 0;
  let assertionsTotal = 0;
  let assertionsPassed = 0;
  let assertionsFailed = 0;
  let assertionsBlocked = 0;
  let evidenceItems = 0;
  let cleanupFailures = 0;

  for (const r of results) {
    switch (r.status) {
      case 'passed': passed++; break;
      case 'failed': failed++; break;
      case 'blocked': blocked++; break;
      case 'skipped': skipped++; break;
      case 'manual': manual++; break;
      case 'error': errors++; break;
    }

    assertionsTotal += r.assertions.length;
    assertionsPassed += r.assertions.filter((a: AssertionResult) => a.status === 'passed').length;
    assertionsFailed += r.assertions.filter((a: AssertionResult) => a.status === 'failed').length;
    assertionsBlocked += r.assertions.filter((a: AssertionResult) => a.status === 'blocked').length;

    evidenceItems += r.evidence.length;
    cleanupFailures += r.cleanup.failed;
  }

  // Provenance coverage: fraction of results that have non-empty provenance
  const withProvenance = results.filter((r) => r.provenance.length > 0).length;
  const provenanceCoverage = results.length > 0 ? withProvenance / results.length : 0;

  return {
    testsTotal: results.length,
    passed,
    failed,
    blocked,
    skipped,
    manual,
    errors,
    assertionsTotal,
    assertionsPassed,
    assertionsFailed,
    assertionsBlocked,
    evidenceItems,
    cleanupFailures,
    provenanceCoverage,
    durationMs,
  };
}

export function computeExecutorBreakdown(
  results: TestExecutionResultIR[],
): Record<TestExecutorType, number> {
  const breakdown: Record<string, number> = {};
  for (const _r of results) {
    // Infer executor type from the first step or default
    // Since we don't store executor type directly on result, we count by test type
    // This is a simplified version
    const key = 'total';
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }
  return breakdown as Record<TestExecutorType, number>;
}
