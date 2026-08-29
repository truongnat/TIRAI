// Unit tests for Phase 5.1 generator internals (spec §44).
// These do NOT spawn Playwright; they verify determinism, trusted mapping,
// fail-closed blocking, secret safety, and result round-trip.

import { describe, test, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  locatorExpression,
  generateE2ETests,
  validateGeneratedSource,
  classifyFailure,
  mapPlaywrightJsonToRunResult,
  countSecretLeaks,
  type TestCodeGenerationInput,
  type PlaywrightJsonReport,
  type TestCase,
  type ExecutionMappingIR,
  type ProjectExecutionProfile,
  type UIElementCatalog,
} from '../src/index.js';

const CATALOG: UIElementCatalog = {
  environmentId: 'fixture',
  pages: [
    {
      id: 'home',
      route: '/',
      elements: [
        { logicalName: 'email', locator: { strategy: 'test-id', value: 'email' } },
        { logicalName: 'password', locator: { strategy: 'test-id', value: 'password' }, sensitive: true },
        { logicalName: 'submit', locator: { strategy: 'role', value: 'button', role: 'Sign in' } },
        { logicalName: 'welcome', locator: { strategy: 'test-id', value: 'welcome' } },
      ],
    },
  ],
};

function profile(): ProjectExecutionProfile {
  return {
    schemaVersion: '1.0',
    project: { id: 'p', name: 'p', root: '/', adapterId: 'a', adapterVersion: '1' },
    environment: { id: 'local', name: 'local', safety: 'isolated', baseUrl: 'http://localhost:4173' },
    ui: { environment: { baseUrl: 'http://localhost:4173' }, catalog: CATALOG },
    bindings: { definitions: [] },
    secrets: { references: [] },
    commands: { commands: [] },
    capabilities: {
      ui: true, api: false, database: false, multiTenant: false, localStart: true,
      testDataMutation: false, browserExecution: true, apiExecution: false, databaseExecution: false,
    },
    provenance: [],
    fingerprint: 'fp',
  } as unknown as ProjectExecutionProfile;
}

function uiMapping(testCaseId: string, steps: any[], assertions: any[], status: any = 'ready') {
  return {
    schemaVersion: '1.0',
    testMappings: [
      {
        testCaseId,
        executorType: 'ui',
        confidence: 1,
        status,
        source: [{ type: 'code-derived', reference: 'det' }],
        ui: { testCaseId, executorType: 'ui', stepMappings: steps, assertionMappings: assertions },
        unresolvedIds: [],
        provenance: [],
      },
    ],
    unresolved: [],
    catalogs: { uiCatalog: CATALOG },
    quality: {} as any,
  } as unknown as ExecutionMappingIR;
}

function tc(id: string, steps: any[], assertions: any[] = []): TestCase {
  return {
    id, scenarioId: 's', requirementIds: ['r'], title: id, objective: '', type: 'ui',
    priority: 'high', preconditions: [], inputs: [], dataNeeds: [], steps, expectedResults: assertions,
    cleanup: [], automation: { status: 'ready', reasons: [] }, provenance: [], confidence: 1,
  } as unknown as TestCase;
}

describe('locator expression builder', () => {
  test('maps every trusted strategy to Playwright source', () => {
    expect(locatorExpression({ strategy: 'test-id', value: 'email' })).toBe('page.getByTestId("email")');
    expect(locatorExpression({ strategy: 'label', value: 'Email' })).toBe('page.getByLabel("Email")');
    expect(locatorExpression({ strategy: 'css', value: '.btn' })).toBe('page.locator(".btn")');
    expect(locatorExpression({ strategy: 'xpath', value: '//div' })).toBe('page.locator(`xpath=//div`)');
    expect(locatorExpression({ strategy: 'role', value: 'button', role: 'Sign in' }))
      .toBe('page.getByRole("button", { name: "Sign in" })');
    expect(locatorExpression({ strategy: 'role', value: 'button', role: 'Sign in', exact: true }))
      .toBe('page.getByRole("button", { exact: true, name: "Sign in" })');
  });
});

