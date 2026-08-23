// Test Execution Orchestrator v1 — Manual test executor.
//
// Handles test cases with automation.status === 'manual-only'.
// Returns status = 'manual' with explicit instruction. Does not pretend
// the test was executed automatically.

import type {
  TestCase,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorValidation,
  TestExecutorResult,
  TestExecutionContext,
} from '../models.js';
import { TestWarningCode } from '../warnings.js';

export class ManualTestExecutor implements TestExecutor {
  readonly type = 'manual' as const;

  canExecute(testCase: TestCase, context: TestExecutionContext): TestExecutorMatch {
    // Handle manual-only tests, or when policy disallows auto-execution
    if (testCase.automation.status === 'manual-only') {
      return { supported: true, score: 1.0, reasons: ['Manual test case — requires human action'] };
    }
    // Also handle if policy doesn't allow auto
    if (!context.policy.allowManual) {
      return { supported: false, score: 0, reasons: ['Manual execution disabled by policy'] };
    }
    return { supported: false, score: 0, reasons: ['Not a manual-only test case'] };
  }

  async validate(testCase: TestCase, _context: TestExecutionContext): Promise<TestExecutorValidation> {
    if (!testCase.id) {
      return { valid: false, errors: [{ code: 'TEST_INVALID_INPUT', message: 'Test case has no ID.' }] };
    }
    return { valid: true, errors: [] };
  }

  async execute(testCase: TestCase, _context: TestExecutionContext): Promise<TestExecutorResult> {
    return {
      status: 'manual',
      steps: testCase.steps.map((s) => ({
        order: s.order,
        action: s.action,
        status: 'skipped' as const,
        evidenceIds: [],
      })),
      assertions: testCase.expectedResults.map((er, idx) => ({
        id: `ASR-MAN-${String(idx + 1).padStart(3, '0')}`,
        expectedResultIndex: idx,
        description: er.description,
        verificationType: er.verificationType,
        status: 'not-verified' as const,
        evidenceIds: [],
      })),
      evidence: [],
      warnings: [{
        code: TestWarningCode.TEST_MANUAL,
        message: `Test case '${testCase.id}' requires manual execution: ${testCase.objective}`,
        testCaseId: testCase.id,
      }],
    };
  }
}
