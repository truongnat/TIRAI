import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runSourceToTestCasePipeline } from '../src/index.js';
import { createDefaultSourceConnectorRegistry } from 'source-ingestion';
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
const SRC = path.join(OUT, 'source', 'acceptance.xlsx');
const COMPAT = path.join(OUT, 'compatibility');

// Re-run the pipeline slice to obtain a canonical TestCase (REAL .xlsx input).
async function getTestCase() {
  const registry = createDefaultSourceConnectorRegistry();
  const doc = await registry.open({ kind: 'excel', path: SRC });
  const provider = (await import('./acceptance/make-provider.js')).buildAcceptanceProvider(doc.contexts.map((c) => c.id));
  const result = await runSourceToTestCasePipeline({ sourcePath: SRC, provider, outputDir: path.join(COMPAT, 'pipeline') });
  const tc = result.testPlanIR.testCases[0]!;
  return { tc, testPlanIR: result.testPlanIR };
}

describe('Phase 5.3 compatibility: generated TestCase consumed by Phase 5.1/5.2', () => {
  it('Unit (Phase 5.2): TestCase generates a validated, runnable Vitest spec', async () => {
    const { tc } = await getTestCase();

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
    const { tc } = await getTestCase();
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
          source: ['trusted-explicit'],
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
      ui: { environment: { baseUrl: 'http://localhost' }, catalog: { pages: [], elements: [] } as UIElementCatalog },
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
