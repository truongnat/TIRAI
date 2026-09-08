import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateUnitTests } from '../src/index.js';
import type { TestCase, TargetProjectProfile } from '../src/index.js';

function tc(id: string, title: string, inputs: Array<{ name: string; value: unknown }>, expected: unknown): TestCase {
  return {
    id,
    scenarioId: 'SC-1',
    requirementIds: ['R-1'],
    title,
    objective: title,
    type: 'integration',
    priority: 'high',
    preconditions: [],
    inputs: inputs.map((i) => ({ name: i.name, valueStrategy: 'fixed' as const, value: i.value })),
    dataNeeds: [],
    steps: [],
    expectedResults: [
      {
        description: 'expected',
        verificationType: 'state',
        verificationIntent: { kind: 'value-equals', expectedValue: expected as string | number | boolean },
      },
    ],
    cleanup: [],
    automation: { status: 'ready', reasons: [] },
    provenance: [],
    confidence: 1,
  };
}

describe('spec preview generation (NOT A TEST)', () => {
  it('generates a preview artifact from TestCase JSON without mappings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tirai-spec-preview-'));
    const generatedDir = join(dir, 'generated');
    mkdirSync(generatedDir, { recursive: true });
    try {
      const testCases = [
        tc('TC-0001', 'reject overstock', [{ name: 'quantity', value: 10 }, { name: 'availableStock', value: 5 }], 'INSUFFICIENT_STOCK'),
      ];
      const profile: TargetProjectProfile = {
        projectRoot: dir,
        language: 'typescript',
        moduleSystem: 'esm',
        unitTestFramework: 'vitest',
        sourceRoots: ['.'],
        testRoots: ['.'],
        testCommand: 'npx vitest run',
      };
      const result = await generateUnitTests({
        testCases,
        profile,
        targetMappings: [],
        framework: 'vitest',
        options: { outputDir: generatedDir },
      });
      // Preview artifacts are NOT counted as generated tests
      expect(result.metrics.testCasesGenerated).toBe(0);
      expect(result.metrics.testCasesBlocked).toBe(0);
      expect(result.metrics.generatedUnitFiles).toBe(1);
      const src = readFileSync(join(generatedDir, 'TC-0001.preview.ts'), 'utf8');
      // The artifact is explicitly marked as NOT A TEST
      expect(src).toContain('NOT A TEST');
      expect(src).toContain('does NOT call application code');
      expect(src).toContain('quantity');
      expect(src).toContain('INSUFFICIENT_STOCK');
      // The shared table file must contain specPreview (not specApply)
      expect(readFileSync(join(generatedDir, '_spec-preview.ts'), 'utf8')).toContain('specPreview');
      // The artifact file extension is .preview.ts (not .spec.ts)
      expect(result.generatedFiles[0]).toContain('.preview.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
