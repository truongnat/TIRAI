import { describe, expect, it } from 'vitest';
import { Scenario3Pipeline } from '../src/scenario3.js';
import { makeTestCase } from './fixtures.js';
import type { TestPlanIR } from 'test-planner';
import type { TestDataPlanIR } from 'test-data-planner';

function plan(overrides: Partial<TestPlanIR> = {}): TestPlanIR {
  return {
    schemaVersion: '1.0',
    scope: { requirementIds: ['REQ-1'], objective: 'test', assumptions: [], exclusions: [] },
    requirementCoverage: [],
    scenarios: [],
    testCases: [makeTestCase({ id: 'TC-1' })],
    dataNeeds: [],
    unresolved: [],
    quality: {
      requirementsTotal: 1,
      requirementsCovered: 1,
      requirementsPartiallyCovered: 0,
      requirementsNotCovered: 0,
      coverageRate: 1,
      scenarios: 1,
      testCases: 1,
      positiveCases: 1,
      negativeCases: 0,
      boundaryCases: 0,
      validationCases: 0,
      unresolved: 0,
      automationReady: 1,
      provenanceCoverage: 1,
    },
    ...overrides,
  };
}

const dataPlan = {} as TestDataPlanIR;

describe('Scenario 3 programmatic bridge', () => {
  it('composes in-memory planning stages and executes through one adapter', async () => {
    const pipeline = new Scenario3Pipeline({
      buildRequirements: async (input) => ({ statement: input.specification }),
      buildTestPlan: async () => plan(),
      buildTestDataPlan: async () => dataPlan,
    });
    let executed = 0;
    const result = await pipeline.run(
      { specification: 'cancel approved order' },
      {
        execute: async (testCases) => {
          executed = testCases.length;
          return { status: 'passed' };
        },
      },
    );
    expect(result.status).toBe('passed');
    expect(executed).toBe(1);
  });

  it('blocks before data planning or execution when producer validation found a non-executable case', async () => {
    let dataPlanning = 0;
    let execution = 0;
    const pipeline = new Scenario3Pipeline({
      buildRequirements: async () => ({}),
      buildTestPlan: async () =>
        plan({ warnings: [{ code: 'TEST_CASE_NON_EXECUTABLE', message: 'empty steps' }] }),
      buildTestDataPlan: async () => {
        dataPlanning++;
        return dataPlan;
      },
    });
    const result = await pipeline.run(
      { specification: 'invalid planner output' },
      {
        execute: async () => {
          execution++;
          return { status: 'passed' };
        },
      },
    );
    expect(result.status).toBe('blocked');
    expect(dataPlanning).toBe(0);
    expect(execution).toBe(0);
  });
});
