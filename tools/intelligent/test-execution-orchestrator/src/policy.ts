// Test Execution Orchestrator v1 — Default run policy.

import type { TestRunPolicy, TestExecutorType } from './models.js';

export function defaultTestRunPolicy(overrides?: Partial<TestRunPolicy>): TestRunPolicy {
  return {
    mode: 'dry-run',
    failFast: false,
    maxConcurrency: 1,
    prepareData: true,
    cleanupAfterTest: true,
    collectEvidence: true,
    allowManual: true,
    testTimeoutMs: 30000,
    allowedTestExecutorTypes: ['ui', 'api', 'database', 'integration', 'manual', 'fake'] as TestExecutorType[],
    ...overrides,
  };
}
