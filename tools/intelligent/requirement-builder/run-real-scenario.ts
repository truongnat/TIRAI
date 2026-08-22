// ---------------------------------------------------------------------------
// Real scenario runner – executes requirement-builder on auth Semantic IR
// ---------------------------------------------------------------------------

import { createAIProvider } from 'ai-provider';
import { buildRequirements } from './src/builder.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, 'tests', 'fixtures', 'real-scenario-semantic-ir');
const OUTPUT_DIR = path.join(__dirname, 'output', 'real-scenario');

async function main() {
  // Clean output
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const provider = createAIProvider({ provider: 'groq' });

  console.log('Running Requirement Builder on real authentication scenario...');
  console.log(`  Input:  ${INPUT_DIR}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log('');

  const startTime = Date.now();
  const ir = await buildRequirements(INPUT_DIR, provider, { outputDir: OUTPUT_DIR });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nCompleted in ${elapsed}s`);
  console.log(`\n── Results ──`);
  console.log(`  Requirements: ${ir.requirements.length}`);
  console.log(`  Conflicts:    ${ir.conflicts.length}`);
  console.log(`  Unresolved:   ${ir.unresolved.length}`);
  console.log('');

  console.log(`── Quality ──`);
  console.log(`  Total:              ${ir.quality.total}`);
  console.log(`  Explicit:           ${ir.quality.explicit}`);
  console.log(`  Derived:            ${ir.quality.derived}`);
  console.log(`  Testable:           ${ir.quality.testable}`);
  console.log(`  Partially testable: ${ir.quality.partiallyTestable}`);
  console.log(`  Not testable:       ${ir.quality.notTestable}`);
  console.log(`  Unknown testability:${ir.quality.unknownTestability}`);
  console.log(`  Low confidence:     ${ir.quality.lowConfidence}`);
  console.log(`  Provenance cover:   ${ir.quality.provenanceCoverage}`);
  console.log('');

  console.log(`── Requirements ──`);
  for (const req of ir.requirements) {
    console.log(`  ${req.id} [${req.type}/${req.sourceNature}] ${req.title}`);
    console.log(`    ${req.statement}`);
    console.log(`    confidence=${req.confidence} testability=${req.testability.status}`);
    console.log(`    evidence: [${req.relatedSemanticIds.join(', ')}]`);
    console.log('');
  }

  if (ir.conflicts.length > 0) {
    console.log(`── Conflicts ──`);
    for (const c of ir.conflicts) {
      console.log(`  ${c.id}: ${c.description}`);
      console.log(`    between: [${c.requirementIds.join(', ')}]`);
      console.log(`    severity: ${c.severity}`);
      console.log('');
    }
  }

  if (ir.unresolved.length > 0) {
    console.log(`── Unresolved ──`);
    for (const u of ir.unresolved) {
      console.log(`  ${u.id}: ${u.description}`);
      console.log(`    reason: ${u.reason}`);
      console.log('');
    }
  }

  console.log(`Output written to: ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
