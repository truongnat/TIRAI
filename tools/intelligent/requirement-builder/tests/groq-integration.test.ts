// ---------------------------------------------------------------------------
// Groq integration test – opt-in via RUN_GROQ_INTEGRATION=true
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRequirements } from '../src/builder.js';
import { createAIProvider } from 'ai-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATION_IR_DIR = path.join(__dirname, 'fixtures', 'integration-semantic-ir');

const RUN_GROQ = process.env.RUN_GROQ_INTEGRATION === 'true';

describe.skipIf(!RUN_GROQ)('Groq integration', () => {
  it('produces valid requirements from real Groq API', async () => {
    const provider = createAIProvider({ provider: 'groq' });

    const ir = await buildRequirements(INTEGRATION_IR_DIR, provider);

    // Schema valid
    expect(ir.schemaVersion).toBe('1.0');

    // Requirements > 0 when evidence exists
    expect(ir.requirements.length).toBeGreaterThan(0);

    // Provenance valid (all provenance has contextId)
    for (const req of ir.requirements) {
      expect(req.provenance.length).toBeGreaterThan(0);
      for (const p of req.provenance) {
        expect(p.contextId).toBeTruthy();
      }
    }

    // Semantic refs valid (all relatedSemanticIds exist in source IR)
    const validIds = new Set(['flow-0001', 'rule-0001', 'ent-0001', 'ent-0002', 'sec-0001']);
    for (const req of ir.requirements) {
      for (const sid of req.relatedSemanticIds) {
        expect(validIds.has(sid)).toBe(true);
      }
    }

    // No entity-only hallucination
    for (const req of ir.requirements) {
      const lower = req.statement.toLowerCase();
      // Should not be just "System shall have <entity>"
      expect(lower).not.toMatch(/^(the system|system) (shall|must|will) (have|provide|contain|include)\s+\w+$/);
    }

    // Quality metrics present
    expect(ir.quality.total).toBe(ir.requirements.length);
    expect(ir.quality.provenanceCoverage).toBeGreaterThan(0);
  }, 300000); // 5 min timeout for real API call
});
