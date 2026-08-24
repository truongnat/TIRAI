// ---------------------------------------------------------------------------
// Deterministic extractor regression tests – §21
// ---------------------------------------------------------------------------
// Covers the 15 required test scenarios for the deterministic data extraction
// layer that converts explicit test case dataNeeds into DataRequirementCandidates.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import {
  extractDeterministic,
  mergeExtractionResults,
} from '../src/analysis/deterministic-extractor.js';
import { buildTestDataPlan } from '../src/planner.js';
import type {
  TestCaseIRInput,
  DataRequirementExtractionResult,
} from '../src/models.js';
import {
  minimalTestCaseIR, dataReqResult, depResult,
  buildDataPlannerFakeProvider, createTempTestCaseIR,
} from './fixtures/helpers.js';

// ---- Helper: build a test case with explicit dataNeeds --------------------

function tcWithDataNeeds(
  id: string,
  dataNeeds: Array<{ id: string; description: string; type: string; constraints?: string[]; relatedRequirementIds?: string[] }>,
  overrides?: Partial<TestCaseIRInput['testCases'][0]>,
): TestCaseIRInput['testCases'][0] {
  return {
    id,
    scenarioId: `SCN-${id}`,
    requirementIds: ['REQ-0001'],
    title: `Test ${id}`,
    objective: `Objective for ${id}`,
    type: 'functional',
    priority: 'high',
    preconditions: [],
    inputs: [],
    dataNeeds: dataNeeds.map((dn) => ({
      id: dn.id,
      description: dn.description,
      type: dn.type,
      constraints: dn.constraints ?? [],
      relatedRequirementIds: dn.relatedRequirementIds ?? ['REQ-0001'],
    })),
    steps: [{ order: 1, action: 'Execute test' }],
    expectedResults: [{ description: 'Result matches', verificationType: 'functional' }],
    cleanup: [],
    automation: { status: 'ready', reasons: [] },
    provenance: [{ requirementId: 'REQ-0001' }],
    confidence: 0.9,
    ...overrides,
  };
}

// ===========================================================================
// §21.1: Test Case with explicit inputs → DataItem
// ===========================================================================

