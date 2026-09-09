// ---------------------------------------------------------------------------
// Test Planner – comprehensive test suite (60+ scenarios)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIProviderError, AIProviderErrorCode, FakeAIProvider } from 'ai-provider';
import {
  VALID_REQUIREMENT_IR_DIR,
  minimalRequirementIR,
  coverageResult,
  coverageCandidate,
  scenarioResult,
  scenarioCandidate,
  testCaseResult,
  testCaseCandidate,
  buildTestPlannerFakeProvider,
  createTempRequirementIR,
  createTempOutput,
} from './fixtures/helpers.js';

// ---- Module imports -------------------------------------------------------
import { loadRequirementIR, loadRequirementIRContent } from '../src/persistence/loader.js';
import { analyzeCoverage } from '../src/analysis/coverage-analyzer.js';
import { generateScenarios } from '../src/analysis/scenario-generator.js';
import { generateTestCases } from '../src/analysis/test-case-generator.js';
import { deduplicateScenarios, deduplicateTestCases } from '../src/merge/deduplicator.js';
import {
  buildValidRequirementIds,
  validateRequirementReferences,
} from '../src/validation/requirement-ir-validator.js';
import {
  validateScenarioReferences,
  validateExpectedResults,
} from '../src/validation/traceability-validator.js';
import {
  validateTestProvenance,
  buildValidContextIdsFromRequirementIR,
} from '../src/validation/provenance-validator.js';
import { computeQualityMetrics } from '../src/quality/metrics.js';
import { computeFingerprint } from '../src/fingerprint.js';
import { buildTestPlan } from '../src/planner.js';
import { TestPlannerError, TestPlannerErrorCode } from '../src/errors.js';
import { TestPlannerWarningCode, TEST_CONFIDENCE_THRESHOLD } from '../src/warnings.js';
import { TEST_PLANNER_PROMPT_VERSION, TEST_PLANNER_SYSTEM_PROMPT } from '../src/prompts/system.js';
import { buildCoveragePrompt } from '../src/prompts/coverage.js';
import { buildScenarioPrompt } from '../src/prompts/scenarios.js';
import { buildRepairPrompt } from '../src/prompts/repair.js';
import type { TestScenario, TestCase, RequirementCoverage } from '../src/models.js';

// ===========================================================================
// 1. LOADER TESTS (1-8)
// ===========================================================================

