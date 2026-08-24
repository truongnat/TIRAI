// ---------------------------------------------------------------------------
// Test Data Planner – quality metrics
// ---------------------------------------------------------------------------

import type {
  TestDataQualityMetrics,
  TestDataItem,
  TestCaseDataPlan,
  DataDependency,
  ReusableDataSet,
  TestDataUnresolved,
  TestCaseIRInput,
} from '../models.js';

/**
 * Compute quality metrics for the test data plan.
 */
export function computeDataQualityMetrics(
  testCasePlans: TestCaseDataPlan[],
  dataItems: TestDataItem[],
  dependencies: DataDependency[],
  reusableSets: ReusableDataSet[],
  unresolved: TestDataUnresolved[],
  cyclicDependencies: number,
  testCases?: TestCaseIRInput['testCases'],
): TestDataQualityMetrics {
  const testCasesTotal = testCasePlans.length;

  // A test case has a "complete" data plan when it has at least one required
  // data item and no unresolved references.
  let testCasesWithCompleteDataPlan = 0;
  let testCasesPartiallyPlanned = 0;

  for (const tcp of testCasePlans) {
    if (tcp.requiredDataItemIds.length > 0 && tcp.unresolvedIds.length === 0) {
      testCasesWithCompleteDataPlan++;
    } else if (tcp.requiredDataItemIds.length > 0 || tcp.unresolvedIds.length > 0) {
      testCasesPartiallyPlanned++;
    }
  }

  // Provenance coverage: fraction of data items with at least one provenance
  const itemsWithProvenance = dataItems.filter((d) => d.provenance.length > 0).length;
  const provenanceCoverage = dataItems.length > 0 ? itemsWithProvenance / dataItems.length : 0;

  // Strategy coverage: fraction of data items with a non-unknown strategy
  const itemsWithStrategy = dataItems.filter((d) => d.strategy !== 'unknown').length;
  const strategyCoverage = dataItems.length > 0 ? itemsWithStrategy / dataItems.length : 0;

  // Data coverage metrics: how many tests requiring data are covered
  let testsRequiringData = 0;
  let testsCoveredByData = 0;

  if (testCases) {
    const requiresDataMap = new Map<string, boolean>();
    for (const tc of testCases) {
      const hasExplicitDataNeeds = tc.dataNeeds.length > 0;
      const hasPreconditionsRequiringData = tc.preconditions.some((p) => {
        const text = p.description.toLowerCase();
        return text.includes('user') || text.includes('account') || text.includes('exist') ||
               text.includes('logged') || text.includes('authenticated') || text.includes('has');
      });
      const hasInputs = tc.inputs.length > 0;
      const requiresData = hasExplicitDataNeeds || hasPreconditionsRequiringData || hasInputs;
      requiresDataMap.set(tc.id, requiresData);
      if (requiresData) testsRequiringData++;
    }

    for (const tcp of testCasePlans) {
      const hasItems = tcp.requiredDataItemIds.length > 0 || tcp.unresolvedIds.length > 0;
      if (requiresDataMap.get(tcp.testCaseId) && hasItems) {
        testsCoveredByData++;
      }
    }
  } else {
    // Fallback: count test cases with data plans
    for (const tcp of testCasePlans) {
      if (tcp.requiredDataItemIds.length > 0) {
        testsRequiringData++;
        testsCoveredByData++;
      }
    }
  }

  const coverageRate = testsRequiringData > 0 ? testsCoveredByData / testsRequiringData : 0;
  const unresolvedDataRequirements = unresolved.length;

  return {
    testCasesTotal,
    testCasesWithCompleteDataPlan,
    testCasesPartiallyPlanned,
    dataItems: dataItems.length,
    reusableDataSets: reusableSets.length,
    dependencies: dependencies.length,
    unresolved: unresolved.length,
    cyclicDependencies,
    provenanceCoverage: Math.round(provenanceCoverage * 100) / 100,
    strategyCoverage: Math.round(strategyCoverage * 100) / 100,
    testsRequiringData,
    testsCoveredByData,
    coverageRate: Math.round(coverageRate * 100) / 100,
    unresolvedDataRequirements,
  };
}
