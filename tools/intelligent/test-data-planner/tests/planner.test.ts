// ---------------------------------------------------------------------------
// Test Data Planner – main pipeline tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildTestDataPlan } from '../src/planner.js';
import { TestDataPlannerError } from '../src/errors.js';
import {
  minimalTestCaseIR, dataReqResult, dataCandidate, depResult,
  buildDataPlannerFakeProvider, createTempTestCaseIR, createTempOutput,
  testProv, VALID_TEST_CASE_IR_DIR,
} from './fixtures/helpers.js';

// ===========================================================================
// INPUT VALIDATION (tests 1-3)
// ===========================================================================

describe('Input validation', () => {
  it('1. loads valid Test Case IR from fixture directory', async () => {
    const provider = buildDataPlannerFakeProvider();
    const result = await buildTestDataPlan(VALID_TEST_CASE_IR_DIR, provider);
    expect(result.schemaVersion).toBe('1.0');
    expect(result.testCases.length).toBeGreaterThan(0);
  });

  it('2. throws DATA_INPUT_NOT_FOUND for missing directory', async () => {
    const provider = buildDataPlannerFakeProvider();
    await expect(buildTestDataPlan('/nonexistent/path', provider))
      .rejects.toThrow(TestDataPlannerError);
  });

  it('3. throws DATA_INVALID_TEST_CASE_IR for malformed JSON', async () => {
    const tmpDir = fs.mkdtempSync('/tmp/tdp-bad-');
    fs.writeFileSync(path.join(tmpDir, 'test-case-ir.json'), '{invalid json', 'utf-8');
    const provider = buildDataPlannerFakeProvider();
    await expect(buildTestDataPlan(tmpDir, provider))
      .rejects.toThrow(TestDataPlannerError);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('4. throws for unsupported schema version', async () => {
    const ir = minimalTestCaseIR({ schemaVersion: '2.0' });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider();
    await expect(buildTestDataPlan(tmpDir, provider))
      .rejects.toThrow('Unsupported schema version');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// DATA EXTRACTION – all types (tests 5-13)
// ===========================================================================

describe('Data extraction – types', () => {
  const types = ['input', 'database-record', 'account', 'state', 'external-response',
    'file', 'configuration', 'token', 'identifier'] as const;

  for (const type of types) {
    it(`extracts data item of type: ${type}`, async () => {
      const ir = minimalTestCaseIR();
      const tmpDir = createTempTestCaseIR(ir);
      const provider = buildDataPlannerFakeProvider(
        dataReqResult({
          dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', `${type} data`, { type })],
        }),
      );
      const result = await buildTestDataPlan(tmpDir, provider);
      expect(result.dataItems.some((d) => d.type === type)).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });
  }

  it('falls back to "other" for unknown type', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'mystery', { type: 'bogus' as any })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.type).toBe('other');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// CONSTRAINTS (tests 14-22)
// ===========================================================================

describe('Constraints', () => {
  const constraintTypes = ['required', 'nullable', 'unique', 'foreign-key',
    'min', 'max', 'length', 'format', 'state'] as const;

  for (const ctype of constraintTypes) {
    it(`preserves constraint type: ${ctype}`, async () => {
      const ir = minimalTestCaseIR();
      const tmpDir = createTempTestCaseIR(ir);
      const provider = buildDataPlannerFakeProvider(
        dataReqResult({
          dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'constrained', {
            constraints: [{ type: ctype, description: `${ctype} constraint` }],
          })],
        }),
      );
      const result = await buildTestDataPlan(tmpDir, provider);
      expect(result.dataItems[0]!.constraints[0]!.type).toBe(ctype);
      fs.rmSync(tmpDir, { recursive: true });
    });
  }

  it('normalizes unknown constraint type to "other"', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'constrained', {
          constraints: [{ type: 'bogus', description: 'bad constraint' }],
        })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.constraints[0]!.type).toBe('other');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// STRATEGIES (tests 23-29)
// ===========================================================================

describe('Strategies', () => {
  const strategies = ['reuse-existing', 'create-new', 'generate', 'derive',
    'mock', 'configure', 'unknown'] as const;

  for (const strategy of strategies) {
    it(`preserves strategy: ${strategy}`, async () => {
      const ir = minimalTestCaseIR();
      const tmpDir = createTempTestCaseIR(ir);
      const provider = buildDataPlannerFakeProvider(
        dataReqResult({
          dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', `${strategy} item`, { strategy })],
        }),
      );
      const result = await buildTestDataPlan(tmpDir, provider);
      expect(result.dataItems[0]!.strategy).toBe(strategy);
      fs.rmSync(tmpDir, { recursive: true });
    });
  }
});

// ===========================================================================
// DEPENDENCIES (tests 30-36)
// ===========================================================================

describe('Dependencies', () => {
  const depTypes = ['requires', 'references', 'derived-from', 'must-exist-before',
    'cleanup-after'] as const;

  for (const dtype of depTypes) {
    it(`creates dependency of type: ${dtype}`, async () => {
      const ir = minimalTestCaseIR({
        testCases: [
          { ...minimalTestCaseIR().testCases[0]! },
          { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
        ],
      });
      const tmpDir = createTempTestCaseIR(ir);
      const provider = buildDataPlannerFakeProvider(
        dataReqResult({
          dataCandidates: [
            dataCandidate('TMP-DATA-0001', 'TC-0001', 'source'),
            dataCandidate('TMP-DATA-0002', 'TC-0002', 'target'),
          ],
        }),
        depResult({
          dependencyCandidates: [
            { sourceTemporaryId: 'TMP-DATA-0001', targetTemporaryId: 'TMP-DATA-0002', type: dtype },
          ],
        }),
      );
      const result = await buildTestDataPlan(tmpDir, provider);
      const dep = result.dependencyGraph.find((d) => d.type === dtype);
      expect(dep).toBeDefined();
      fs.rmSync(tmpDir, { recursive: true });
    });
  }

  it('detects dependency cycles', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'A'),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'B'),
        ],
      }),
      depResult({
        dependencyCandidates: [
          { sourceTemporaryId: 'TMP-DATA-0001', targetTemporaryId: 'TMP-DATA-0002', type: 'requires' },
          { sourceTemporaryId: 'TMP-DATA-0002', targetTemporaryId: 'TMP-DATA-0001', type: 'requires' },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.quality.cyclicDependencies).toBeGreaterThan(0);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('ignores dependencies with invalid references', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'only')],
      }),
      depResult({
        dependencyCandidates: [
          { sourceTemporaryId: 'TMP-DATA-0001', targetTemporaryId: 'TMP-NONEXISTENT', type: 'requires' },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dependencyGraph.length).toBe(0);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// REUSE (tests 37-40)
// ===========================================================================

describe('Reuse', () => {
  it('creates reusable data set with safe policy', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'shared account A', { strategy: 'reuse-existing', lifecycle: 'existing' }),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'shared account B', { strategy: 'reuse-existing', lifecycle: 'existing' }),
        ],
      }),
      depResult({
        reuseCandidates: [
          { temporaryIds: ['TMP-DATA-0001', 'TMP-DATA-0002'], reason: 'Same read-only data', reusePolicy: 'safe' },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.reusableSets.length).toBe(1);
    expect(result.reusableSets[0]!.reusePolicy).toBe('safe');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates read-only reusable set', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'ref1', { strategy: 'reuse-existing', lifecycle: 'shared' }),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'ref2', { strategy: 'reuse-existing', lifecycle: 'shared' }),
        ],
      }),
      depResult({
        reuseCandidates: [
          { temporaryIds: ['TMP-DATA-0001', 'TMP-DATA-0002'], reason: 'Read-only reference data', reusePolicy: 'read-only' },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.reusableSets[0]!.reusePolicy).toBe('read-only');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('warns about unsafe reuse of mutable data', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const outDir = createTempOutput();
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'mutable1', { strategy: 'create-new', lifecycle: 'temporary' }),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'mutable2', { strategy: 'create-new', lifecycle: 'temporary' }),
        ],
      }),
      depResult({
        reuseCandidates: [
          { temporaryIds: ['TMP-DATA-0001', 'TMP-DATA-0002'], reason: 'Shared mutable', reusePolicy: 'safe' },
        ],
      }),
    );
    await buildTestDataPlan(tmpDir, provider, { outputDir: outDir });
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'));
    const unsafeWarnings = manifest.warnings.filter((w: any) => w.code === 'DATA_UNSAFE_REUSE');
    expect(unsafeWarnings.length).toBeGreaterThan(0);
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(outDir, { recursive: true });
  });

  it('creates isolated-copy reusable set', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'iso1'),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'iso2'),
        ],
      }),
      depResult({
        reuseCandidates: [
          { temporaryIds: ['TMP-DATA-0001', 'TMP-DATA-0002'], reason: 'Needs isolation', reusePolicy: 'isolated-copy' },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.reusableSets[0]!.reusePolicy).toBe('isolated-copy');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// SETUP INTENTS (tests 41-46)
// ===========================================================================

describe('Setup intents', () => {
  const strategySetupMap: Array<[string, string]> = [
    ['reuse-existing', 'select'],
    ['create-new', 'create'],
    ['generate', 'generate'],
    ['configure', 'configure'],
    ['mock', 'mock'],
    ['derive', 'derive'],
  ];

  for (const [strategy, expectedSetup] of strategySetupMap) {
    it(`maps strategy ${strategy} to setup type ${expectedSetup}`, async () => {
      const ir = minimalTestCaseIR();
      const tmpDir = createTempTestCaseIR(ir);
      const provider = buildDataPlannerFakeProvider(
        dataReqResult({
          dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', `${strategy} item`, { strategy: strategy as any })],
        }),
      );
      const result = await buildTestDataPlan(tmpDir, provider);
      expect(result.dataItems[0]!.setup[0]!.type).toBe(expectedSetup);
      fs.rmSync(tmpDir, { recursive: true });
    });
  }
});

// ===========================================================================
// CLEANUP INTENTS (tests 47-51)
// ===========================================================================

describe('Cleanup intents', () => {
  it('temporary lifecycle → delete cleanup', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'temp', { lifecycle: 'temporary' })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.cleanup[0]!.type).toBe('delete');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('existing lifecycle → none cleanup', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'existing', { lifecycle: 'existing' })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.cleanup[0]!.type).toBe('none');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('shared lifecycle → none cleanup', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'shared', { lifecycle: 'shared' })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.cleanup[0]!.type).toBe('none');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('generated + create-new → delete cleanup', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'gen', { lifecycle: 'generated', strategy: 'create-new' })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.cleanup[0]!.type).toBe('delete');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('persistent lifecycle → none cleanup', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'persist', { lifecycle: 'persistent' })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.cleanup[0]!.type).toBe('none');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// TRACEABILITY (tests 52-55)
