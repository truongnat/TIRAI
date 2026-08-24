// ---------------------------------------------------------------------------
// Reprocess real test cases with deterministic extractor (no AI calls)
// ---------------------------------------------------------------------------
// Usage: node dist/reprocess.js <test-case-dir> <output-dir>
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FakeAIProvider } from 'ai-provider';
import { buildTestDataPlan } from './planner.js';

async function main(): Promise<void> {
  const inputDir = process.argv[2];
  const outputDir = process.argv[3];

  if (!inputDir || !outputDir) {
    console.error('Usage: node reprocess.js <test-case-dir> <output-dir>');
    process.exit(1);
  }

  // Load test case IR to count test cases for fake provider
  const tcContent = fs.readFileSync(path.join(inputDir, 'test-case-ir.json'), 'utf-8');
  const tcIR = JSON.parse(tcContent);
  const tcCount = tcIR.testCases.length;

  console.log(`Reprocessing ${tcCount} test cases from ${inputDir}`);
  console.log('Using deterministic extractor (no AI calls)');

  // FakeAIProvider returns empty results — deterministic layer handles extraction
  const provider = new FakeAIProvider({
    name: 'fake-deterministic',
    model: 'none',
    responses: [
      { dataCandidates: [], unresolvedCandidates: [] },  // data requirement extraction
      { dependencyCandidates: [], reuseCandidates: [] },  // dependency analysis
    ],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });

  const ir = await buildTestDataPlan(inputDir, provider, { outputDir });

  console.log('');
  console.log('Results:');
  console.log(`  Test cases total:    ${ir.testCases.length}`);
  console.log(`  Data items:          ${ir.dataItems.length}`);
  console.log(`  Dependencies:        ${ir.dependencyGraph.length}`);
  console.log(`  Reusable sets:       ${ir.reusableSets.length}`);
  console.log(`  Unresolved:          ${ir.unresolved.length}`);
  console.log('');
  console.log(`  Tests requiring data: ${ir.quality.testsRequiringData}`);
  console.log(`  Tests covered:       ${ir.quality.testsCoveredByData}`);
  console.log(`  Coverage rate:       ${Math.round(ir.quality.coverageRate * 100)}%`);
  console.log('');

  // Type breakdown
  const typeCounts = new Map<string, number>();
  for (const d of ir.dataItems) {
    typeCounts.set(d.type, (typeCounts.get(d.type) ?? 0) + 1);
  }
  if (typeCounts.size > 0) {
    console.log('  Data types:');
    for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type}: ${count}`);
    }
  }

  // Strategy breakdown
  const stratCounts = new Map<string, number>();
  for (const d of ir.dataItems) {
    stratCounts.set(d.strategy, (stratCounts.get(d.strategy) ?? 0) + 1);
  }
  if (stratCounts.size > 0) {
    console.log('');
    console.log('  Strategies:');
    for (const [strat, count] of [...stratCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${strat}: ${count}`);
    }
  }

  // Sample items
  if (ir.dataItems.length > 0) {
    console.log('');
    console.log('  Sample data items:');
    for (const d of ir.dataItems.slice(0, 10)) {
      console.log(`    ${d.id} [${d.type}/${d.strategy}/${d.lifecycle}] ${d.name.slice(0, 60)}`);
      console.log(`      TCs: ${d.relatedTestCaseIds.join(', ')}`);
    }
    if (ir.dataItems.length > 10) {
      console.log(`    ... and ${ir.dataItems.length - 10} more`);
    }
  }

  console.log('');
  console.log(`Output written to: ${outputDir}/`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