describe('Loader', () => {
  it('1. loads valid Requirement IR from disk', () => {
    const ir = loadRequirementIR(VALID_REQUIREMENT_IR_DIR);
    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.requirements.length).toBe(3);
    expect(ir.requirements[0]!.id).toBe('REQ-0001');
  });

  it('2. throws INPUT_NOT_FOUND for missing directory', () => {
    expect(() => loadRequirementIR('/nonexistent/path')).toThrowError(TestPlannerError);
    try {
      loadRequirementIR('/nonexistent/path');
    } catch (err) {
      expect((err as TestPlannerError).code).toBe(TestPlannerErrorCode.INPUT_NOT_FOUND);
    }
  });

  it('3. throws INVALID_REQUIREMENT_IR for wrong schema version', () => {
    const tmpDir = createTempRequirementIR(minimalRequirementIR({ schemaVersion: '2.0' }));
    try {
      loadRequirementIR(tmpDir);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TestPlannerError);
      expect((err as TestPlannerError).code).toBe(TestPlannerErrorCode.INVALID_REQUIREMENT_IR);
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('4. throws INVALID_REQUIREMENT_IR when requirements is not an array', () => {
    const ir = minimalRequirementIR();
    (ir as any).requirements = 'not-an-array';
    const tmpDir = createTempRequirementIR(ir);
    try {
      loadRequirementIR(tmpDir);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TestPlannerError);
      expect((err as TestPlannerError).code).toBe(TestPlannerErrorCode.INVALID_REQUIREMENT_IR);
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('5. throws INVALID_REQUIREMENT_IR when document.provenance is missing', () => {
    const ir = minimalRequirementIR();
    (ir as any).document = { title: 'test' };
    const tmpDir = createTempRequirementIR(ir);
    try {
      loadRequirementIR(tmpDir);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TestPlannerError);
      expect((err as TestPlannerError).code).toBe(TestPlannerErrorCode.INVALID_REQUIREMENT_IR);
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('6. loads raw content for fingerprinting', () => {
    const content = loadRequirementIRContent(VALID_REQUIREMENT_IR_DIR);
    expect(content.length).toBeGreaterThan(0);
    const parsed = JSON.parse(content);
    expect(parsed.schemaVersion).toBe('1.0');
  });

  it('7. throws INPUT_NOT_FOUND for content loading on missing dir', () => {
    expect(() => loadRequirementIRContent('/nonexistent')).toThrow(TestPlannerError);
  });

  it('8. loads IR with unresolved and conflicts', () => {
    const ir = minimalRequirementIR({
      unresolved: [
        {
          id: 'U1',
          description: 'Ambiguous',
          reason: 'unclear',
          semanticEvidenceIds: [],
          provenance: [],
        },
      ],
      conflicts: [
        {
          id: 'C1',
          requirementIds: ['REQ-0001'],
          description: 'Conflict',
          type: 'contradiction',
          provenance: [],
          confidence: 0.5,
        },
      ],
    });
    const tmpDir = createTempRequirementIR(ir);
    const loaded = loadRequirementIR(tmpDir);
    expect(loaded.unresolved.length).toBe(1);
    expect(loaded.conflicts.length).toBe(1);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// 2. COVERAGE ANALYZER TESTS (9-17)
// ===========================================================================

describe('Coverage analyzer', () => {
  it('9. normalizes valid coverage response', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [
          {
            requirementId: 'REQ-0001',
            strategies: ['positive', 'validation'],
            reasons: ['Has constraints'],
            confidence: 0.9,
          },
        ],
        unresolvedCandidates: [],
      },
      usage: { inputTokens: 50, outputTokens: 30 },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.coverageCandidates.length).toBe(1);
    expect(result.coverageCandidates[0]!.strategies).toContain('positive');
    expect(result.coverageCandidates[0]!.strategies).toContain('validation');
  });

  it('10. filters out coverage for unknown requirement IDs', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [
          {
            requirementId: 'REQ-9999',
            strategies: ['positive'],
            reasons: ['Wrong ID'],
            confidence: 0.9,
          },
        ],
        unresolvedCandidates: [],
      },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.coverageCandidates.length).toBe(0);
  });

  it('11. normalizes invalid strategies to empty', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [
          {
            requirementId: 'REQ-0001',
            strategies: ['invalid-strategy', 'positive'],
            reasons: [],
            confidence: 0.8,
          },
        ],
        unresolvedCandidates: [],
      },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.coverageCandidates[0]!.strategies).toEqual(['positive']);
  });

  it('12. assigns default confidence when missing', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [{ requirementId: 'REQ-0001', strategies: ['positive'], reasons: [] }],
        unresolvedCandidates: [],
      },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.coverageCandidates[0]!.confidence).toBe(0.7);
  });

  it('13. handles unresolved candidates', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [],
        unresolvedCandidates: [
          {
            requirementId: 'REQ-0001',
            description: 'Error behavior unspecified',
            reason: 'missing-error-behavior',
            provenance: [],
          },
        ],
      },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.unresolvedCandidates.length).toBe(1);
    expect(result.unresolvedCandidates[0]!.reason).toBe('missing-error-behavior');
  });

  it('14. normalizes invalid unresolved reasons to other', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [],
        unresolvedCandidates: [
          {
            requirementId: 'REQ-0001',
            description: 'Something',
            reason: 'invalid-reason',
            provenance: [],
          },
        ],
      },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.unresolvedCandidates[0]!.reason).toBe('other');
  });

  it('15. throws after max repair attempts', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({ error: new Error('AI failure') });

    try {
      await analyzeCoverage(ir.requirements, provider, 0);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TestPlannerError);
      expect((err as TestPlannerError).code).toBe(TestPlannerErrorCode.SCHEMA_FAILURE);
    }
  });

  it('15a. does not treat provider transport timeout as structured-output repair', async () => {
    const ir = minimalRequirementIR();
    const timeout = new AIProviderError({
      code: AIProviderErrorCode.TIMEOUT,
      provider: 'deepseek',
      message: 'Request timed out',
    });
    const provider = new FakeAIProvider({ error: timeout });

    await expect(analyzeCoverage(ir.requirements, provider, 1)).rejects.toBe(timeout);
    expect(provider.requestLog).toHaveLength(1);
  });

  it('16. returns usage information', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: { coverageCandidates: [], unresolvedCandidates: [] },
      usage: { inputTokens: 200, outputTokens: 100 },
    });

    const { usage } = await analyzeCoverage(ir.requirements, provider);
    expect(usage.inputTokens).toBe(200);
    expect(usage.outputTokens).toBe(100);
  });

  it('17. skips candidates with empty requirementId', async () => {
    const ir = minimalRequirementIR();
    const provider = new FakeAIProvider({
      response: {
        coverageCandidates: [
          { requirementId: '', strategies: ['positive'], reasons: [], confidence: 0.9 },
        ],
        unresolvedCandidates: [],
      },
    });

    const { result } = await analyzeCoverage(ir.requirements, provider);
    expect(result.coverageCandidates.length).toBe(0);
  });
});

// ===========================================================================
// 3. SCENARIO GENERATOR TESTS (18-25)
// ===========================================================================

