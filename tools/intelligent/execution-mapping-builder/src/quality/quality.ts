// Execution Mapping Builder — Quality metrics computation.
//
// Computes ExecutionMappingQuality from validated mappings and unresolved items.

import type {
  TestCase,
  TestCaseExecutionMapping,
  ExecutionMappingUnresolved,
  ExecutionMappingQuality,
} from '../models.js';

export function computeQuality(
  testCases: TestCase[],
  mappings: TestCaseExecutionMapping[],
  unresolved: ExecutionMappingUnresolved[],
): ExecutionMappingQuality {
  let ready = 0;
  let partial = 0;
  let manual = 0;
  let unresolvedCount = 0;
  let uiMappings = 0;
  let apiMappings = 0;
  let databaseMappings = 0;
  let integrationMappings = 0;
  let stepsTotal = 0;
  let stepsMapped = 0;
  let assertionsTotal = 0;
  let assertionsMapped = 0;
  let bindingsRequired = 0;
  let bindingsResolved = 0;
  let provenanceCount = 0;

  for (const m of mappings) {
    switch (m.status) {
      case 'ready': ready++; break;
      case 'partial': partial++; break;
      case 'manual': manual++; break;
      case 'unresolved': unresolvedCount++; break;
    }

    if (m.ui) uiMappings++;
    if (m.api) apiMappings++;
    if (m.database) databaseMappings++;
    if (m.executorType === 'integration') integrationMappings++;

    if (m.ui) {
      stepsTotal += m.ui.stepMappings.length;
      stepsMapped += m.ui.stepMappings.length;
      assertionsTotal += m.ui.assertionMappings.length;
      assertionsMapped += m.ui.assertionMappings.length;

      for (const step of m.ui.stepMappings) {
        if (step.valueBinding || step.secretRef) {
          bindingsRequired++;
          if (step.valueBinding) bindingsResolved++;
        }
      }
    }

    if (m.provenance.length > 0) provenanceCount++;
  }

  // Count steps/assertions from test cases that have no mapping
  const mappedIds = new Set(mappings.map(m => m.testCaseId));
  for (const tc of testCases) {
    if (!mappedIds.has(tc.id)) {
      stepsTotal += tc.steps.length;
      assertionsTotal += tc.expectedResults.length;
    }
  }

  const catalogValidity = mappings.length > 0
    ? mappings.filter(m => m.status === 'ready').length / mappings.length
    : 0;

  const provenanceCoverage = testCases.length > 0
    ? provenanceCount / testCases.length
    : 0;

  return {
    testCasesTotal: testCases.length,
    ready,
    partial,
    manual,
    unresolved: unresolvedCount + unresolved.length,
    uiMappings,
    apiMappings,
    databaseMappings,
    integrationMappings,
    stepsTotal,
    stepsMapped,
    assertionsTotal,
    assertionsMapped,
    bindingsRequired,
    bindingsResolved,
    catalogReferenceValidity: Math.round(catalogValidity * 100) / 100,
    provenanceCoverage: Math.round(provenanceCoverage * 100) / 100,
  };
}
