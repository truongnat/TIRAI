// ---------------------------------------------------------------------------
// Traceability validator – validates the traceability chain
// ---------------------------------------------------------------------------
// Ensures: Test Case → Scenario → Requirement chain is intact.

import type { TestScenario, TestCase, TestPlannerWarning, RequirementCoverage } from '../models.js';
import { TestPlannerWarningCode } from '../warnings.js';

/**
 * Validate that every test case references a valid scenario.
 */
export function validateScenarioReferences(
  testCases: TestCase[],
  scenarios: TestScenario[],
): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];
  const validScenarioIds = new Set(scenarios.map((s) => s.id));

  for (const tc of testCases) {
    if (!validScenarioIds.has(tc.scenarioId)) {
      warnings.push({
        code: TestPlannerWarningCode.CASE_INVALID_PROVENANCE,
        message: `Test case ${tc.id} references unknown scenario "${tc.scenarioId}"`,
        testCaseId: tc.id,
      });
    }
  }

  return warnings;
}

/**
 * Validate that every scenario is referenced by at least one test case.
 */
export function validateScenarioCoverage(
  scenarios: TestScenario[],
  testCases: TestCase[],
): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];
  const referencedScenarioIds = new Set(testCases.map((tc) => tc.scenarioId));

  for (const s of scenarios) {
    if (!referencedScenarioIds.has(s.id)) {
      warnings.push({
        code: TestPlannerWarningCode.REQUIREMENT_PARTIAL_COVERAGE,
        message: `Scenario ${s.id} has no test cases`,
        scenarioId: s.id,
      });
    }
  }

  return warnings;
}

/**
 * Validate that requirement coverage correctly maps to scenarios.
 */
export function validateRequirementCoverageChain(
  coverage: RequirementCoverage[],
  scenarios: TestScenario[],
): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];
  const validScenarioIds = new Set(scenarios.map((s) => s.id));

  for (const c of coverage) {
    for (const scenarioId of c.scenarioIds) {
      if (!validScenarioIds.has(scenarioId)) {
        warnings.push({
          code: TestPlannerWarningCode.CASE_DANGLING_REQUIREMENT,
          message: `Coverage for ${c.requirementId} references unknown scenario "${scenarioId}"`,
          requirementId: c.requirementId,
        });
      }
    }

    if (c.status === 'covered' && c.scenarioIds.length === 0) {
      warnings.push({
        code: TestPlannerWarningCode.REQUIREMENT_NOT_COVERED,
        message: `Requirement ${c.requirementId} marked as covered but has no scenarios`,
        requirementId: c.requirementId,
      });
    }

    if (c.status !== 'covered' && c.scenarioIds.length > 0) {
      warnings.push({
        code: TestPlannerWarningCode.REQUIREMENT_PARTIAL_COVERAGE,
        message: `Requirement ${c.requirementId} has scenarios but no executable test case`,
        requirementId: c.requirementId,
      });
    }
  }

  return warnings;
}

/**
 * Check that every test case has at least one expected result.
 */
export function validateExpectedResults(testCases: TestCase[]): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];

  for (const tc of testCases) {
    if (tc.expectedResults.length === 0) {
      warnings.push({
        code: TestPlannerWarningCode.EXPECTATION_UNSPECIFIED,
        message: `Test case ${tc.id} has no expected results`,
        testCaseId: tc.id,
      });
    }
  }

  return warnings;
}

/** Validate the minimum semantic contract required by Scenario 2. */
export function validateExecutableTestCases(testCases: TestCase[]): TestPlannerWarning[] {
  const warnings: TestPlannerWarning[] = [];

  for (const tc of testCases) {
    if (tc.steps.length === 0) {
      warnings.push({
        code: TestPlannerWarningCode.CASE_NON_EXECUTABLE,
        message: `Test case ${tc.id} has no executable steps`,
        testCaseId: tc.id,
      });
    }

    const orders = tc.steps.map((step) => step.order);
    if (
      orders.some(
        (order, index) => !Number.isFinite(order) || (index > 0 && order <= orders[index - 1]!),
      )
    ) {
      warnings.push({
        code: TestPlannerWarningCode.CASE_INVALID_STEP_ORDER,
        message: `Test case ${tc.id} has non-deterministic step ordering`,
        testCaseId: tc.id,
      });
    }

    if (tc.steps.some((step) => step.action.trim().length === 0)) {
      warnings.push({
        code: TestPlannerWarningCode.CASE_NON_EXECUTABLE,
        message: `Test case ${tc.id} contains an empty semantic action`,
        testCaseId: tc.id,
      });
    }

    if (tc.automation.status === 'manual-only') {
      warnings.push({
        code: TestPlannerWarningCode.CASE_UNSUPPORTED_AUTOMATION,
        message: `Test case ${tc.id} is not executable by the autonomous platform`,
        testCaseId: tc.id,
      });
    }
  }

  return warnings;
}