describe('Scenario generator', () => {
  const ir = minimalRequirementIR();
  const coverage = [coverageCandidate('REQ-0001', ['positive', 'validation'])];

  it('18. normalizes valid scenario response', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            temporaryId: 'SCN-CAND-001',
            title: 'Valid username accepted',
            objective: 'Verify username validation',
            category: 'happy-path',
            requirementIds: ['REQ-0001'],
            preconditions: [],
            dataNeeds: [],
            expectedBehavior: ['Username accepted'],
            priority: 'high',
            provenance: [{ requirementId: 'REQ-0001' }],
            confidence: 0.9,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios.length).toBe(1);
    expect(result.scenarios[0]!.category).toBe('happy-path');
    expect(result.scenarios[0]!.priority).toBe('high');
  });

  it('19. filters scenarios with no valid requirement IDs', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            temporaryId: 'SCN-001',
            title: 'Test',
            objective: 'Test',
            category: 'happy-path',
            requirementIds: ['REQ-9999'],
            preconditions: [],
            dataNeeds: [],
            expectedBehavior: [],
            priority: 'medium',
            provenance: [],
            confidence: 0.5,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios.length).toBe(0);
  });

  it('20. normalizes invalid category to other', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            temporaryId: 'SCN-001',
            title: 'Test',
            objective: 'Test',
            category: 'invalid-category',
            requirementIds: ['REQ-0001'],
            preconditions: [],
            dataNeeds: [],
            expectedBehavior: [],
            priority: 'medium',
            provenance: [],
            confidence: 0.5,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios[0]!.category).toBe('other');
  });

  it('21. normalizes invalid priority to medium', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            temporaryId: 'SCN-001',
            title: 'Test',
            objective: 'Test',
            category: 'happy-path',
            requirementIds: ['REQ-0001'],
            preconditions: [],
            dataNeeds: [],
            expectedBehavior: [],
            priority: 'super-critical',
            provenance: [],
            confidence: 0.5,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios[0]!.priority).toBe('medium');
  });

  it('22. auto-generates temporaryId when missing', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            title: 'Test',
            objective: 'Test',
            category: 'happy-path',
            requirementIds: ['REQ-0001'],
            preconditions: [],
            dataNeeds: [],
            expectedBehavior: [],
            priority: 'medium',
            provenance: [],
            confidence: 0.5,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios[0]!.temporaryId).toMatch(/^SCN-CAND-/);
  });

  it('23. skips scenarios with empty title', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            temporaryId: 'SCN-001',
            title: '',
            objective: '',
            category: 'happy-path',
            requirementIds: ['REQ-0001'],
            preconditions: [],
            dataNeeds: [],
            expectedBehavior: [],
            priority: 'medium',
            provenance: [],
            confidence: 0.5,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios.length).toBe(0);
  });

  it('24. normalizes data needs within scenarios', async () => {
    const provider = new FakeAIProvider({
      response: {
        scenarios: [
          {
            temporaryId: 'SCN-001',
            title: 'Test',
            objective: 'Test',
            category: 'happy-path',
            requirementIds: ['REQ-0001'],
            preconditions: [],
            dataNeeds: [
              {
                description: 'User account',
                type: 'account',
                constraints: ['active'],
                relatedRequirementIds: ['REQ-0001'],
              },
            ],
            expectedBehavior: [],
            priority: 'medium',
            provenance: [],
            confidence: 0.5,
          },
        ],
      },
    });

    const { result } = await generateScenarios(ir.requirements, coverage, provider);
    expect(result.scenarios[0]!.dataNeeds.length).toBe(1);
    expect(result.scenarios[0]!.dataNeeds[0]!.type).toBe('account');
  });

  it('25. throws on provider failure', async () => {
    const provider = new FakeAIProvider({ error: new Error('AI down') });
    try {
      await generateScenarios(ir.requirements, coverage, provider, 0);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TestPlannerError);
      expect((err as TestPlannerError).code).toBe(TestPlannerErrorCode.SCHEMA_FAILURE);
    }
  });
});

// ===========================================================================
// 4. TEST CASE GENERATOR TESTS (26-33)
// ===========================================================================

