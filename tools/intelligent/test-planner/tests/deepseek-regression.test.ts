// ---------------------------------------------------------------------------
// Regression tests – DeepSeek real response formats
// ---------------------------------------------------------------------------
// These tests verify that the normalizers correctly handle the actual JSON
// formats returned by DeepSeek during real API calls. No API calls needed –
// all responses are captured fixtures.
//
// Two categories:
// 1. Canonicalization: raw DeepSeek response → normalizer → canonical shape
// 2. Strict rejection: unknown structures produce empty results (not silently accepted)

import { describe, it, expect } from 'vitest';
import { normalizeCoverageResult } from '../src/analysis/coverage-analyzer.js';
import { normalizeScenarioResult } from '../src/analysis/scenario-generator.js';
import { normalizeTestCaseResult } from '../src/analysis/test-case-generator.js';

// ---- Shared valid IDs -----------------------------------------------------

const VALID_REQ_IDS = new Set([
  'REQ-0001', 'REQ-0002', 'REQ-0011', 'REQ-0012', 'REQ-0021',
]);
const VALID_SCENARIO_IDS = new Set(['SCN-0001', 'SC-0001', 'SCEN-0001']);

// ---- Coverage fixtures (captured from real DeepSeek responses) ------------

const DEEPSEEK_COVERAGE_ANALYSIS_ARRAY = {
  coverage_analysis: [
    {
      id: 'REQ-0001',
      testability: 'testable',
      justified_strategies: ['positive', 'state-transition'],
      rationale: 'Describes expected successful authentication outcome.',
    },
    {
      id: 'REQ-0002',
      testability: 'testable',
      justified_strategies: ['negative', 'security', 'error-handling'],
      rationale: 'Describes authentication failure handling.',
    },
  ],
};

const DEEPSEEK_COVERAGE_ARRAY = {
  coverage: [
    { id: 'REQ-0011', testability: 'testable', strategies: ['data', 'positive'] },
    { id: 'REQ-0012', testability: 'testable', strategies: ['data', 'positive'] },
  ],
};

const DEEPSEEK_REQUIREMENTS_ARRAY = {
  requirements: [
    {
      id: 'REQ-0021',
      testability: 'testable',
      selected_strategies: ['positive', 'validation', 'security'],
      justification: 'REQ-0021 explicitly requires validation.',
    },
  ],
};

const DEEPSEEK_FLAT_REQUIREMENT_ID = {
  requirement_id: 'REQ-0021',
  testability: 'testable',
  justified_strategies: ['positive', 'validation', 'security'],
  rationale: 'Validation behavior.',
};

const CANONICAL_COVERAGE = {
  coverageCandidates: [
    {
      requirementId: 'REQ-0001',
      strategies: ['positive', 'state-transition'],
      reasons: ['Expected behavior'],
      confidence: 0.9,
    },
  ],
  unresolvedCandidates: [],
};

// ---- Scenario fixtures ----------------------------------------------------

const DEEPSEEK_SCENARIOS = {
  scenarios: [
    {
      temporaryId: 'SCEN-0001',
      title: 'Store JWT token and navigate to home on successful authentication',
      objective: 'Verify that upon successful authentication, the system stores the JWT token.',
      category: 'happy-path',
      requirementIds: ['REQ-0001'],
      preconditions: [{ description: 'User has valid credentials.', sourceRequirementIds: ['REQ-0001'] }],
      dataNeeds: [],
      expectedBehavior: ['JWT token is stored in localStorage'],
      priority: 'medium',
      provenance: [{ requirementId: 'REQ-0001' }],
      confidence: 0.8,
    },
  ],
};

// ---- Test case fixtures ---------------------------------------------------

const DEEPSEEK_TEST_CASE_CANDIDATES = {
  test_case_candidates: [
    {
      id: 'TC-0001',
      scenario_id: 'SCEN-0001',
      title: 'Store JWT token and navigate to home',
      requirement_ids: ['REQ-0001'],
      objective: 'Verify JWT token storage.',
      type: 'positive',
      priority: 'medium',
      preconditions: [],
      inputs: [],
      dataNeeds: [],
      steps: [{ order: 1, action: 'Click login', target: 'button', input: '', expectedIntermediateResult: '' }],
      expectedResults: [{ description: 'JWT stored', verificationType: 'assertion', target: 'localStorage' }],
      cleanup: [],
      automation: { ready: true, notes: '' },
      provenance: [{ requirementId: 'REQ-0001' }],
      confidence: 0.8,
    },
  ],
  additionalDataNeeds: [],
};

// ===========================================================================
// 1. CANONICALIZATION TESTS
// ===========================================================================

