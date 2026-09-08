import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateUnitTests, validateGeneratedUnitSource } from '../src/index.js';
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

describe('standalone spec-unit generation', () => {
  it('generates runnable Vitest from TestCase JSON without mappings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tirai-standalone-unit-'));
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
      expect(result.status).toBe('success');
      expect(result.metrics.testCasesGenerated).toBe(1);
      expect(result.metrics.testCasesBlocked).toBe(0);
      expect(result.metrics.generationAiCalls).toBe(0);
      expect(result.metrics.guessedMappings).toBe(0);
      expect(result.generatedFiles).toHaveLength(1);
      const src = readFileSync(result.generatedFiles[0], 'utf8');
      expect(src).toContain('specApply');
      expect(src).toContain('quantity');
      expect(src).toContain('INSUFFICIENT_STOCK');
      expect(readFileSync(join(generatedDir, '_spec-apply.ts'), 'utf8')).toContain('specApply');
      const v = validateGeneratedUnitSource(result.generatedFiles[0], { resolveDir: generatedDir });
      expect(v.status).toBe('valid');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