describe('Test case generator', () => {
  const ir = minimalRequirementIR();
  const scenarios = [scenarioCandidate('SCN-CAND-001', 'Valid login', ['REQ-0001'])];

  it('26. normalizes valid test case response', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-CAND-001',
            scenarioTemporaryId: 'SCN-CAND-001',
            requirementIds: ['REQ-0001'],
            title: 'Enter valid username',
            objective: 'Verify valid input',
            type: 'ui',
            priority: 'high',
            preconditions: [],
            inputs: [{ name: 'username', valueStrategy: 'valid' }],
            dataNeeds: [],
            steps: [{ order: 1, action: 'Enter username' }],
            expectedResults: [{ description: 'Accepted', verificationType: 'ui' }],
            cleanup: [],
            automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
            provenance: [{ requirementId: 'REQ-0001' }],
            confidence: 0.9,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases.length).toBe(1);
    expect(result.testCases[0]!.type).toBe('ui');
    expect(result.testCases[0]!.inputs[0]!.valueStrategy).toBe('valid');
  });

  it('27. filters test cases with invalid scenario reference', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-001',
            scenarioTemporaryId: 'SCN-NONEXISTENT',
            requirementIds: ['REQ-0001'],
            title: 'Test',
            objective: 'Test',
            type: 'ui',
            priority: 'medium',
            preconditions: [],
            inputs: [],
            dataNeeds: [],
            steps: [],
            expectedResults: [],
            cleanup: [],
            automation: { status: 'unknown', reasons: [] },
            provenance: [],
            confidence: 0.5,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases.length).toBe(0);
  });

  it('28. normalizes invalid test type to unknown', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-001',
            scenarioTemporaryId: 'SCN-CAND-001',
            requirementIds: ['REQ-0001'],
            title: 'Test',
            objective: 'Test',
            type: 'quantum',
            priority: 'medium',
            preconditions: [],
            inputs: [],
            dataNeeds: [],
            steps: [],
            expectedResults: [],
            cleanup: [],
            automation: { status: 'unknown', reasons: [] },
            provenance: [],
            confidence: 0.5,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases[0]!.type).toBe('unknown');
  });

  it('29. normalizes invalid value strategy to unknown', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-001',
            scenarioTemporaryId: 'SCN-CAND-001',
            requirementIds: ['REQ-0001'],
            title: 'Test',
            objective: 'Test',
            type: 'ui',
            priority: 'medium',
            preconditions: [],
            inputs: [{ name: 'field', valueStrategy: 'magical' }],
            dataNeeds: [],
            steps: [],
            expectedResults: [],
            cleanup: [],
            automation: { status: 'unknown', reasons: [] },
            provenance: [],
            confidence: 0.5,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases[0]!.inputs[0]!.valueStrategy).toBe('unknown');
  });

  it('30. normalizes invalid automation status to unknown', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-001',
            scenarioTemporaryId: 'SCN-CAND-001',
            requirementIds: ['REQ-0001'],
            title: 'Test',
            objective: 'Test',
            type: 'ui',
            priority: 'medium',
            preconditions: [],
            inputs: [],
            dataNeeds: [],
            steps: [],
            expectedResults: [],
            cleanup: [],
            automation: { status: 'fully-automated', reasons: [] },
            provenance: [],
            confidence: 0.5,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases[0]!.automation.status).toBe('unknown');
  });

  it('31. collects additional data needs', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [],
        additionalDataNeeds: [
          {
            description: 'Existing user',
            type: 'account',
            constraints: ['active'],
            relatedRequirementIds: ['REQ-0001'],
          },
        ],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.additionalDataNeeds.length).toBe(1);
    expect(result.additionalDataNeeds[0]!.type).toBe('account');
  });

  it('32. normalizes steps with auto-ordering', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-001',
            scenarioTemporaryId: 'SCN-CAND-001',
            requirementIds: ['REQ-0001'],
            title: 'Test',
            objective: 'Test',
            type: 'ui',
            priority: 'medium',
            preconditions: [],
            inputs: [],
            dataNeeds: [],
            steps: [{ action: 'Step 1' }, { order: 5, action: 'Step 2' }],
            expectedResults: [],
            cleanup: [],
            automation: { status: 'unknown', reasons: [] },
            provenance: [],
            confidence: 0.5,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases[0]!.steps[0]!.order).toBe(1);
    expect(result.testCases[0]!.steps[1]!.order).toBe(5);
  });

  it('33. filters invalid verification types to other', async () => {
    const provider = new FakeAIProvider({
      response: {
        testCases: [
          {
            temporaryId: 'TC-001',
            scenarioTemporaryId: 'SCN-CAND-001',
            requirementIds: ['REQ-0001'],
            title: 'Test',
            objective: 'Test',
            type: 'ui',
            priority: 'medium',
            preconditions: [],
            inputs: [],
            dataNeeds: [],
            steps: [],
            expectedResults: [{ description: 'Check', verificationType: 'telepathy' }],
            cleanup: [],
            automation: { status: 'unknown', reasons: [] },
            provenance: [],
            confidence: 0.5,
          },
        ],
        additionalDataNeeds: [],
      },
    });

    const { result } = await generateTestCases(ir.requirements, scenarios, provider);
    expect(result.testCases[0]!.expectedResults[0]!.verificationType).toBe('other');
  });
});

// ===========================================================================
// 5. DEDUPLICATOR TESTS (34-41)
// ===========================================================================