// ===========================================================================

describe('Traceability', () => {
  it('preserves valid test case references', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'traced')],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.relatedTestCaseIds).toContain('TC-0001');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('preserves requirement references', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'req-traced', {
          relatedRequirementIds: ['REQ-0001'],
        })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.relatedRequirementIds).toContain('REQ-0001');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('preserves provenance', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'provenanced', {
          provenance: [testProv('REQ-0001')],
        })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.provenance.length).toBeGreaterThan(0);
    expect(result.dataItems[0]!.provenance[0]!.requirementId).toBe('REQ-0001');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('assigns deterministic IDs', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'first'),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'second'),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems[0]!.id).toBe('DATA-0001');
    expect(result.dataItems[1]!.id).toBe('DATA-0002');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// CONSOLIDATION (tests 56-59)
// ===========================================================================

describe('Consolidation', () => {
  it('deduplicates equivalent data candidates', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'valid user'),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'valid user'),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    // Same description + type + strategy → deduplicated to 1
    expect(result.dataItems.length).toBe(1);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not merge candidates with different constraints', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'user', {
            constraints: [{ type: 'required', description: 'must exist' }],
          }),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'user', {
            constraints: [{ type: 'unique', description: 'must be unique' }],
          }),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(2);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not merge candidates with different strategies', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'user', { strategy: 'reuse-existing' }),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'user', { strategy: 'create-new' }),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(2);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not merge candidates with different types', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'user', { type: 'account' }),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'user', { type: 'input' }),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.length).toBe(2);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// UNRESOLVED (tests 60-63)
