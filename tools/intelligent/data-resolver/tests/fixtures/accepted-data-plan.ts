// Offline accepted Test Data Plan fixture.
// Replaces historical generated output so resolver acceptance remains offline.

import type {
  DataConstraint,
  DataDependency,
  TestDataItem,
  TestDataPlanIR,
  TestProvenance,
} from 'test-data-planner';

const provenance = (number: string): TestProvenance[] => [{ requirementId: `REQ-${number}` }];

function item(number: number, type: TestDataItem['type'], strategy: TestDataItem['strategy']): TestDataItem {
  const id = String(number).padStart(4, '0');
  const constraints: DataConstraint[] = number === 4
    ? [{ type: 'format', description: 'Generate a deterministic unique value', provenance: provenance(id) }]
    : [];
  return {
    id: `DATA-${id}`, name: `Accepted data ${id}`, description: `Deterministic accepted data item ${id}`,
    type, lifecycle: strategy === 'select-existing' ? 'existing' : 'temporary', strategy,
    constraints, dependencies: [], relatedTestCaseIds: [`TC-${id}`], relatedRequirementIds: [`REQ-${id}`],
    relatedEntityIds: type === 'database-record' ? ['User'] : [],
    setup: [{ type: strategy === 'generate' ? 'generate' : 'create', description: `Prepare data ${id}`, executorHint: type === 'database-record' ? 'database' : undefined }],
    cleanup: [{ type: 'delete', description: `Clean up data ${id}` }], provenance: provenance(id), confidence: 0.9,
  };
}

const dataItems: TestDataItem[] = [
  item(1, 'database-record', 'create-new'), item(2, 'account', 'create-new'), item(3, 'token', 'generate'),
  item(4, 'input', 'generate'), item(5, 'configuration', 'configure'), item(6, 'file', 'generate'),
  item(7, 'state', 'create-new'), ...Array.from({ length: 17 }, (_, index) => item(index + 8, 'input', 'generate')),
];

dataItems[16]!.dependencies = ['DATA-0016'];

const dependency = (id: string, sourceDataItemId: string, targetDataItemId: string): DataDependency => ({
  id, sourceDataItemId, targetDataItemId, type: 'derived-from', description: 'Deterministic acceptance dependency',
});

export const acceptedDataPlan: TestDataPlanIR = {
  schemaVersion: '1.0',
  testCases: dataItems.map((data) => ({
    testCaseId: data.relatedTestCaseIds[0]!, requiredDataItemIds: [data.id], setupItemIds: [data.id],
    cleanupItemIds: [data.id], reusableDataSetIds: [], unresolvedIds: [],
  })),
  dataItems,
  dependencyGraph: [
    dependency('DEP-0001', 'DATA-0001', 'DATA-0002'), dependency('DEP-0002', 'DATA-0002', 'DATA-0003'),
    dependency('DEP-0003', 'DATA-0003', 'DATA-0004'), dependency('DEP-0004', 'DATA-0004', 'DATA-0005'),
    dependency('DEP-0005', 'DATA-0016', 'DATA-0017'),
  ],
  reusableSets: [],
  unresolved: [{ id: 'UNRESOLVED-0001', testCaseIds: ['TC-0001'], description: 'Optional offline acceptance data remains unresolved by design', reason: 'missing-source', provenance: provenance('0001') }],
  quality: {
    testCasesTotal: 21, testCasesWithCompleteDataPlan: 20, testCasesPartiallyPlanned: 1, dataItems: 24,
    reusableDataSets: 0, dependencies: 5, unresolved: 1, cyclicDependencies: 0, provenanceCoverage: 1, strategyCoverage: 1,
  },
};
