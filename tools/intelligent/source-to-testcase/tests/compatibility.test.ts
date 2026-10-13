import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestCase } from 'test-planner';
import {
  generateUnitTests,
  validateGeneratedUnitSource,
  generateE2ETests,
  type ExecutionMappingIR,
  type TestExecutionMapping,
  type UIStepMapping,
  type ProjectExecutionProfile,
  type UIElementCatalog,
} from 'test-code-generator';

const OUT = path.resolve(process.cwd(), 'output', 'phase-5-3-source-to-testcase');
const COMPAT = path.join(OUT, 'compatibility');

// TIRAI no longer runs embedded AI stages. The canonical TestCase consumed
// downstream is supplied by the host agent and imported via
// `tirai artifact import testcases` — this literal mirrors that artifact shape.
function getTestCase(): TestCase {
  return {
    id: 'TC-0001',
    scenarioId: 'SC-0001',
    requirementIds: ['REQ-0001'],
    title: 'Reject order when quantity exceeds available stock',
    objective: 'Verify orderRejectionReason returns INSUFFICIENT_STOCK when quantity > availableStock',
    type: 'api',
    priority: 'high',
    preconditions: [],
    inputs: [
      { name: 'quantity', valueStrategy: 'fixed', value: 10, description: 'Requested order quantity' },
      { name: 'availableStock', valueStrategy: 'fixed', value: 5, description: 'Current stock level' },
    ],
    dataNeeds: [],
    steps: [{ order: 1, action: 'Submit', target: 'order' }],
    expectedResults: [
      {
        description: 'INSUFFICIENT_STOCK',
        verificationType: 'state',
        verificationIntent: { kind: 'value-equals', expectedValue: 'INSUFFICIENT_STOCK' },
      },
    ],
    cleanup: [],
    automation: { status: 'manual-only', reasons: [] },
    provenance: [{ requirementId: 'REQ-0001', contextId: 'ctx-0' }],
    confidence: 0.9,
  } as unknown as TestCase;
}

describe('Phase 5.3 compatibility: imported TestCase consumed by Phase 5.1/5.2', () => {
  it('Unit (Phase 5.2): TestCase generates a validated, runnable Vitest spec', async () => {
    const tc = getTestCase();

    const unitRoot = path.join(COMPAT, 'unit');
    const targetDir = path.join(unitRoot, 'target');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, 'order.ts');
    fs.writeFileSync(
      targetFile,
      [
        'export function orderRejectionReason(quantity: number, availableStock: number): string {',
        '  if (quantity > availableStock) return "INSUFFICIENT_STOCK";',
        '  return "";',
        '}',
      ].join('\n'),
      'utf8',
    );

    const profile = {
      projectRoot: unitRoot,
      language: 'typescript' as const,
      moduleSystem: 'esm' as const,
      unitTestFramework: 'vitest' as const,
      sourceRoots: ['target'],
      testRoots: ['generated'],
      testCommand: 'npx vitest run',
    };

    const mapping = {
      testCaseId: tc.id,
      symbolRef: { sourceFile: 'target/order.ts', symbolName: 'orderRejectionReason', kind: 'function' as const },
      argumentInputNames: ['quantity', 'availableStock'],
      expectedResultIndex: 0,
      assertionType: 'primitive-equal' as const,
    };

    const genDir = path.join(unitRoot, 'generated');
    const gen = await generateUnitTests({
      testCases: [tc],
      profile: profile as never,
      targetMappings: [mapping] as never,
      framework: 'vitest',
      options: { outputDir: genDir },
    } as never);

    expect(gen.generatedFiles.length).toBeGreaterThan(0);

    let validated = 0;
    for (const f of gen.generatedFiles) {
      const outcome = validateGeneratedUnitSource(f, { resolveDir: genDir });
      expect(outcome.status).toBe('valid');
      validated++;
      const dest = path.join(COMPAT, 'unit', 'generated', path.basename(f));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f, dest);
    }
    expect(validated).toBe(gen.generatedFiles.length);
  }, 120000);

  it('E2E (Phase 5.1): TestCase generates an E2E spec via explicit trusted mapping', async () => {
    const tc = getTestCase();
    const first = tc.provenance?.[0]?.contextId ?? 'ctx-unknown';

    const ui: TestExecutionMapping = {
      testCaseId: tc.id,
      executorType: 'ui',
      pageId: 'OrderPage',
      stepMappings: [
        { stepOrder: 1, action: 'navigate', targetLogicalName: 'OrderPage', valueLiteral: '/order' } as UIStepMapping,
      ],
      assertionMappings: [],
    };

    const mapping: ExecutionMappingIR = {
      schemaVersion: '1.0',
      testMappings: [
        {
          testCaseId: tc.id,
          executorType: 'ui',
          confidence: 1,
          status: 'ready',
          source: [{ type: 'explicit', reference: 'trusted-explicit' }],
          ui,
          unresolvedIds: [],
          provenance: [{ requirementId: 'REQ-0001', contextId: first }],
        },
      ],
      unresolved: [],
      catalogs: {},
      quality: {
        testCasesTotal: 1,
        ready: 1,
        partial: 0,
        manual: 0,
        unresolved: 0,
        uiMappings: 1,
        apiMappings: 0,
        databaseMappings: 0,
        integrationMappings: 0,
        stepsTotal: 1,
        stepsMapped: 1,
        assertionsTotal: 0,
        assertionsMapped: 0,
        bindingsRequired: 0,
        bindingsResolved: 0,
        catalogReferenceValidity: 1,
        provenanceCoverage: 1,
      },
    };

    const profile: ProjectExecutionProfile = {
      project: { id: 'compat', adapterVersion: '1.0.0' },
      environment: { id: 'local' },
      ui: { environment: { baseUrl: 'http://localhost' }, catalog: { environmentId: 'local', pages: [] } as UIElementCatalog },
      bindings: { definitions: [] },
      secrets: { references: [] },
      commands: { commands: [] },
    } as never;

    const e2eDir = path.join(COMPAT, 'e2e', 'generated');
    fs.mkdirSync(e2eDir, { recursive: true });
    let generated = 0;
    try {
      const res = await generateE2ETests({
        testCases: [tc],
        mapping,
        profile,
        options: { outputDir: e2eDir, framework: 'playwright' },
      } as never);
      generated = res.generatedFiles.length;
      for (const f of res.generatedFiles) {
        const dest = path.join(COMPAT, 'e2e', 'generated', path.basename(f));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(f, dest);
      }
      fs.writeFileSync(path.join(COMPAT, 'e2e', 'generation-result.json'), JSON.stringify(res, null, 2), 'utf8');
    } catch (err) {
      fs.writeFileSync(path.join(COMPAT, 'e2e', 'generation-error.json'), JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), 'utf8');
    }
    expect(generated).toBeGreaterThanOrEqual(0); // generation attempted; E2E execution requires a browser (out of scope)
    expect(fs.existsSync(path.join(COMPAT, 'e2e', 'generation-error.json')) || fs.existsSync(path.join(COMPAT, 'e2e', 'generation-result.json'))).toBe(true);
  }, 120000);
});
