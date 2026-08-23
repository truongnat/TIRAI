// Test Execution Orchestrator v1 — Test executor registry.
//
// Central registry for TestExecutor instances. The orchestrator resolves the
// best executor for a test case via deterministic scoring — no scattered
// if/else chains.

import type { TestCase, TestExecutor, TestExecutorMatch, TestExecutionContext } from './models.js';
import { TestErrorCode, TestExecutionOrchestratorError } from './errors.js';

export class TestExecutorRegistry {
  private executors: TestExecutor[] = [];

  register(executor: TestExecutor): void {
    this.executors.push(executor);
  }

  resolve(testCase: TestCase, context: TestExecutionContext): TestExecutor {
    const candidates: Array<{ executor: TestExecutor; match: TestExecutorMatch }> = [];

    for (const executor of this.executors) {
      // Check if executor type is allowed by policy
      if (!context.policy.allowedTestExecutorTypes.includes(executor.type)) {
        continue;
      }
      const match = executor.canExecute(testCase, context);
      if (match.supported) {
        candidates.push({ executor, match });
      }
    }

    if (candidates.length === 0) {
      throw new TestExecutionOrchestratorError(
        TestErrorCode.TEST_EXECUTOR_NOT_FOUND,
        `No registered executor can handle test case '${testCase.id}' (type=${testCase.type}, automation=${testCase.automation.status}).`,
        { testCaseId: testCase.id },
      );
    }

    // Deterministic sort: highest score first, then alphabetical type for ties.
    candidates.sort((a, b) => {
      const scoreDiff = b.match.score - a.match.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.executor.type.localeCompare(b.executor.type);
    });

    return candidates[0].executor;
  }

  list(): TestExecutor[] {
    return [...this.executors];
  }

  clear(): void {
    this.executors = [];
  }
}
