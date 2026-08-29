// Phase 5.2 acceptance harness (spec §3, §4, §38–§50).
//
// Exercises the full unit-test generation vertical slice:
//   canonical TestCase + UnitTargetCodeMapping + TargetProjectProfile
//     -> inspectTargetProject (trusted AST)
//     -> generateUnitTests (Vitest *.spec.ts)
//     -> validate
//     -> executeUnitTests (Vitest CLI)
//     -> canonical TestRunResultIR
//     -> run-result-ir.json + summary.md
//
// Hard invariants asserted:
//   generationAiCalls=0, executionAiCalls=0, aiSymbolGuesses=0, agenticFallbacks=0,
//   secretLeakCount=0, sourceSpecificBranchesInUnitGenerator=0,
//   vitestSpecificFieldsAddedToCanonicalTestCase=0 (canonical TestCase untouched).

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import {
  generateUnitTests,
  executeUnitTests,
  validateGeneratedUnitSource,
  writeRunResultJson,
  writeSummary,
  countSecretLeaks,
  type TargetProjectProfile,
  type UnitTargetCodeMapping,
} from '../src/index.js';
import type { TestCase, TestInput, ExpectedResult } from '../src/re-export.js';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(pkgRoot, 'output', 'phase-5-2-unit-test-generation');
const generatedDir = join(outDir, 'generated');
const execConfigPath = join(pkgRoot, 'vitest.exec.config.ts');

function inp(name: string, value: unknown): TestInput {
  return { name, valueStrategy: 'fixed', value };
}

function exp(value?: string | number | boolean): ExpectedResult {
  return {
    description: 'expected',
    verificationType: 'state',
    verificationIntent:
      value === undefined ? {} : { expectedValue: value },
  };
}

function mkTc(
  id: string,
  title: string,
  inputs: TestInput[],
  expectedResults: ExpectedResult[],
): TestCase {
  return {
    id,
    scenarioId: 'SC-1',
    requirementIds: ['R-1'],
    title,
    objective: title,
    type: 'integration',
    priority: 'high',
    preconditions: [],
    inputs,
    dataNeeds: [],
    steps: [],
    expectedResults,
    cleanup: [],
    automation: { status: 'ready', reasons: [] },
    provenance: [],
    confidence: 1,
  };
}

const profile: TargetProjectProfile = {
  projectRoot: pkgRoot,
  language: 'typescript',
  moduleSystem: 'esm',
  unitTestFramework: 'vitest',
  sourceRoots: ['fixtures/unit'],
  testRoots: ['tests'],
  testCommand: 'npx vitest run',
  tsconfigPath: join(pkgRoot, 'tsconfig.json'),
};

const testCases: TestCase[] = [
  // PASS cases
  mkTc('TC-PASS-1', 'add adds two numbers', [inp('a', 2), inp('b', 3)], [exp(5)]),
  mkTc('TC-PASS-2', 'partition splits even and odd', [inp('numbers', [1, 2, 3, 4])], [
    exp({ even: [2, 4], odd: [1, 3] }),
  ]),
  mkTc('TC-PASS-3', 'asyncAdd adds asynchronously', [inp('a', 2), inp('b', 3)], [exp(5)]),
  mkTc('TC-PASS-4', 'OrderService.total sums items', [inp('items', [1, 2, 3])], [exp(6)]),
  // FAIL (business assertion)
  mkTc('TC-FAIL-1', 'multiply is wrong on purpose', [inp('a', 2), inp('b', 3)], [exp(7)]),
  // ERROR (infrastructure-style throw)
  mkTc('TC-ERROR-1', 'boom throws an infra error', [], [exp(0)]),
  // BLOCKED cases
  mkTc('TC-BLOCK-MISSING', 'no mapping provided', [inp('a', 1)], [exp(1)]),
  mkTc('TC-BLOCK-AMBIGUOUS', 'clash is ambiguous', [], [exp(1)]),
  mkTc('TC-BLOCK-NOTFOUND', 'symbol does not exist', [], [exp(1)]),
  mkTc('TC-BLOCK-UNRESOLVED-INPUT', 'extra input bound', [inp('a', 1), inp('b', 2)], [exp(3)]),
  mkTc('TC-BLOCK-STALE', 'stale fingerprint', [inp('a', 1), inp('b', 2)], [exp(3)]),
  mkTc('TC-BLOCK-UNSUPPORTED-ASSERTION', 'missing expected value', [inp('a', 1), inp('b', 2)], [
    exp(undefined),
  ]),
];