describe('Deduplicator', () => {
  it('34. removes duplicate scenarios by title+category+reqIds', () => {
    const scenarios = [
      scenarioCandidate('SCN-001', 'Login test', ['REQ-0001'], {
        category: 'happy-path',
        confidence: 0.9,
      }),
      scenarioCandidate('SCN-002', 'Login test', ['REQ-0001'], {
        category: 'happy-path',
        confidence: 0.7,
      }),
    ];

    const { deduped, warnings } = deduplicateScenarios(scenarios);
    expect(deduped.length).toBe(1);
    expect(deduped[0]!.temporaryId).toBe('SCN-001');
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe(TestPlannerWarningCode.CASE_DUPLICATE);
  });

  it('35. keeps higher confidence duplicate', () => {
    const scenarios = [
      scenarioCandidate('SCN-001', 'Login test', ['REQ-0001'], { confidence: 0.5 }),
      scenarioCandidate('SCN-002', 'Login test', ['REQ-0001'], { confidence: 0.95 }),
    ];

    const { deduped } = deduplicateScenarios(scenarios);
    expect(deduped[0]!.temporaryId).toBe('SCN-002');
  });

  it('36. preserves distinct scenarios', () => {
    const scenarios = [
      scenarioCandidate('SCN-001', 'Login test', ['REQ-0001'], { category: 'happy-path' }),
      scenarioCandidate('SCN-002', 'Login test', ['REQ-0001'], { category: 'negative' }),
    ];

    const { deduped } = deduplicateScenarios(scenarios);
    expect(deduped.length).toBe(2);
  });

  it('37. removes duplicate test cases', () => {
    const testCases = [
      testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'], { title: 'Test A', confidence: 0.9 }),
      testCaseCandidate('TC-002', 'SCN-001', ['REQ-0001'], { title: 'Test A', confidence: 0.7 }),
    ];

    const { deduped, warnings } = deduplicateTestCases(testCases);
    expect(deduped.length).toBe(1);
    expect(deduped[0]!.temporaryId).toBe('TC-001');
    expect(warnings.length).toBe(1);
  });

  it('38. distinguishes test cases by scenario', () => {
    const testCases = [
      testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'], { title: 'Test A' }),
      testCaseCandidate('TC-002', 'SCN-002', ['REQ-0001'], { title: 'Test A' }),
    ];

    const { deduped } = deduplicateTestCases(testCases);
    expect(deduped.length).toBe(2);
  });

  it('39. handles empty input', () => {
    const { deduped, warnings } = deduplicateScenarios([]);
    expect(deduped.length).toBe(0);
    expect(warnings.length).toBe(0);
  });

  it('40. handles empty test case input', () => {
    const { deduped, warnings } = deduplicateTestCases([]);
    expect(deduped.length).toBe(0);
    expect(warnings.length).toBe(0);
  });

  it('41. deduplicates case-insensitively', () => {
    const scenarios = [
      scenarioCandidate('SCN-001', 'Login Test', ['REQ-0001'], { category: 'happy-path' }),
      scenarioCandidate('SCN-002', 'login test', ['REQ-0001'], { category: 'happy-path' }),
    ];

    const { deduped } = deduplicateScenarios(scenarios);
    expect(deduped.length).toBe(1);
  });
});

// ===========================================================================
// 6. VALIDATION TESTS (42-51)
// ===========================================================================

describe('Validation – requirement references', () => {
  it('42. builds valid requirement ID set', () => {
    const ir = minimalRequirementIR();
    const validIds = buildValidRequirementIds(ir);
    expect(validIds.has('REQ-0001')).toBe(true);
    expect(validIds.has('REQ-9999')).toBe(false);
  });

  it('43. warns on dangling requirement references', () => {
    const warnings = validateRequirementReferences(
      ['REQ-9999'],
      new Set(['REQ-0001']),
      'TC-0001',
      'test-case',
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe(TestPlannerWarningCode.CASE_DANGLING_REQUIREMENT);
  });

  it('44. no warnings for valid references', () => {
    const warnings = validateRequirementReferences(
      ['REQ-0001'],
      new Set(['REQ-0001']),
      'TC-0001',
      'test-case',
    );
    expect(warnings.length).toBe(0);
  });
});

describe('Validation – traceability', () => {
  const scenarios: TestScenario[] = [
    {
      id: 'SCN-0001',
      title: 'Test',
      objective: 'Test',
      category: 'happy-path',
      requirementIds: ['REQ-0001'],
      preconditions: [],
      dataNeeds: [],
      expectedBehavior: [],
      priority: 'medium',
      provenance: [],
      confidence: 0.9,
    },
  ];

  it('45. warns on invalid scenario reference', () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-9999',
        requirementIds: ['REQ-0001'],
        title: 'Test',
        objective: 'Test',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [{ description: 'OK', verificationType: 'ui' }],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
    ];

    const warnings = validateScenarioReferences(testCases, scenarios);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe(TestPlannerWarningCode.CASE_INVALID_PROVENANCE);
  });

  it('46. no warnings for valid scenario reference', () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-0001',
        requirementIds: ['REQ-0001'],
        title: 'Test',
        objective: 'Test',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [{ description: 'OK', verificationType: 'ui' }],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
    ];

    const warnings = validateScenarioReferences(testCases, scenarios);
    expect(warnings.length).toBe(0);
  });

  it('47. warns on empty expected results', () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-0001',
        requirementIds: [],
        title: 'Test',
        objective: 'Test',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'unknown', reasons: [] },
        provenance: [],
        confidence: 0.5,
      },
    ];

    const warnings = validateExpectedResults(testCases);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe(TestPlannerWarningCode.EXPECTATION_UNSPECIFIED);
  });
});

describe('Validation – provenance', () => {
  it('48. warns on invalid provenance requirement ID', () => {
    const warnings = validateTestProvenance(
      [{ requirementId: 'REQ-9999' }],
      new Set(['REQ-0001']),
      'TC-0001',
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.code).toBe(TestPlannerWarningCode.CASE_INVALID_PROVENANCE);
  });

  it('49. no warnings for valid provenance', () => {
    const warnings = validateTestProvenance(
      [{ requirementId: 'REQ-0001' }],
      new Set(['REQ-0001']),
      'TC-0001',
    );
    expect(warnings.length).toBe(0);
  });

  it('50. builds valid context IDs from Requirement IR', () => {
    const ir = loadRequirementIR(VALID_REQUIREMENT_IR_DIR);
    const contextIds = buildValidContextIdsFromRequirementIR(ir);
    expect(contextIds.has('ctx-s001-c000')).toBe(true);
  });
});

