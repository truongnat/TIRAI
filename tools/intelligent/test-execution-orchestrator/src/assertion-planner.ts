// Test Execution Orchestrator v1 — Assertion planner.
//
// Converts ExpectedResult[] from a TestCase into AssertionResult templates.
// Does NOT invent assertions beyond what the test case defines.

import type { ExpectedResult, AssertionResult, VerificationType } from './models.js';

export function planAssertions(
  expectedResults: ExpectedResult[],
  testCaseId: string,
): AssertionResult[] {
  return expectedResults.map((er, idx) => ({
    id: `ASR-${testCaseId}-${String(idx + 1).padStart(3, '0')}`,
    expectedResultIndex: idx,
    description: er.description,
    verificationType: er.verificationType as VerificationType,
    status: 'not-verified' as const,
    evidenceIds: [],
  }));
}
