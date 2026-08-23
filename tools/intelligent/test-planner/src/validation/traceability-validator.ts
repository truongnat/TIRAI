// ---------------------------------------------------------------------------
// Traceability validator – validates the traceability chain
// ---------------------------------------------------------------------------
// Ensures: Test Case → Scenario → Requirement chain is intact.

import type {
  TestScenario,
  TestCase,
  TestPlannerWarning,
  RequirementCoverage,
} from '../models.js';
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
