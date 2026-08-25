import { describe, expect, it } from 'vitest';
import { buildTestPlan } from '../src/planner.js';
import { normalizeTestCaseResult } from '../src/analysis/test-case-generator.js';
import { validateExecutableTestCases } from '../src/validation/traceability-validator.js';
import { buildCoveragePrompt } from '../src/prompts/coverage.js';
import { buildScenarioPrompt } from '../src/prompts/scenarios.js';
import { buildTestCasePrompt } from '../src/prompts/test-cases.js';
import { FakeAIProvider } from 'ai-provider';
import {
  createTempRequirementIR,
  minimalRequirementIR,
  coverageResult,
  scenarioResult,
  scenarioCandidate,
  testCaseResult,
  testCaseCandidate,
} from './fixtures/helpers.js';

describe('Scenario 3 producer bridge', () => {
  it('inherits requirement data needs and full provenance into the executable TestCase', async () => {
    const requirementIR = minimalRequirementIR({
      requirements: [
        {
          ...minimalRequirementIR().requirements[0]!,
          dataNeeds: [
            {
              description: 'An existing approved order',
              type: 'database-record',
              constraints: ['status = APPROVED'],
              provenance: [
                { contextId: 'ctx-order', sheet: 'Orders', ranges: ['A2:F2'], cells: ['A2'] },
              ],
            },
          ],
          outcomes: [
            {
              description: 'Order status is CANCELLED',
              state: 'CANCELLED',
              provenance: [{ contextId: 'ctx-order' }],
            },
          ],
        },
      ],
    });
    const dir = createTempRequirementIR(requirementIR);
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'bridge-test',
      responses: [
        coverageResult({
          coverageCandidates: [
            {
              requirementId: 'REQ-0001',
              strategies: ['state-transition'],
              reasons: ['state'],
              confidence: 0.95,
            },
          ],
        }),
        scenarioResult({
          scenarios: [scenarioCandidate('SCEN-1', 'Cancel approved order', ['REQ-0001'])],
        }),
        testCaseResult({
          testCases: [
            testCaseCandidate('TC-1', 'SCEN-1', ['REQ-0001'], {
              expectedResults: [
                {
                  description: 'Order status is CANCELLED',
                  verificationType: 'state',
                  verificationIntent: {
                    kind: 'persisted-business-state',
                    subject: 'order',
                    property: 'status',
                    expectedValue: 'CANCELLED',
                    authority: 'PERSISTED_BUSINESS_STATE',
                  },
                },
              ],
            }),
          ],
        }),
      ],
    });

    const plan = await buildTestPlan(dir, provider);
    expect(plan.testCases[0]!.dataNeeds).toHaveLength(1);
    expect(plan.testCases[0]!.dataNeeds[0]!.description).toContain('existing approved order');
    expect(plan.testCases[0]!.dataNeeds[0]!.provenance?.[0]).toMatchObject({
      contextId: 'ctx-order',
      sheet: 'Orders',
      cells: ['A2'],
    });
    expect(plan.testCases[0]!.expectedResults[0]!.verificationIntent?.authority).toBe(
      'PERSISTED_BUSINESS_STATE',
    );
  });

  it('passes complete requirement semantics to every planning prompt', () => {
    const requirement = minimalRequirementIR().requirements[0]!;
    const withContext = {
      ...requirement,
      preconditions: [
        { description: 'An approved order exists', provenance: [{ contextId: 'ctx' }] },
      ],
      outcomes: [
        {
          description: 'Order remains CANCELLED',
          state: 'CANCELLED',
          provenance: [{ contextId: 'ctx' }],
        },
      ],
      dataNeeds: [
        {
          description: 'Existing approved order',
          type: 'database-record',
          constraints: ['status = APPROVED'],
          provenance: [{ contextId: 'ctx' }],
        },
      ],
    };
    const requirements = { ...minimalRequirementIR(), requirements: [withContext] }.requirements;
    const coverage = [
      {
        requirementId: 'REQ-0001',
        strategies: ['state-transition'] as const,
        reasons: ['state'],
        confidence: 1,
      },
    ];
    const scenario = scenarioCandidate('SCEN-1', 'Cancel order', ['REQ-0001'], {
      dataNeeds: [
        {
          description: 'Existing approved order',
          type: 'database-record',
          constraints: ['status = APPROVED'],
          relatedRequirementIds: ['REQ-0001'],
        },
      ],
    });

    for (const prompt of [
      buildCoveragePrompt(requirements),
      buildScenarioPrompt(requirements, coverage),
      buildTestCasePrompt(requirements, [scenario]),
    ]) {
      expect(prompt).toContain('approved order');
      expect(prompt).toContain('CANCELLED');
      expect(prompt).toContain('Precondition');
    }
  });

  it('rejects malformed verification types and non-executable cases explicitly', () => {
    const normalized = normalizeTestCaseResult(
      {
        testCases: [
          {
            temporaryId: 'TC-1',
            scenarioTemporaryId: 'SCEN-1',
            requirementIds: ['REQ-1'],
            title: 'Bad',
            objective: 'Bad',
            type: 'ui',
            steps: [],
            expectedResults: [{ description: 'works', verificationType: 'assertion' }],
            automation: { status: 'ready' },
            provenance: [{ requirementId: 'REQ-1' }],
          },
        ],
      },
      new Set(['REQ-1']),
      new Set(['SCEN-1']),
    );
    expect(
      normalized.warnings?.some((warning) => warning.code === 'TEST_EXPECTATION_UNTRACEABLE'),
    ).toBe(true);
    const warnings = validateExecutableTestCases([
      {
        id: 'TC-1',
        scenarioId: 'SCEN-1',
        requirementIds: ['REQ-1'],
        title: 'Bad',
        objective: 'Bad',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [{ requirementId: 'REQ-1' }],
        confidence: 1,
      },
    ]);
    expect(warnings.some((warning) => warning.code === 'TEST_CASE_NON_EXECUTABLE')).toBe(true);
  });

  it('derives a canonical verification type from a valid semantic intent', () => {
    const normalized = normalizeTestCaseResult(
      {
        testCases: [{
          temporaryId: 'TC-1', scenarioTemporaryId: 'SCEN-1', requirementIds: ['REQ-1'],
          title: 'Complete order', objective: 'Complete order', type: 'ui',
          steps: [{ order: 1, action: 'Complete the order' }],
          expectedResults: [{
            description: 'Persisted order status is COMPLETED',
            verificationType: 'assertion',
            verificationIntent: {
              kind: 'persisted-business-state', subject: 'order', property: 'status',
              expectedValue: 'COMPLETED', authority: 'PERSISTED_BUSINESS_STATE',
            },
          }],
          automation: { status: 'ready' }, provenance: [{ requirementId: 'REQ-1' }],
        }],
      },
      new Set(['REQ-1']),
      new Set(['SCEN-1']),
    );
    expect(normalized.testCases[0]?.expectedResults[0]?.verificationType).toBe('state');
    expect(normalized.warnings?.some((warning) => warning.code === 'TEST_EXPECTATION_UNTRACEABLE')).toBe(false);
  });
});
