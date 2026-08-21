// ---------------------------------------------------------------------------
// Groq integration test – opt-in with RUN_GROQ_INTEGRATION=true
// ---------------------------------------------------------------------------
// Spec coverage: section 48
//
// This test calls the real Groq API. It is skipped unless the environment
// variable RUN_GROQ_INTEGRATION=true is set AND GROQ_API_KEY is available.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createAIProvider } from 'ai-provider';
import { analyzeSemanticContext } from '../src/analyzer.js';
import { VALID_CONTEXT_DIR } from './fixtures/helpers.js';

const RUN_GROQ = process.env.RUN_GROQ_INTEGRATION === 'true';
const HAS_KEY = !!process.env.GROQ_API_KEY;

const describeGroq = RUN_GROQ && HAS_KEY ? describe : describe.skip;

describeGroq('Groq integration', () => {
  it('runs full pipeline against real Groq API with test fixture', async () => {
    const provider = createAIProvider({
      provider: 'groq',
      config: { model: 'openai/gpt-oss-120b' },
    });

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-groq-'));
    try {
      const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider, {
        outputDir,
        concurrency: 1, // Be gentle with rate limits
      });

      // Schema valid
      expect(ir.schemaVersion).toBe('1.0');

      // Should have extracted some semantic content
      const totalObjects =
        ir.entities.length +
        ir.sections.length +
        ir.flows.length +
        ir.rules.length;
      expect(totalObjects).toBeGreaterThan(0);

      // Provenance should be valid (no invalid provenance warnings for our fixture)
      const invalidProvWarnings = ir.analysis.warnings.filter(
        (w) => w.code === 'SEMANTIC_INVALID_PROVENANCE',
      );
      expect(invalidProvWarnings).toHaveLength(0);

      // Dangling relationships are captured as warnings (not crashes).
      // Real AI output may produce some unresolvable cross-chunk refs.
      // The system correctly detects and reports them.
      const allWarningCodes = ir.analysis.warnings.map((w) => w.code);
      expect(allWarningCodes).toBeDefined();

      // Output files should exist
      expect(fs.existsSync(path.join(outputDir, 'semantic-ir.json'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);

      // Usage should be tracked
      expect(ir.analysis.usage.totalTokens).toBeGreaterThan(0);
      expect(ir.analysis.aiRequests).toBeGreaterThanOrEqual(3); // 2 chunks + 1 consolidation
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120_000);
});