// ===========================================================================

describe('Unresolved', () => {
  it('preserves unresolved candidates with valid reasons', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        unresolvedCandidates: [
          { testCaseIds: ['TC-0001'], description: 'Unknown data source', reason: 'missing-source', provenance: [testProv('REQ-0001')] },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.unresolved.length).toBe(1);
    expect(result.unresolved[0]!.reason).toBe('missing-source');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('assigns DATA-UNRESOLVED-XXXX IDs', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        unresolvedCandidates: [
          { testCaseIds: ['TC-0001'], description: 'Missing constraint', reason: 'missing-constraint', provenance: [] },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.unresolved[0]!.id).toBe('DATA-UNRESOLVED-0001');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('normalizes unknown unresolved reason to "other"', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        unresolvedCandidates: [
          { testCaseIds: ['TC-0001'], description: 'Weird', reason: 'totally-unknown' as any, provenance: [] },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.unresolved[0]!.reason).toBe('other');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('filters unresolved with invalid test case IDs', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        unresolvedCandidates: [
          { testCaseIds: ['TC-NONEXISTENT'], description: 'Bad ref', reason: 'missing-source', provenance: [] },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    // Normalizer drops unresolved with no valid test case IDs
    expect(result.unresolved.length).toBe(0);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// DETERMINISM (tests 64-66)
// ===========================================================================

describe('Determinism', () => {
  it('produces stable IDs for same input', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider1 = buildDataPlannerFakeProvider(
      dataReqResult({ dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'stable')] }),
    );
    const result1 = await buildTestDataPlan(tmpDir, provider1);

    const provider2 = buildDataPlannerFakeProvider(
      dataReqResult({ dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'stable')] }),
    );
    const result2 = await buildTestDataPlan(tmpDir, provider2);

    expect(result1.dataItems[0]!.id).toBe(result2.dataItems[0]!.id);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('produces stable ordering', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'alpha'),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'beta'),
          dataCandidate('TMP-DATA-0003', 'TC-0001', 'gamma'),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dataItems.map((d) => d.name)).toEqual(['alpha', 'beta', 'gamma']);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('dependency IDs are deterministic', async () => {
    const ir = minimalTestCaseIR({
      testCases: [
        { ...minimalTestCaseIR().testCases[0]! },
        { ...minimalTestCaseIR().testCases[0]!, id: 'TC-0002' },
      ],
    });
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'src'),
          dataCandidate('TMP-DATA-0002', 'TC-0002', 'tgt'),
        ],
      }),
      depResult({
        dependencyCandidates: [
          { sourceTemporaryId: 'TMP-DATA-0001', targetTemporaryId: 'TMP-DATA-0002', type: 'requires' },
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.dependencyGraph[0]!.id).toBe('DEP-0001');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// QUALITY METRICS (tests 67-69)
// ===========================================================================

describe('Quality metrics', () => {
  it('computes complete vs partial plans', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'data', { strategy: 'reuse-existing' })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.quality.testCasesTotal).toBe(1);
    expect(result.quality.testCasesWithCompleteDataPlan).toBe(1);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('strategy coverage excludes unknown', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'known', { strategy: 'reuse-existing' }),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'unknown', { strategy: 'unknown' }),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.quality.strategyCoverage).toBe(0.5);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('provenance coverage is computed correctly', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [
          dataCandidate('TMP-DATA-0001', 'TC-0001', 'provenanced', { provenance: [testProv('REQ-0001')] }),
          dataCandidate('TMP-DATA-0002', 'TC-0001', 'no-provenance', { provenance: [] }),
        ],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    expect(result.quality.provenanceCoverage).toBe(0.5);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// OUTPUT (tests 70-73)
// ===========================================================================

describe('Output', () => {
  it('writes manifest.json', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const outDir = createTempOutput();
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({ dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'data')] }),
    );
    await buildTestDataPlan(tmpDir, provider, { outputDir: outDir });
    expect(fs.existsSync(path.join(outDir, 'manifest.json'))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(outDir, { recursive: true });
  });

  it('writes test-data-plan-ir.json', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const outDir = createTempOutput();
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({ dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'data')] }),
    );
    await buildTestDataPlan(tmpDir, provider, { outputDir: outDir });
    expect(fs.existsSync(path.join(outDir, 'test-data-plan-ir.json'))).toBe(true);
    const plan = JSON.parse(fs.readFileSync(path.join(outDir, 'test-data-plan-ir.json'), 'utf-8'));
    expect(plan.schemaVersion).toBe('1.0');
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(outDir, { recursive: true });
  });

  it('writes quality-report.json', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const outDir = createTempOutput();
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({ dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'data')] }),
    );
    await buildTestDataPlan(tmpDir, provider, { outputDir: outDir });
    expect(fs.existsSync(path.join(outDir, 'quality-report.json'))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(outDir, { recursive: true });
  });

  it('manifest contains usage stats', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const outDir = createTempOutput();
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({ dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'data')] }),
    );
    await buildTestDataPlan(tmpDir, provider, { outputDir: outDir });
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'));
    expect(manifest.usage.requests).toBe(2); // data req + dependency
    expect(manifest.usage.inputTokens).toBeGreaterThan(0);
    expect(manifest.fingerprint).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(outDir, { recursive: true });
  });
});