// ===========================================================================
// 7. QUALITY METRICS TESTS (51-55)
// ===========================================================================

describe('Quality metrics', () => {
  it('51. computes coverage rate correctly', () => {
    const coverages: RequirementCoverage[] = [
      {
        requirementId: 'REQ-0001',
        strategies: ['positive'],
        scenarioIds: ['SCN-0001'],
        status: 'covered',
        reasons: [],
      },
      {
        requirementId: 'REQ-0002',
        strategies: [],
        scenarioIds: [],
        status: 'not-covered',
        reasons: [],
      },
    ];

    const metrics = computeQualityMetrics(coverages, [], [], []);
    expect(metrics.requirementsTotal).toBe(2);
    expect(metrics.requirementsCovered).toBe(1);
    expect(metrics.requirementsNotCovered).toBe(1);
    expect(metrics.coverageRate).toBe(0.5);
  });

  it('52. counts test cases by scenario category', () => {
    const scenarios: TestScenario[] = [
      {
        id: 'SCN-0001',
        title: 'A',
        objective: '',
        category: 'happy-path',
        requirementIds: [],
        preconditions: [],
        dataNeeds: [],
        expectedBehavior: [],
        priority: 'medium',
        provenance: [],
        confidence: 0.9,
      },
      {
        id: 'SCN-0002',
        title: 'B',
        objective: '',
        category: 'negative',
        requirementIds: [],
        preconditions: [],
        dataNeeds: [],
        expectedBehavior: [],
        priority: 'medium',
        provenance: [],
        confidence: 0.9,
      },
    ];
    const testCases: TestCase[] = [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-0001',
        requirementIds: [],
        title: '',
        objective: '',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
      {
        id: 'TC-0002',
        scenarioId: 'SCN-0002',
        requirementIds: [],
        title: '',
        objective: '',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
    ];

    const metrics = computeQualityMetrics([], scenarios, testCases, []);
    expect(metrics.positiveCases).toBe(1);
    expect(metrics.negativeCases).toBe(1);
  });

  it('53. counts automation readiness', () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-0001',
        requirementIds: [],
        title: '',
        objective: '',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
      {
        id: 'TC-0002',
        scenarioId: 'SCN-0001',
        requirementIds: [],
        title: '',
        objective: '',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'manual-only', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
    ];

    const metrics = computeQualityMetrics([], [], testCases, []);
    expect(metrics.automationReady).toBe(1);
  });

  it('54. computes provenance coverage', () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-0001',
        scenarioId: 'SCN-0001',
        requirementIds: [],
        title: '',
        objective: '',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [{ requirementId: 'REQ-0001' }],
        confidence: 0.9,
      },
      {
        id: 'TC-0002',
        scenarioId: 'SCN-0001',
        requirementIds: [],
        title: '',
        objective: '',
        type: 'ui',
        priority: 'medium',
        preconditions: [],
        inputs: [],
        dataNeeds: [],
        steps: [],
        expectedResults: [],
        cleanup: [],
        automation: { status: 'ready', reasons: [] },
        provenance: [],
        confidence: 0.9,
      },
    ];

    const metrics = computeQualityMetrics([], [], testCases, []);
    expect(metrics.provenanceCoverage).toBe(0.5);
  });

  it('55. handles empty inputs', () => {
    const metrics = computeQualityMetrics([], [], [], []);
    expect(metrics.requirementsTotal).toBe(0);
    expect(metrics.coverageRate).toBe(0);
    expect(metrics.provenanceCoverage).toBe(1);
  });
});

// ===========================================================================
// 8. FINGERPRINT TESTS (56-58)
// ===========================================================================

describe('Fingerprint', () => {
  it('56. produces deterministic output', () => {
    const fp1 = computeFingerprint('content', '1.0', 'model');
    const fp2 = computeFingerprint('content', '1.0', 'model');
    expect(fp1).toBe(fp2);
  });

  it('57. changes with different inputs', () => {
    const fp1 = computeFingerprint('content-a', '1.0', 'model');
    const fp2 = computeFingerprint('content-b', '1.0', 'model');
    expect(fp1).not.toBe(fp2);
  });

  it('58. is 16 characters', () => {
    const fp = computeFingerprint('test', '1.0', 'model');
    expect(fp.length).toBe(16);
  });
});

// ===========================================================================
// 9. PROMPT TESTS (59-63)
// ===========================================================================

