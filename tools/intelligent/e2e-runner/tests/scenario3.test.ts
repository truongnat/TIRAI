import { describe, expect, it } from 'vitest';
import { Scenario3Pipeline, buildTrace } from '../src/scenario3.js';
import { makeTestCase } from './fixtures.js';
import type { TestPlanIR } from 'test-planner';
import type { TestDataPlanIR } from 'test-data-planner';
import { FakeAIProvider } from 'ai-provider';
import { semanticIR, extractionResult, candidate } from '../../requirement-builder/tests/fixtures/helpers.js';
import { coverageResult, scenarioResult, scenarioCandidate, testCaseResult, testCaseCandidate } from '../../test-planner/tests/fixtures/helpers.js';
import { dataReqResult, depResult } from '../../test-data-planner/tests/fixtures/helpers.js';
import type { TestExecutionOrchestrator } from 'test-execution-orchestrator';

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

  it('owns the default in-memory composition and returns a canonical source-to-proof trace', async () => {
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'scenario3-test',
      responses: [
        extractionResult({ candidates: [candidate({ temporaryId: 'r1', statement: 'An approved order can be cancelled', dataNeeds: [{ description: 'existing approved order', type: 'database-record', constraints: ['status = APPROVED'], provenance: [{ contextId: 'ctx-order' }] }], outcomes: [{ description: 'Order status is CANCELLED', state: 'CANCELLED', provenance: [{ contextId: 'ctx-order' }] }], provenance: [{ contextId: 'ctx-order' }] })] }),
        coverageResult({ coverageCandidates: [{ requirementId: 'REQ-0001', strategies: ['state-transition'], reasons: ['state'], confidence: 1 }] }),
        scenarioResult({ scenarios: [scenarioCandidate('SCEN-1', 'Cancel order', ['REQ-0001'])] }),
        testCaseResult({ testCases: [testCaseCandidate('TC-1', 'SCEN-1', ['REQ-0001'], { steps: [{ order: 1, action: 'Cancel the approved order' }], expectedResults: [{ description: 'Order status is CANCELLED', verificationType: 'state', verificationIntent: { kind: 'persisted-business-state', subject: 'order', property: 'status', expectedValue: 'CANCELLED', authority: 'PERSISTED_BUSINESS_STATE' } }] })] }),
        dataReqResult(),
        depResult(),
      ],
    });
    const execution = { status: 'passed', testResults: [{ testCaseId: 'TC-1', scenarioId: 'SCEN-1', requirementIds: ['REQ-0001'], status: 'passed', assertions: [{ id: 'JOURNEY-ASSERT-1', expectedResultIndex: 0, description: 'Order status', verificationType: 'state', status: 'passed', evidenceIds: ['E-1'] }], evidence: [{ id: 'E-1', type: 'api-response', sourceExecutor: 'api', testCaseId: 'TC-1', assertionId: 'ASSERT-0001', metadata: {}, sensitive: false }], runtimeBindings: [], steps: [], cleanup: { attempted: 1, succeeded: 1, failed: 0, results: [] }, errors: [], warnings: [], provenance: [{ requirementId: 'REQ-0001', contextId: 'ctx-order' }], phase: 'completed', timings: { startedAt: '', finishedAt: '', durationMs: 0 } }], summary: { failed: 0, errors: 0, blocked: 0, skipped: 0, passed: 1, testsTotal: 1, assertionsTotal: 1, assertionsPassed: 1, assertionsFailed: 0, assertionsBlocked: 0, evidenceItems: 1, cleanupFailures: 0, provenanceCoverage: 1, durationMs: 0 }, evidence: [], auditTrail: [] } as never;
    const orchestrator = { run: async () => execution } as unknown as TestExecutionOrchestrator;
    const progress: string[] = [];
    const result = await new Scenario3Pipeline({ aiProvider: provider, orchestrator }).run({ semanticIR: semanticIR(), onProgress: (event) => progress.push(`${event.stage}:${event.phase}`) });

    expect(result.status).toBe('passed');
    expect(result.testPlan.testCases).toHaveLength(1);
    expect(result.dataPlan).toBeDefined();
    expect(result.requirementResults[0]?.status).toBe('passed');
    expect(result.trace.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'SOURCE_SUPPORTS_REQUIREMENT' }),
      expect.objectContaining({ relation: 'EXPECTED_RESULT_VERIFIED_BY_NEED' }),
      expect.objectContaining({ relation: 'VERIFICATION_NEED_SUPPORTED_BY_EVIDENCE' }),
    ]));
    expect(result.trace.orphanEvidenceIds).toEqual([]);
    expect(provider.requestLog.length).toBeGreaterThan(0);
    expect(provider.requestLog.every((request) =>
      (request.providerOptions?.deepseek as { thinking?: string } | undefined)?.thinking === 'disabled',
    )).toBe(true);
  });

  it('builds stable canonical source lineage before requirement trace edges', () => {
    const trace = buildTrace({ requirements: [{ id: 'REQ-1', title: 'Complete item', provenance: [{ contextId: 'ctx-1', sourceId: 'src-1', revisionId: 'rev-1', artifactId: 'artifact-1', location: { segments: [{ kind: 'document', value: 'spec.md' }, { kind: 'line-range', value: '1-4' }] } }] }] } as never, { scenarios: [], testCases: [] } as never);

    expect(trace.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(['source', 'source-revision', 'source-artifact', 'semantic-context', 'requirement']));
    expect(trace.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'SOURCE_HAS_REVISION' }),
      expect.objectContaining({ relation: 'REVISION_HAS_ARTIFACT' }),
      expect.objectContaining({ relation: 'ARTIFACT_CONTAINS_CONTEXT' }),
      expect.objectContaining({ relation: 'CONTEXT_SUPPORTS_REQUIREMENT' }),
    ]));
  });
});