describe('Canonicalization – coverage normalizer', () => {
  it('coverage_analysis array with justified_strategies → canonical', () => {
    const result = normalizeCoverageResult(DEEPSEEK_COVERAGE_ANALYSIS_ARRAY, VALID_REQ_IDS);
    expect(result.coverageCandidates).toHaveLength(2);
    expect(result.coverageCandidates[0].requirementId).toBe('REQ-0001');
    expect(result.coverageCandidates[0].strategies).toEqual(['positive', 'state-transition']);
    expect(result.coverageCandidates[1].requirementId).toBe('REQ-0002');
    expect(result.coverageCandidates[1].strategies).toEqual(['negative', 'security', 'error-handling']);
  });

  it('coverage array with strategies → canonical', () => {
    const result = normalizeCoverageResult(DEEPSEEK_COVERAGE_ARRAY, VALID_REQ_IDS);
    expect(result.coverageCandidates).toHaveLength(2);
    expect(result.coverageCandidates[0].requirementId).toBe('REQ-0011');
    expect(result.coverageCandidates[0].strategies).toEqual(['data', 'positive']);
  });

  it('requirements array with selected_strategies → canonical', () => {
    const result = normalizeCoverageResult(DEEPSEEK_REQUIREMENTS_ARRAY, VALID_REQ_IDS);
    expect(result.coverageCandidates).toHaveLength(1);
    expect(result.coverageCandidates[0].requirementId).toBe('REQ-0021');
    expect(result.coverageCandidates[0].strategies).toEqual(['positive', 'validation', 'security']);
  });

  it('flat requirement_id with justified_strategies → canonical', () => {
    const result = normalizeCoverageResult(DEEPSEEK_FLAT_REQUIREMENT_ID, VALID_REQ_IDS);
    expect(result.coverageCandidates).toHaveLength(1);
    expect(result.coverageCandidates[0].requirementId).toBe('REQ-0021');
    expect(result.coverageCandidates[0].strategies).toContain('positive');
    expect(result.coverageCandidates[0].strategies).toContain('validation');
  });

  it('canonical coverageCandidates passes through unchanged', () => {
    const result = normalizeCoverageResult(CANONICAL_COVERAGE, VALID_REQ_IDS);
    expect(result.coverageCandidates).toHaveLength(1);
    expect(result.coverageCandidates[0].requirementId).toBe('REQ-0001');
    expect(result.coverageCandidates[0].strategies).toEqual(['positive', 'state-transition']);
    expect(result.coverageCandidates[0].confidence).toBe(0.9);
  });
});

describe('Canonicalization – scenario normalizer', () => {
  it('scenarios array → canonical shape', () => {
    const result = normalizeScenarioResult(DEEPSEEK_SCENARIOS, VALID_REQ_IDS);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].temporaryId).toBe('SCEN-0001');
    expect(result.scenarios[0].title).toContain('JWT');
    expect(result.scenarios[0].requirementIds).toEqual(['REQ-0001']);
    expect(result.scenarios[0].category).toBe('happy-path');
  });
});

describe('Canonicalization – test case normalizer', () => {
  it('test_case_candidates with scenario_id/requirement_ids → canonical', () => {
    const result = normalizeTestCaseResult(
      DEEPSEEK_TEST_CASE_CANDIDATES,
      VALID_REQ_IDS,
      VALID_SCENARIO_IDS,
    );
    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].title).toContain('JWT');
    expect(result.testCases[0].scenarioTemporaryId).toBe('SCEN-0001');
    expect(result.testCases[0].requirementIds).toEqual(['REQ-0001']);
  });
});

// ===========================================================================
// 2. STRICT REJECTION TESTS
// ===========================================================================

describe('Strict rejection – unknown structures produce empty results', () => {
  it('coverage: unknown root key produces 0 candidates', () => {
    const result = normalizeCoverageResult(
      { casesResult: [{ requirementId: 'REQ-0001', strategies: ['positive'] }] },
      VALID_REQ_IDS,
    );
    expect(result.coverageCandidates).toHaveLength(0);
  });

  it('coverage: completely unknown shape produces 0 candidates', () => {
    const result = normalizeCoverageResult(
      { whatever: [{ foo: 'bar' }] },
      VALID_REQ_IDS,
    );
    expect(result.coverageCandidates).toHaveLength(0);
  });

  it('coverage: generatedItems key is not recognized', () => {
    const result = normalizeCoverageResult(
      { generatedItems: [{ requirementId: 'REQ-0001', strategies: ['positive'] }] },
      VALID_REQ_IDS,
    );
    expect(result.coverageCandidates).toHaveLength(0);
  });

  it('scenario: unknown root key produces 0 scenarios', () => {
    const result = normalizeScenarioResult(
      { scenario_candidates: [{ temporaryId: 'SCEN-0001', title: 'Test' }] },
      VALID_REQ_IDS,
    );
    expect(result.scenarios).toHaveLength(0);
  });

  it('test case: unknown root key produces 0 test cases', () => {
    const result = normalizeTestCaseResult(
      { cases: [{ temporaryId: 'TC-0001', title: 'Test' }] },
      VALID_REQ_IDS,
      VALID_SCENARIO_IDS,
    );
    expect(result.testCases).toHaveLength(0);
  });

  it('test case: generatedItems key is not recognized', () => {
    const result = normalizeTestCaseResult(
      { generatedItems: [{ temporaryId: 'TC-0001', title: 'Test' }] },
      VALID_REQ_IDS,
      VALID_SCENARIO_IDS,
    );
    expect(result.testCases).toHaveLength(0);
  });
});