describe('deterministic generation', () => {
  test('same inputs -> byte-identical source + identical fingerprints', async () => {
    const tc1 = tc('TC-A', [{ order: 1, action: 'navigate', target: 'home' }, { order: 2, action: 'fill', target: 'email', input: 'a@b.com' }, { order: 3, action: 'click', target: 'submit' }], [{ description: 'welcome visible', verificationType: 'ui', target: 'welcome', verificationIntent: { kind: 'visible-ui-state' } }]);
    const mapping = uiMapping('TC-A',
      [{ stepOrder: 1, action: 'navigate', targetLogicalName: 'home' }, { stepOrder: 2, action: 'fill', targetLogicalName: 'email' }, { stepOrder: 3, action: 'click', targetLogicalName: 'submit' }],
      [{ expectedResultIndex: 0, assertionType: 'visible', targetLogicalName: 'welcome' }]);
    const opts = { outputDir: join(process.cwd(), 'tests', '.tmp-unit'), baseUrl: 'http://localhost:4173' };
    const input: TestCodeGenerationInput = { testCases: [tc1], mapping, profile: profile(), options: opts };
    const a = await generateE2ETests(input);
    const b = await generateE2ETests(input);
    expect(a.caseResults[0].status).toBe('generated');
    expect(a.caseResults[0].sourceFingerprint).toBe(b.caseResults[0].sourceFingerprint);
    expect(a.caseResults[0].generationFingerprint).toBe(b.caseResults[0].generationFingerprint);
    const s1 = readFileSync(a.caseResults[0].generatedFilePath!, 'utf8');
    const s2 = readFileSync(b.caseResults[0].generatedFilePath!, 'utf8');
    expect(s1).toBe(s2);
    expect(a.metrics.generationAiCalls).toBe(0);
    expect(a.metrics.guessedMappings).toBe(0);
    rmSync(opts.outputDir, { recursive: true, force: true });
  });
});

describe('fail-closed blocking', () => {
  test('missing trusted locator -> MISSING_LOCATOR (no guessed selector)', async () => {
    const tc1 = tc('TC-B', [{ order: 1, action: 'navigate', target: 'home' }, { order: 2, action: 'fill', target: 'ghost', input: 'x' }], []);
    const mapping = uiMapping('TC-B',
      [{ stepOrder: 1, action: 'navigate', targetLogicalName: 'home' }],
      [], 'partial');
    (mapping.unresolved as any).push({ id: 'u', testCaseId: 'TC-B', stage: 'target', description: 'missing', reason: 'missing-catalog-entry', provenance: [] });
    const input: TestCodeGenerationInput = { testCases: [tc1], mapping, profile: profile(), options: { outputDir: join(process.cwd(), 'tests', '.tmp-b'), baseUrl: 'http://x' } };
    const r = await generateE2ETests(input);
    expect(r.caseResults[0].status).toBe('blocked');
    expect(r.caseResults[0].blockingReason?.code).toBe('MISSING_LOCATOR');
    expect(r.caseResults[0].generatedFilePath).toBeUndefined();
    rmSync(join(process.cwd(), 'tests', '.tmp-b'), { recursive: true, force: true });
  });

  test('unsupported action -> UNSUPPORTED_ACTION', async () => {
    const tc1 = tc('TC-C', [{ order: 1, action: 'navigate', target: 'home' }, { order: 2, action: 'scroll', target: 'email' }], []);
    const mapping = uiMapping('TC-C',
      [{ stepOrder: 1, action: 'navigate', targetLogicalName: 'home' }, { stepOrder: 2, action: 'scroll', targetLogicalName: 'email' }],
      []);
    const input: TestCodeGenerationInput = { testCases: [tc1], mapping, profile: profile(), options: { outputDir: join(process.cwd(), 'tests', '.tmp-c'), baseUrl: 'http://x' } };
    const r = await generateE2ETests(input);
    expect(r.caseResults[0].status).toBe('blocked');
    expect(r.caseResults[0].blockingReason?.code).toBe('UNSUPPORTED_ACTION');
    rmSync(join(process.cwd(), 'tests', '.tmp-c'), { recursive: true, force: true });
  });

  test('unmappable assertion (no expected value) -> UNMAPPABLE_ASSERTION', async () => {
    const tc1 = tc('TC-D', [{ order: 1, action: 'navigate', target: 'home' }, { order: 2, action: 'click', target: 'submit' }], [{ description: 'text equals', verificationType: 'ui', target: 'welcome', verificationIntent: { kind: 'text-equals' } }]);
    const mapping = uiMapping('TC-D',
      [{ stepOrder: 1, action: 'navigate', targetLogicalName: 'home' }, { stepOrder: 2, action: 'click', targetLogicalName: 'submit' }],
      [{ expectedResultIndex: 0, assertionType: 'text-equals', targetLogicalName: 'welcome' }]);
    const input: TestCodeGenerationInput = { testCases: [tc1], mapping, profile: profile(), options: { outputDir: join(process.cwd(), 'tests', '.tmp-d'), baseUrl: 'http://x' } };
    const r = await generateE2ETests(input);
    expect(r.caseResults[0].status).toBe('blocked');
    expect(r.caseResults[0].blockingReason?.code).toBe('UNMAPPABLE_ASSERTION');
    rmSync(join(process.cwd(), 'tests', '.tmp-d'), { recursive: true, force: true });
  });
});