describe('Prompts', () => {
  it('59. system prompt version is 1.1', () => {
    expect(TEST_PLANNER_PROMPT_VERSION).toBe('1.1');
  });

  it('60. system prompt contains core principles', () => {
    expect(TEST_PLANNER_SYSTEM_PROMPT).toContain('Generate tests ONLY');
    expect(TEST_PLANNER_SYSTEM_PROMPT).toContain('UNKNOWN must never silently become FACT');
  });

  it('61. coverage prompt includes requirements', () => {
    const ir = minimalRequirementIR();
    const prompt = buildCoveragePrompt(ir.requirements);
    expect(prompt).toContain('REQ-0001');
    expect(prompt).toContain('username');
  });

  it('62. scenario prompt includes coverage info', () => {
    const ir = minimalRequirementIR();
    const coverage = [coverageCandidate('REQ-0001', ['positive'])];
    const prompt = buildScenarioPrompt(ir.requirements, coverage);
    expect(prompt).toContain('REQ-0001');
    expect(prompt).toContain('positive');
  });

  it('63. repair prompt includes error info', () => {
    const prompt = buildRepairPrompt('Schema validation failed', {});
    expect(prompt).toContain('Schema validation failed');
  });
});

// ===========================================================================
// 10. ERROR / WARNING TESTS (64-67)
// ===========================================================================

