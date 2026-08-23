// ---------------------------------------------------------------------------
// Test Data Planner – CLI entry point
// ---------------------------------------------------------------------------

import { createAIProvider } from 'ai-provider';
import { buildTestDataPlan } from './planner.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.input) {
    console.error('Error: --input is required');
    printUsage();
    process.exit(1);
  }

  if (!args.output) {
    console.error('Error: --output is required');
    printUsage();
    process.exit(1);
  }

  const inputDir = args.input as string;
  const outputDir = args.output as string;

  const providerName = (args.provider as string) ?? 'groq';
  const provider = createAIProvider({
    provider: providerName,
    config: args.model ? { model: args.model as string } : undefined,
  });

  console.log('Test Data Planner v1');
  console.log(`  Provider: ${provider.name}`);
  console.log(`  Input:    ${inputDir}`);
  console.log(`  Output:   ${outputDir}`);
  console.log('');

  const startTime = Date.now();

  const ir = await buildTestDataPlan(inputDir, provider, {
    outputDir,
    resume: args.resume as boolean | undefined,
    maxRepairAttempts: args.maxRepairAttempts as number | undefined,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Test data planning complete in ${elapsed}s`);
  console.log('');
  console.log(`  Test cases:       ${ir.testCases.length}`);
  console.log(`  Data items:       ${ir.dataItems.length}`);
  console.log(`  Dependencies:     ${ir.dependencyGraph.length}`);
  console.log(`  Reusable sets:    ${ir.reusableSets.length}`);
  console.log(`  Unresolved:       ${ir.unresolved.length}`);
  console.log('');
  console.log(`  Complete plans:   ${ir.quality.testCasesWithCompleteDataPlan}`);
  console.log(`  Partial plans:    ${ir.quality.testCasesPartiallyPlanned}`);
  console.log(`  Strategy coverage: ${Math.round(ir.quality.strategyCoverage * 100)}%`);
  console.log(`  Provenance:       ${ir.quality.provenanceCoverage}`);
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
    console.log('');
  }

  if (ir.dataItems.length > 0) {
    console.log('  Sample data items:');
    for (const d of ir.dataItems.slice(0, 5)) {
      console.log(`    ${d.id} [${d.type}/${d.strategy}] ${d.name.slice(0, 50)}`);
    }
    if (ir.dataItems.length > 5) {
      console.log(`    ... and ${ir.dataItems.length - 5} more`);
    }
  }

  console.log('');
  console.log(`Output written to: ${outputDir}/`);
}

function parseArgs(argv: string[]): Record<string, string | number | boolean | undefined> {
  const result: Record<string, string | number | boolean | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        const num = Number(next);
        result[key] = Number.isFinite(num) ? num : next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`
Usage: test-data-planner --input <test-case-dir> --output <output-dir> [options]

Options:
  --input <dir>              Path to Test Case IR directory (required)
  --output <dir>             Path to output directory (required)
  --provider <name>          AI provider name (default: groq)
  --model <model>            Model override
  --max-repair-attempts <n>  Max schema repair attempts (default: 1)
  --resume                   Resume from cached results
  --help                     Show this help
`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
