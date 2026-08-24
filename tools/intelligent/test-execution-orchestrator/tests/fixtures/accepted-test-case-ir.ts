// Offline accepted Test Case IR fixture.
// Replaces historical generated output so acceptance remains deterministic.

import type { TestCase } from '../../src/index.js';

export const acceptedTestCases: TestCase[] = Array.from({ length: 21 }, (_, index) => {
  const number = String(index + 1).padStart(4, '0');
  return {
    id: `TC-${number}`,
    scenarioId: `SCN-${number}`,
    requirementIds: [`REQ-${number}`],
    title: `Offline accepted scenario ${number}`,
    objective: `Validate deterministic execution for scenario ${number}`,
    type: 'unknown',
    priority: 'medium',
    preconditions: [{ description: 'Synthetic offline environment is available', sourceRequirementIds: [`REQ-${number}`] }],
    inputs: [],
    dataNeeds: [],
    steps: [{ order: 1, action: `Execute accepted scenario ${number}` }],
    expectedResults: [{ description: `Scenario ${number} completes successfully`, verificationType: 'other' }],
    cleanup: [],
    automation: { status: 'unknown', reasons: ['Deterministic offline acceptance fixture'] },
    provenance: [{ requirementId: `REQ-${number}` }],
    confidence: 0.9,
  } as TestCase;
});