describe('Error codes', () => {
  it('64. TestPlannerError has correct code and message', () => {
    const err = new TestPlannerError(TestPlannerErrorCode.INPUT_NOT_FOUND, 'Not found');
    expect(err.code).toBe('TEST_INPUT_NOT_FOUND');
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('TestPlannerError');
  });

  it('65. TestPlannerError preserves cause', () => {
    const cause = new Error('root');
    const err = new TestPlannerError(TestPlannerErrorCode.PROVIDER_FAILURE, 'Failed', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('Warning codes', () => {
  it('66. confidence thresholds are correct', () => {
    expect(TEST_CONFIDENCE_THRESHOLD.HIGH).toBe(0.8);
    expect(TEST_CONFIDENCE_THRESHOLD.MEDIUM).toBe(0.5);
  });

  it('67. all warning codes are defined', () => {
    expect(TestPlannerWarningCode.REQUIREMENT_NOT_COVERED).toBe('TEST_REQUIREMENT_NOT_COVERED');
    expect(TestPlannerWarningCode.CASE_DUPLICATE).toBe('TEST_CASE_DUPLICATE');
    expect(TestPlannerWarningCode.REPAIR_APPLIED).toBe('TEST_REPAIR_APPLIED');
  });
});

// ===========================================================================
// 11. END-TO-END PLANNER TESTS (68-80)
// ===========================================================================

describe('Planner – end-to-end pipeline', () => {
  it('68. produces valid TestPlanIR from fixture', async () => {
    const tmpOutput = createTempOutput();
    const provider = buildTestPlannerFakeProvider(
      [
        coverageResult({
          coverageCandidates: [coverageCandidate('REQ-0001', ['positive', 'validation'])],
        }),
      ],
      scenarioResult({
        scenarios: [scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001'])],
      }),
      testCaseResult({
        testCases: [testCaseCandidate('TC-CAND-001', 'SCN-CAND-001', ['REQ-0001'])],
      }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, { outputDir: tmpOutput });

    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.scenarios.length).toBe(1);
    expect(ir.testCases.length).toBe(1);
    expect(ir.scenarios[0]!.id).toBe('SCN-0001');
    expect(ir.testCases[0]!.id).toBe('TC-0001');
    expect(ir.testCases[0]!.scenarioId).toBe('SCN-0001');

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('69. writes output files', async () => {
    const tmpOutput = createTempOutput();
    const provider = buildTestPlannerFakeProvider(
      [coverageResult({ coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])] })],
      scenarioResult({ scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])] }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, { outputDir: tmpOutput });

    expect(fs.existsSync(path.join(tmpOutput, 'test-plan-ir.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'test-case-ir.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'quality-report.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'intermediate', 'coverage-analysis.json'))).toBe(
      true,
    );

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('70. manifest has correct stats', async () => {
    const tmpOutput = createTempOutput();
    const provider = buildTestPlannerFakeProvider(
      [coverageResult({ coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])] })],
      scenarioResult({ scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])] }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, { outputDir: tmpOutput });

    const manifest = JSON.parse(fs.readFileSync(path.join(tmpOutput, 'manifest.json'), 'utf-8'));
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.promptVersion).toBe(TEST_PLANNER_PROMPT_VERSION);
    expect(manifest.stats.requirements).toBe(3);
    expect(manifest.stats.scenarios).toBe(1);
    expect(manifest.stats.testCases).toBe(1);
    expect(manifest.usage.requests).toBeGreaterThan(0);
    expect(manifest.provider.name).toBe('fake');
    expect(manifest.fingerprint.length).toBe(16);

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('71. handles empty AI responses gracefully', async () => {
    const tmpOutput = createTempOutput();
    const provider = buildTestPlannerFakeProvider(
      [coverageResult()],
      scenarioResult(),
      testCaseResult(),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, { outputDir: tmpOutput });

    expect(ir.scenarios.length).toBe(0);
    expect(ir.testCases.length).toBe(0);
    expect(ir.requirementCoverage.length).toBeGreaterThan(0);

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('72. assigns deterministic IDs', async () => {
    const provider = buildTestPlannerFakeProvider(
      [
        coverageResult({
          coverageCandidates: [
            coverageCandidate('REQ-0001', ['positive']),
            coverageCandidate('REQ-0002', ['boundary']),
          ],
        }),
      ],
      scenarioResult({
        scenarios: [
          scenarioCandidate('SCN-A', 'Scenario A', ['REQ-0001']),
          scenarioCandidate('SCN-B', 'Scenario B', ['REQ-0002']),
        ],
      }),
      testCaseResult({
        testCases: [
          testCaseCandidate('TC-A', 'SCN-A', ['REQ-0001']),
          testCaseCandidate('TC-B', 'SCN-B', ['REQ-0002']),
        ],
      }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    expect(ir.scenarios[0]!.id).toBe('SCN-0001');
    expect(ir.scenarios[1]!.id).toBe('SCN-0002');
    expect(ir.testCases[0]!.id).toBe('TC-0001');
    expect(ir.testCases[1]!.id).toBe('TC-0002');
  });

  it('73. builds requirement coverage mapping', async () => {
    const provider = buildTestPlannerFakeProvider(
      [
        coverageResult({
          coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        }),
      ],
      scenarioResult({
        scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])],
      }),
      testCaseResult({
        testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])],
      }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    const req1Coverage = ir.requirementCoverage.find((c) => c.requirementId === 'REQ-0001');
    expect(req1Coverage).toBeDefined();
    expect(req1Coverage!.status).toBe('covered');
    expect(req1Coverage!.scenarioIds).toContain('SCN-0001');
  });

  it('74. marks uncovered requirements', async () => {
    const provider = buildTestPlannerFakeProvider(
      [
        coverageResult({
          coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        }),
      ],
      scenarioResult({
        scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])],
      }),
      testCaseResult({
        testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])],
      }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    const req2Coverage = ir.requirementCoverage.find((c) => c.requirementId === 'REQ-0002');
    expect(req2Coverage).toBeDefined();
    expect(req2Coverage!.status).toBe('not-covered');
  });

  it('75. collects unresolved items', async () => {
    const provider = buildTestPlannerFakeProvider(
      [
        coverageResult({
          coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
          unresolvedCandidates: [
            {
              requirementId: 'REQ-0001',
              description: 'Error behavior unknown',
              reason: 'missing-error-behavior',
              provenance: [],
            },
          ],
        }),
      ],
      scenarioResult({ scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])] }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    expect(ir.unresolved.length).toBe(1);
    expect(ir.unresolved[0]!.id).toBe('TEST-UNRESOLVED-0001');
    expect(ir.unresolved[0]!.reason).toBe('missing-error-behavior');
  });

  it('76. collects data needs', async () => {
    const provider = buildTestPlannerFakeProvider(
      [coverageResult({ coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])] })],
      scenarioResult({
        scenarios: [
          scenarioCandidate('SCN-001', 'Test', ['REQ-0001'], {
            dataNeeds: [
              {
                description: 'User account',
                type: 'account',
                constraints: ['active'],
                relatedRequirementIds: ['REQ-0001'],
              },
            ],
          }),
        ],
      }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    expect(ir.dataNeeds.length).toBe(1);
    expect(ir.dataNeeds[0]!.id).toBe('DATA-0001');
    expect(ir.dataNeeds[0]!.type).toBe('account');
  });

  it('77. works with in-memory Requirement IR', async () => {
    const ir = minimalRequirementIR();
    const tmpDir = createTempRequirementIR(ir);
    const tmpOutput = createTempOutput();

    const provider = buildTestPlannerFakeProvider(
      [coverageResult({ coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])] })],
      scenarioResult({ scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])] }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    const result = await buildTestPlan(tmpDir, provider, { outputDir: tmpOutput });

    expect(result.scenarios.length).toBe(1);
    expect(result.testCases.length).toBe(1);

    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('78. quality metrics are computed', async () => {
    const provider = buildTestPlannerFakeProvider(
      [coverageResult({ coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])] })],
      scenarioResult({ scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])] }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    expect(ir.quality.requirementsTotal).toBe(3);
    expect(ir.quality.testCases).toBe(1);
    expect(ir.quality.scenarios).toBe(1);
    expect(typeof ir.quality.coverageRate).toBe('number');
  });

  it('79. scope is populated correctly', async () => {
    const provider = buildTestPlannerFakeProvider(
      [coverageResult()],
      scenarioResult(),
      testCaseResult(),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    expect(ir.scope.requirementIds.length).toBe(3);
    expect(ir.scope.objective.length).toBeGreaterThan(0);
    expect(ir.scope.exclusions.length).toBeGreaterThan(0);
  });

  it('80. test case IDs reference valid scenario IDs', async () => {
    const provider = buildTestPlannerFakeProvider(
      [coverageResult({ coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])] })],
      scenarioResult({ scenarios: [scenarioCandidate('SCN-001', 'Test', ['REQ-0001'])] }),
      testCaseResult({ testCases: [testCaseCandidate('TC-001', 'SCN-001', ['REQ-0001'])] }),
    );

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider);

    const scenarioIds = new Set(ir.scenarios.map((s) => s.id));
    for (const tc of ir.testCases) {
      expect(scenarioIds.has(tc.scenarioId)).toBe(true);
    }
  });
});