describe('deterministic extraction – §21 regression', () => {
  it('1. test case with explicit dataNeeds produces DataItems', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0001', [
          { id: 'DN-001', description: 'Valid username', type: 'input' },
          { id: 'DN-002', description: 'Valid password', type: 'input' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult(), // AI returns empty
      depResult(),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(2);
    expect(result.dataItems[0]!.description).toBe('Valid username');
    expect(result.dataItems[1]!.description).toBe('Valid password');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.2: Test Case with account precondition → account DataItem
  it('2. test case with account dataNeed → account DataItem', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0002', [
          { id: 'DN-003', description: 'A valid user account with active status', type: 'account' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(1);
    expect(result.dataItems[0]!.type).toBe('account');
    expect(result.dataItems[0]!.description).toContain('valid user account');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.3: invalid input → invalid-value requirement
  it('3. invalid input dataNeed → generate strategy', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0003', [
          { id: 'DN-004', description: 'An invalid password value', type: 'input' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(1);
    expect(result.dataItems[0]!.strategy).toBe('generate');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.4: date input → date DataItem
  it('4. date dataNeed → input type with date classification', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0004', [
          { id: 'DN-005', description: 'A shipment date value', type: 'input' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(1);
    expect(result.dataItems[0]!.type).toBe('input');
    expect(result.dataItems[0]!.description).toContain('date');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.5: existing-state precondition → state/data record
  it('5. existing record dataNeed → database-record with reuse-existing', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0005', [
          { id: 'DN-006', description: 'An existing shipment record in the database', type: 'database-record' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(1);
    expect(result.dataItems[0]!.type).toBe('database-record');
    expect(result.dataItems[0]!.strategy).toBe('reuse-existing');
    expect(result.dataItems[0]!.lifecycle).toBe('existing');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.6: no data requirement → zero items valid
  it('6. test case with no dataNeeds and no AI results → zero items valid', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        {
          id: 'TC-0006',
          scenarioId: 'SCN-0006',
          requirementIds: ['REQ-0001'],
          title: 'Simple verification',
          objective: 'Verify something without data',
          type: 'functional',
          priority: 'low',
          preconditions: [],
          inputs: [],
          dataNeeds: [],
          steps: [{ order: 1, action: 'Check status' }],
          expectedResults: [{ description: 'Status is ok', verificationType: 'functional' }],
          cleanup: [],
          automation: { status: 'ready', reasons: [] },
          provenance: [{ requirementId: 'REQ-0001' }],
          confidence: 0.9,
        },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(0);
    expect(result.testCases.length).toBe(1);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.7: 50 tests require data + zero output → quality failure
  it('7. tests require data + zero AI output → deterministic items still produced', async () => {
    const testCases = Array.from({ length: 50 }, (_, i) =>
      tcWithDataNeeds(`TC-${String(i + 1).padStart(4, '0')}`, [
        { id: `DN-${i + 1}`, description: `Data need ${i + 1}`, type: 'input' },
      ]),
    );
    const ir = minimalTestCaseIR({ testCases });
    const tmpDir = createTempTestCaseIR(ir);
    // AI returns empty (simulating the real-world failure)
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    // Deterministic layer should still produce 50 items
    expect(result.dataItems.length).toBe(50);
    expect(result.quality.testsRequiringData).toBe(50);
    expect(result.quality.testsCoveredByData).toBe(50);
    expect(result.quality.coverageRate).toBe(1);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.8: abstract requirement preserved without physical mapping
  it('8. abstract requirement preserved without physical mapping', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0008', [
          { id: 'DN-008', description: 'A valid user account', type: 'account' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(1);
    // No physical details invented
    expect(result.dataItems[0]!.description).not.toContain('table');
    expect(result.dataItems[0]!.description).not.toContain('column');
    expect(result.dataItems[0]!.description).not.toContain('SELECT');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.9: no invented table name
  it('9. deterministic extractor does not invent table names', () => {
    const testCases = [tcWithDataNeeds('TC-0009', [
      { id: 'DN-009', description: 'An existing user record', type: 'database-record' },
    ])];
    const result = extractDeterministic(testCases);
    expect(result.dataCandidates.length).toBe(1);
    const desc = result.dataCandidates[0]!.description.toLowerCase();
    expect(desc).not.toContain('users');
    expect(desc).not.toContain('table');
    expect(desc).not.toContain('select ');
  });

  // §21.10: no invented API endpoint
  it('10. deterministic extractor does not invent API endpoints', () => {
    const testCases = [tcWithDataNeeds('TC-0010', [
      { id: 'DN-010', description: 'A valid API request payload', type: 'input' },
    ])];
    const result = extractDeterministic(testCases);
    expect(result.dataCandidates.length).toBe(1);
    const desc = result.dataCandidates[0]!.description;
    expect(desc).not.toContain('/api/');
    expect(desc).not.toContain('http');
  });

  // §21.11: provenance inheritance
  it('11. data items inherit provenance from test case', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0011', [
          { id: 'DN-011', description: 'A valid configuration value', type: 'configuration', relatedRequirementIds: ['REQ-0001', 'REQ-0002'] },
        ], {
          provenance: [{ requirementId: 'REQ-0001' }, { requirementId: 'REQ-0002' }],
        }),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(1);
    expect(result.dataItems[0]!.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.dataItems[0]!.provenance.some((p) => p.requirementId === 'REQ-0001')).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.12: reusable candidate (shared dataNeeds across test cases)
  it('12. shared dataNeeds across test cases → deduplication to single item', async () => {
    const sharedNeed = { id: 'DN-SHARED', description: 'A valid user account', type: 'account' };
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0012a', [sharedNeed]),
        tcWithDataNeeds('TC-0012b', [sharedNeed]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    // Same description + type → deduped to 1 item (not 2)
    expect(result.dataItems.length).toBe(1);
    // The deduped item references at least the first test case
    expect(result.dataItems[0]!.relatedTestCaseIds.length).toBeGreaterThanOrEqual(1);
    // Both test cases should have data plans pointing to this item
    const tcPlans = result.testCases.filter(
      (tcp) => tcp.requiredDataItemIds.includes(result.dataItems[0]!.id),
    );
    expect(tcPlans.length).toBe(2);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.13: valid/invalid variants not incorrectly deduped
  it('13. valid and invalid variants are NOT deduped', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0013', [
          { id: 'DN-013a', description: 'A valid password', type: 'input' },
          { id: 'DN-013b', description: 'An invalid password', type: 'input' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    // Different descriptions → NOT deduped
    expect(result.dataItems.length).toBe(2);
    expect(result.dataItems[0]!.description).toContain('valid');
    expect(result.dataItems[1]!.description).toContain('invalid');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.14: unresolved physical mapping retained
  it('14. unresolved candidates from AI are retained', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        tcWithDataNeeds('TC-0014', [
          { id: 'DN-014', description: 'A valid account', type: 'account' },
        ]),
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const aiResult = dataReqResult({
      dataCandidates: [],
      unresolvedCandidates: [{
        testCaseIds: ['TC-0014'],
        description: 'Cannot determine DB constraint for account',
        reason: 'missing-constraint',
        provenance: [{ requirementId: 'REQ-0001' }],
      }],
    });
    const provider = buildDataPlannerFakeProvider(aiResult, depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    // Deterministic item + unresolved from AI
    expect(result.dataItems.length).toBe(1);
    expect(result.unresolved.length).toBe(1);
    expect(result.unresolved[0]!.description).toContain('DB constraint');
    fs.rmSync(tmpDir, { recursive: true });
  });

  // §21.15: real current TestCase schema compatibility
  it('15. real TestCase schema with all fields is compatible', () => {
    const testCases: TestCaseIRInput['testCases'] = [
      {
        id: 'TC-0015',
        scenarioId: 'SCN-0015',
        requirementIds: ['REQ-0001', 'REQ-0002'],
        title: 'Full schema test case',
        objective: 'Verify all fields are handled',
        type: 'functional',
        priority: 'high',
        preconditions: [
          { description: 'User is authenticated', sourceRequirementIds: ['REQ-0001'] },
        ],
        inputs: [
          { name: 'username', valueStrategy: 'valid', description: 'Valid username' },
          { name: 'password', valueStrategy: 'valid', description: 'Valid password' },
        ],
        dataNeeds: [
          {
            id: 'DATA-0015',
            description: 'A valid user account that can authenticate',
            type: 'other',
            constraints: ['required'],
            relatedRequirementIds: ['REQ-0001', 'REQ-0002'],
          },
        ],
        steps: [
          { order: 1, action: 'Send login request', target: 'auth endpoint', input: 'credentials' },
        ],
        expectedResults: [
          { description: 'Login succeeds', verificationType: 'api', target: 'response' },
        ],
        cleanup: [{ description: 'Clean up session' }],
        automation: { status: 'ready', suggestedExecutor: 'api', reasons: [] },
        provenance: [{ requirementId: 'REQ-0001', contextId: 'ctx-001', sheet: 'Login', ranges: ['A1'] }],
        confidence: 0.95,
      },
    ];
    const result = extractDeterministic(testCases);
    expect(result.dataCandidates.length).toBe(1);
    const candidate = result.dataCandidates[0]!;
    expect(candidate.testCaseId).toBe('TC-0015');
    expect(candidate.description).toBe('A valid user account that can authenticate');
    expect(candidate.relatedRequirementIds).toEqual(['REQ-0001', 'REQ-0002']);
    expect(candidate.provenance.length).toBeGreaterThanOrEqual(1);
    expect(candidate.confidence).toBe(0.9);
  });
});

// ===========================================================================
// Merge behavior
// ===========================================================================

describe('mergeExtractionResults', () => {
  it('deterministic candidates take precedence over AI duplicates', () => {
    const deterministic: DataRequirementExtractionResult = {
      dataCandidates: [{
        temporaryId: 'DET-001',
        testCaseId: 'TC-0001',
        name: 'Valid account',
        description: 'A valid user account',
        type: 'account',
        lifecycle: 'existing',
        strategy: 'reuse-existing',
        constraints: [],
        relatedRequirementIds: ['REQ-0001'],
        relatedEntityIds: [],
        provenance: [{ requirementId: 'REQ-0001' }],
        confidence: 0.9,
      }],
      unresolvedCandidates: [],
    };
    const ai: DataRequirementExtractionResult = {
      dataCandidates: [{
        temporaryId: 'AI-001',
        testCaseId: 'TC-0001',
        name: 'Valid account',
        description: 'A valid user account',
        type: 'account',
        lifecycle: 'existing',
        strategy: 'reuse-existing',
        constraints: [],
        relatedRequirementIds: ['REQ-0001'],
        relatedEntityIds: [],
        provenance: [],
        confidence: 0.8,
      }],
      unresolvedCandidates: [],
    };
    const merged = mergeExtractionResults(deterministic, ai);
    // Same type+description+testCaseId → AI duplicate dropped
    expect(merged.dataCandidates.length).toBe(1);
    expect(merged.dataCandidates[0]!.temporaryId).toBe('DET-001');
  });

  it('AI candidates with different descriptions are preserved', () => {
    const deterministic: DataRequirementExtractionResult = {
      dataCandidates: [{
        temporaryId: 'DET-001',
        testCaseId: 'TC-0001',
        name: 'Valid account',
        description: 'A valid user account',
        type: 'account',
        lifecycle: 'existing',
        strategy: 'reuse-existing',
        constraints: [],
        relatedRequirementIds: [],
        relatedEntityIds: [],
        provenance: [],
        confidence: 0.9,
      }],
      unresolvedCandidates: [],
    };
    const ai: DataRequirementExtractionResult = {
      dataCandidates: [{
        temporaryId: 'AI-001',
        testCaseId: 'TC-0001',
        name: 'Session token',
        description: 'A valid session token',
        type: 'token',
        lifecycle: 'generated',
        strategy: 'generate',
        constraints: [],
        relatedRequirementIds: [],
        relatedEntityIds: [],
        provenance: [],
        confidence: 0.8,
      }],
      unresolvedCandidates: [],
    };
    const merged = mergeExtractionResults(deterministic, ai);
    expect(merged.dataCandidates.length).toBe(2);
  });
});

// ===========================================================================
// Zero-coverage quality gate
// ===========================================================================

describe('zero-coverage quality gate', () => {
  it('emits TEST_DATA_COVERAGE_ZERO when tests need data but 0 items produced', async () => {
    // TC with inputs that trigger the quality metric "requires data" heuristic
    // (inputs.length > 0) but whose inputs lack name+valueStrategy so the
    // deterministic context extractor does not produce candidates.
    const ir = minimalTestCaseIR({
      testCases: [
        {
          id: 'TC-0099',
          scenarioId: 'SCN-0099',
          requirementIds: ['REQ-0001'],
          title: 'Static content verification',
          objective: 'Verify static content renders',
          type: 'ui',
          priority: 'low',
          preconditions: [],
          inputs: [{ name: '', valueStrategy: '', description: 'Some input without name/strategy' }],
          dataNeeds: [],
          steps: [{ order: 1, action: 'Check display' }],
          expectedResults: [{ description: 'Content is displayed', verificationType: 'ui' }],
          cleanup: [],
          automation: { status: 'ready', reasons: [] },
          provenance: [{ requirementId: 'REQ-0001' }],
          confidence: 0.9,
        },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(0);
    expect(result.quality.testsRequiringData).toBeGreaterThan(0);
    expect(result.quality.dataItems).toBe(0);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('context extraction covers TCs without dataNeeds but with data-requiring preconditions', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        {
          id: 'TC-0088',
          scenarioId: 'SCN-0088',
          requirementIds: ['REQ-0001'],
          title: 'Login with preconditions only',
          objective: 'Verify login works',
          type: 'api',
          priority: 'high',
          preconditions: [{ description: 'User has a valid account', sourceRequirementIds: ['REQ-0001'] }],
          inputs: [],
          dataNeeds: [],
          steps: [{ order: 1, action: 'Send login request' }],
          expectedResults: [{ description: 'Login succeeds', verificationType: 'api' }],
          cleanup: [],
          automation: { status: 'ready', reasons: [] },
          provenance: [{ requirementId: 'REQ-0001' }],
          confidence: 0.9,
        },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(dataReqResult(), depResult());
    const result = await buildTestDataPlan(tmpDir, provider);
    // Context extraction should pick up the account precondition
    expect(result.dataItems.length).toBeGreaterThan(0);
    expect(result.dataItems.some((d) => d.type === 'account')).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
