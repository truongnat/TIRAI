// ---------------------------------------------------------------------------
// Quality metrics – aggregate test plan quality statistics
// ---------------------------------------------------------------------------

import type {
  TestScenario,
  TestCase,
  RequirementCoverage,
  TestPlanningUnresolved,
  TestPlanQualityMetrics,
} from '../models.js';

/**
 * Compute aggregate quality metrics for the final Test Plan IR.
 */
export function computeQualityMetrics(
  coverages: RequirementCoverage[],
  scenarios: TestScenario[],
  testCases: TestCase[],
  unresolved: TestPlanningUnresolved[],
): TestPlanQualityMetrics {
  let requirementsCovered = 0;
  let requirementsPartiallyCovered = 0;
  let requirementsNotCovered = 0;

  for (const c of coverages) {
    switch (c.status) {
      case 'covered': requirementsCovered++; break;
      case 'partially-covered': requirementsPartiallyCovered++; break;
      case 'not-covered': requirementsNotCovered++; break;
    }
  }

  const requirementsTotal = coverages.length;
  const coverageRate = requirementsTotal > 0
    ? Math.round(((requirementsCovered + requirementsPartiallyCovered * 0.5) / requirementsTotal) * 100) / 100
    : 0;

  // Count test cases by category (via scenario)
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
  let positiveCases = 0;
  let negativeCases = 0;
  let boundaryCases = 0;
  let validationCases = 0;

  for (const tc of testCases) {
    const scenario = scenarioMap.get(tc.scenarioId);
    if (!scenario) continue;

    switch (scenario.category) {
      case 'happy-path': positiveCases++; break;
      case 'negative': negativeCases++; break;
      case 'boundary': boundaryCases++; break;
      case 'validation': validationCases++; break;
      default: break;
    }
  }

  // Count automation-ready test cases
  let automationReady = 0;
  for (const tc of testCases) {
    if (tc.automation.status === 'ready' || tc.automation.status === 'partially-ready') {
      automationReady++;
    }
  }

  // Provenance coverage: fraction of test cases with non-empty provenance
  let withProvenance = 0;
  for (const tc of testCases) {
    if (tc.provenance.length > 0 && tc.provenance.some((p) => p.requirementId.length > 0)) {
      withProvenance++;
    }
  }
  const provenanceCoverage = testCases.length > 0
    ? Math.round((withProvenance / testCases.length) * 100) / 100
    : 1;

  return {
    requirementsTotal,
    requirementsCovered,
    requirementsPartiallyCovered,
    requirementsNotCovered,
    coverageRate,
    scenarios: scenarios.length,
    testCases: testCases.length,
    positiveCases,
    negativeCases,
    boundaryCases,
    validationCases,
    unresolved: unresolved.length,
    automationReady,
    provenanceCoverage,
  };
}