describe('Phase 5.2 — Unit Test Generation vertical slice', () => {
  it('generates, validates, executes, and exports canonical artifacts', async () => {
    mkdirSync(generatedDir, { recursive: true });

    const targetMappings: UnitTargetCodeMapping[] = [
      {
        testCaseId: 'TC-PASS-1',
        symbolRef: { sourceFile: 'fixtures/unit/add.ts', symbolName: 'add', kind: 'function' },
        argumentInputNames: ['a', 'b'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-PASS-2',
        symbolRef: {
          sourceFile: 'fixtures/unit/partition.ts',
          symbolName: 'partition',
          kind: 'function',
        },
        argumentInputNames: ['numbers'],
        expectedResultIndex: 0,
        assertionType: 'deep-equal',
      },
      {
        testCaseId: 'TC-PASS-3',
        symbolRef: {
          sourceFile: 'fixtures/unit/asyncAdd.ts',
          symbolName: 'asyncAdd',
          kind: 'function',
        },
        argumentInputNames: ['a', 'b'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-PASS-4',
        symbolRef: {
          sourceFile: 'fixtures/unit/orderService.ts',
          symbolName: 'OrderService.total',
          kind: 'method',
        },
        argumentInputNames: ['items'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-FAIL-1',
        symbolRef: {
          sourceFile: 'fixtures/unit/multiply.ts',
          symbolName: 'multiply',
          kind: 'function',
        },
        argumentInputNames: ['a', 'b'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-ERROR-1',
        symbolRef: { sourceFile: 'fixtures/unit/boom.ts', symbolName: 'boom', kind: 'function' },
        argumentInputNames: [],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-BLOCK-AMBIGUOUS',
        symbolRef: { symbolName: 'clash', kind: 'function' },
        argumentInputNames: [],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-BLOCK-NOTFOUND',
        symbolRef: { symbolName: 'doesNotExist', kind: 'function' },
        argumentInputNames: [],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-BLOCK-UNRESOLVED-INPUT',
        symbolRef: { sourceFile: 'fixtures/unit/add.ts', symbolName: 'add', kind: 'function' },
        argumentInputNames: ['a', 'missing'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
      {
        testCaseId: 'TC-BLOCK-STALE',
        symbolRef: { sourceFile: 'fixtures/unit/add.ts', symbolName: 'add', kind: 'function' },
        argumentInputNames: ['a', 'b'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
        targetFingerprint: 'deadbeef',
      },
      {
        testCaseId: 'TC-BLOCK-UNSUPPORTED-ASSERTION',
        symbolRef: { sourceFile: 'fixtures/unit/add.ts', symbolName: 'add', kind: 'function' },
        argumentInputNames: ['a', 'b'],
        expectedResultIndex: 0,
        assertionType: 'primitive-equal',
      },
    ];

    // ---- Persist inputs (deliverables, spec §23) ----
    writeFileSync(join(outDir, 'testcase-input.json'), JSON.stringify(testCases, null, 2), 'utf8');
    writeFileSync(
      join(outDir, 'target-project-profile.json'),
      JSON.stringify(profile, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'target-code-mapping.json'),
      JSON.stringify(targetMappings, null, 2),
      'utf8',
    );

    // ---- GATE: deterministic, AI-free generation ----
    const genResult = await generateUnitTests({
      testCases,
      profile,
      targetMappings,
      framework: 'vitest',
      options: { outputDir: generatedDir },
    });

    expect(genResult.framework).toBe('vitest');
    const gm = genResult.metrics;
    expect(gm.generationAiCalls).toBe(0);
    expect(gm.aiSymbolGuesses).toBe(0);
    expect(gm.guessedMappings).toBe(0);
    expect(gm.sourceSpecificBranchesInUnitGenerator).toBe(0);
    expect(gm.unsupportedAssertions).toBe(1); // TC-BLOCK-UNSUPPORTED-ASSERTION
    expect(gm.targetSymbolsMissing).toBe(1);
    expect(gm.targetSymbolsAmbiguous).toBe(1);
    expect(gm.staleMappingsDetected).toBe(1);
    expect(gm.inputMappingsBlocked).toBe(1); // only TC-BLOCK-UNRESOLVED-INPUT
    expect(gm.testCasesGenerated).toBe(6); // 4 pass + fail + error
    expect(gm.testCasesBlocked).toBe(6); // missing, ambiguous, notfound, unresolved-input, stale, unsupported-assertion

    const statusById = new Map(genResult.caseResults.map((c) => [c.testCaseId, c.status]));
    expect(statusById.get('TC-PASS-1')).toBe('generated');
    expect(statusById.get('TC-PASS-4')).toBe('generated');
    expect(statusById.get('TC-FAIL-1')).toBe('generated');
    expect(statusById.get('TC-ERROR-1')).toBe('generated');
    expect(statusById.get('TC-BLOCK-MISSING')).toBe('blocked');
    expect(statusById.get('TC-BLOCK-AMBIGUOUS')).toBe('blocked');
    expect(statusById.get('TC-BLOCK-NOTFOUND')).toBe('blocked');
    expect(statusById.get('TC-BLOCK-UNRESOLVED-INPUT')).toBe('blocked');
    expect(statusById.get('TC-BLOCK-STALE')).toBe('blocked');
    expect(statusById.get('TC-BLOCK-UNSUPPORTED-ASSERTION')).toBe('blocked');

    // ---- GATE: validation of generated source ----
    for (const f of genResult.generatedFiles) {
      const v = validateGeneratedUnitSource(f, { resolveDir: generatedDir });
      expect(v.status).toBe('valid');
    }

    // ---- GATE: secret-leak scan ----
    const generatedContents = genResult.generatedFiles.map((f) => readFileSync(f, 'utf8'));
    expect(countSecretLeaks(generatedContents, 'sk-')).toBe(0);
    expect(countSecretLeaks(generatedContents, 'TIRAI_SECRET')).toBe(0);

    // ---- GATE: canonical TestCase is untouched (Vitest-neutral) ----
    for (const tc of testCases) {
      expect((tc as Record<string, unknown>).vitest).toBeUndefined();
    }

    // ---- Execution ----
    const execResult = await executeUnitTests({
      generationResult: genResult,
      testCases,
      resolveDir: generatedDir,
      vitestConfigPath: execConfigPath,
      jsonOutputPath: join(outDir, 'vitest-report.json'),
    });

    expect(execResult.framework).toBe('vitest');
    expect(execResult.executionMode).toBe('GENERATED_UNIT');
    const em = execResult.metrics;
    expect(em.executionAiCalls).toBe(0);
    expect(em.agenticFallbacks).toBe(0);
    expect(em.aiSymbolGuesses).toBe(0);
    expect(em.validationFailed).toBe(0);

    const byId = new Map(execResult.result.testResults.map((t) => [t.testCaseId, t.status]));
    expect(byId.get('TC-PASS-1')).toBe('passed');
    expect(byId.get('TC-PASS-2')).toBe('passed');
    expect(byId.get('TC-PASS-3')).toBe('passed');
    expect(byId.get('TC-PASS-4')).toBe('passed');
    expect(byId.get('TC-FAIL-1')).toBe('failed'); // business assertion failure
    expect(byId.get('TC-ERROR-1')).toBe('error'); // infra-style throw
    expect(byId.get('TC-BLOCK-MISSING')).toBe('blocked');
    expect(byId.get('TC-BLOCK-AMBIGUOUS')).toBe('blocked');
    expect(byId.get('TC-BLOCK-NOTFOUND')).toBe('blocked');
    expect(byId.get('TC-BLOCK-UNRESOLVED-INPUT')).toBe('blocked');
    expect(byId.get('TC-BLOCK-STALE')).toBe('blocked');
    expect(byId.get('TC-BLOCK-UNSUPPORTED-ASSERTION')).toBe('blocked');

    // ---- GATE: round-trip integrity ----
    const serialized = JSON.stringify(execResult.result);
    const reparsed = JSON.parse(serialized);
    expect(reparsed.schemaVersion).toBe('1.0');
    expect(reparsed.summary.testsTotal).toBe(12);

    // ---- Persist deliverables ----
    writeRunResultJson(join(outDir, 'run-result-ir.json'), execResult.result);
    writeSummary(join(outDir, 'summary.md'), execResult.result, {
      framework: 'vitest',
      executionMode: 'GENERATED_UNIT',
      generationStatus: genResult.status,
      testCasesReceived: gm.testCasesReceived,
      testCasesGenerated: gm.testCasesGenerated,
      testCasesBlocked: gm.testCasesBlocked,
      generatedFiles: genResult.generatedFiles,
    });

    expect(existsSync(join(outDir, 'run-result-ir.json'))).toBe(true);
    expect(existsSync(join(outDir, 'summary.md'))).toBe(true);

    // ---- GATE: determinism (re-generate to a separate dir, compare) ----
    const regenDir = join(outDir, 'generated-regen');
    mkdirSync(regenDir, { recursive: true });
    const regen = await generateUnitTests({
      testCases,
      profile,
      targetMappings,
      framework: 'vitest',
      options: { outputDir: regenDir },
    });
    for (const f of regen.generatedFiles) {
      const base = f.split(/[\\/]/).pop()!;
      const original = readFileSync(join(generatedDir, base), 'utf8');
      const again = readFileSync(f, 'utf8');
      expect(again).toBe(original);
    }

    // sanity: something was actually generated
    expect(genResult.generatedFiles.length).toBeGreaterThan(0);
  });
});
