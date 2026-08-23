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
  };
}
