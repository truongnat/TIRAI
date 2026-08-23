// Test Execution Orchestrator v1 — Status classifier.
//
// Determines the final test result status from assertion results.
// Rules (spec §24):
// - PASS only if all required assertions = passed
// - FAILED if at least one executed required assertion = failed
// - BLOCKED if required assertion cannot execute due to prerequisite
// - Zero-assertion test must NOT automatically pass (spec §25)

import type { AssertionResult, TestResultStatus, TestExecutionWarning } from './models.js';
import { TestWarningCode } from './warnings.js';

export interface ClassificationResult {
  status: TestResultStatus;
  warnings: TestExecutionWarning[];
}

export function classifyTestStatus(
  assertions: AssertionResult[],
  testCaseId: string,
): ClassificationResult {
  const warnings: TestExecutionWarning[] = [];

  // Zero-assertion test: must not automatically pass
  if (assertions.length === 0) {
    warnings.push({
      code: TestWarningCode.TEST_NO_ASSERTIONS,
      message: `Test case '${testCaseId}' has no assertions to verify.`,
      testCaseId,
    });
    return { status: 'blocked', warnings };
  }

  const hasFailed = assertions.some((a) => a.status === 'failed');
  const hasBlocked = assertions.some((a) => a.status === 'blocked');
  const allPassed = assertions.every((a) => a.status === 'passed');

  if (hasFailed) {
    return { status: 'failed', warnings };
  }

  if (hasBlocked) {
    return { status: 'blocked', warnings };
  }

  if (allPassed) {
    return { status: 'passed', warnings };
  }

  // Mixed not-verified and passed — not fully verified
  return { status: 'blocked', warnings };
}