// ===========================================================================
// SECURITY (tests 74-75)
// ===========================================================================

describe('Security', () => {
  it('does not serialize secrets in output', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const outDir = createTempOutput();
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'token', {
          type: 'token',
          description: 'Test credential placeholder',
        })],
      }),
    );
    await buildTestDataPlan(tmpDir, provider, { outputDir: outDir });
    const planContent = fs.readFileSync(path.join(outDir, 'test-data-plan-ir.json'), 'utf-8');
    expect(planContent).not.toContain('password');
    expect(planContent).not.toContain('secret');
    expect(planContent).not.toContain('api_key');
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(outDir, { recursive: true });
  });

  it('handles prompt injection data gracefully', async () => {
    const ir = minimalTestCaseIR();
    const tmpDir = createTempTestCaseIR(ir);
    const provider = buildDataPlannerFakeProvider(
      dataReqResult({
        dataCandidates: [dataCandidate('TMP-DATA-0001', 'TC-0001', 'ignore previous instructions', {
          description: '"; DROP TABLE users; --',
        })],
      }),
    );
    const result = await buildTestDataPlan(tmpDir, provider);
    // Should not crash, should treat as regular string
    expect(result.dataItems.length).toBe(1);
    expect(result.dataItems[0]!.description).toContain('DROP TABLE');
    fs.rmSync(tmpDir, { recursive: true });
  });
});