describe('secret safety', () => {
  test('sensitive element -> env ref, never raw literal', async () => {
    const sentinel = 'supersecret';
    const tc1 = tc('TC-E', [{ order: 1, action: 'fill', target: 'password', input: sentinel }], []);
    const mapping = uiMapping('TC-E', [{ stepOrder: 1, action: 'fill', targetLogicalName: 'password' }], []);
    const dir = join(process.cwd(), 'tests', '.tmp-e');
    const input: TestCodeGenerationInput = { testCases: [tc1], mapping, profile: profile(), options: { outputDir: dir, baseUrl: 'http://x' } };
    const r = await generateE2ETests(input);
    const src = readFileSync(r.caseResults[0].generatedFilePath!, 'utf8');
    expect(src).toContain('process.env[');
    expect(src).not.toContain(sentinel);
    expect(countSecretLeaks([src], sentinel)).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('static validation', () => {
  test('invalid generated source is rejected before execution', async () => {
    const dir = join(process.cwd(), 'tests', '.tmp-val');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'broken.spec.ts');
    writeFileSync(p, 'import { test } from "@playwright/test";\ntest( => {', 'utf8');
    const out = await validateGeneratedSource(p);
    expect(out.status).toBe('invalid');
    expect(out.parseOk).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('result classification + round-trip', () => {
  test('infra error vs business failure', () => {
    expect(classifyFailure([{ message: 'net::ERR_CONNECTION_REFUSED' }])).toBe('error');
    expect(classifyFailure([{ message: 'page.goto: Timeout 30000ms exceeded' }])).toBe('error');
    expect(classifyFailure([{ message: 'Error: expect(locator).toHaveText' }])).toBe('failed');
  });

  test('Playwright JSON -> TestRunResultIR -> JSON equivalence', () => {
    const report: PlaywrightJsonReport = {
      config: { configFile: '/x/playwright.config.ts' },
      startTime: '2026-01-01T00:00:00.000Z',
      duration: 1234,
      suites: [
        {
          specs: [
            { title: 'Login shows welcome banner', tests: [{ title: 'Login shows welcome banner', status: 'passed', duration: 500 }] },
            { title: 'Login assertion fails', tests: [{ title: 'Login assertion fails', status: 'failed', duration: 300, errors: [{ message: 'Error: expect(locator).toHaveText' }] }] },
          ],
        },
      ],
    };
    const mapped = mapPlaywrightJsonToRunResult(report, {
      runId: 'run-1',
      framework: 'playwright',
      executionMode: 'GENERATED_E2E',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.234Z',
      testCases: [{ id: 'TC-PASS', scenarioId: 's', requirementIds: ['r'], title: 'Login shows welcome banner', objective: '', type: 'ui', priority: 'high', preconditions: [], inputs: [], dataNeeds: [], steps: [], expectedResults: [], cleanup: [], automation: { status: 'ready', reasons: [] }, provenance: [], confidence: 1 }] as any,
      mapping: {} as any,
      titleToTestCaseId: new Map([['Login shows welcome banner', 'TC-PASS']]),
    });
    expect(mapped.passed).toBe(1);
    expect(mapped.failed).toBe(1);
    const json = JSON.stringify(mapped.result);
    const back = JSON.parse(json) as typeof mapped.result;
    expect(back.testResults.length).toBe(2);
    expect(back.summary).toEqual(mapped.result.summary);
  });
});
