// ---------------------------------------------------------------------------
// Test Planner – CLI entry point
// ---------------------------------------------------------------------------

import { createAIProvider } from 'ai-provider';
import { buildTestPlan } from './planner.js';

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

  console.log('Test Planner v1');
  console.log(`  Provider: ${provider.name}`);
  console.log(`  Input:    ${inputDir}`);
  console.log(`  Output:   ${outputDir}`);
  console.log('');

  const startTime = Date.now();

  const ir = await buildTestPlan(inputDir, provider, {
    outputDir,
    resume: args.resume as boolean | undefined,
    maxRepairAttempts: args.maxRepairAttempts as number | undefined,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Test planning complete in ${elapsed}s`);
  console.log('');
  console.log(`  Scenarios:      ${ir.scenarios.length}`);
  console.log(`  Test cases:     ${ir.testCases.length}`);
  console.log(`  Data needs:     ${ir.dataNeeds.length}`);
  console.log(`  Unresolved:     ${ir.unresolved.length}`);
  console.log('');
  console.log(`  Coverage rate:  ${Math.round(ir.quality.coverageRate * 100)}%`);
  console.log(`  Requirements:`);
  console.log(`    Covered:         ${ir.quality.requirementsCovered}`);
  console.log(`    Partially:       ${ir.quality.requirementsPartiallyCovered}`);
  console.log(`    Not covered:     ${ir.quality.requirementsNotCovered}`);
  console.log('');
  console.log(`  Positive cases: ${ir.quality.positiveCases}`);
  console.log(`  Negative cases: ${ir.quality.negativeCases}`);
  console.log(`  Boundary cases: ${ir.quality.boundaryCases}`);
  console.log(`  Validation:     ${ir.quality.validationCases}`);
  console.log(`  Automation:     ${ir.quality.automationReady}`);
  console.log(`  Provenance:     ${ir.quality.provenanceCoverage}`);
  console.log('');

  if (ir.scenarios.length > 0) {
    console.log('  Sample scenarios:');
    for (const s of ir.scenarios.slice(0, 5)) {
      console.log(`    ${s.id} [${s.category}] ${s.title.slice(0, 60)}`);
    }
    if (ir.scenarios.length > 5) {
      console.log(`    ... and ${ir.scenarios.length - 5} more`);
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
Usage: test-planner --input <requirement-dir> --output <output-dir> [options]

Options:
  --input <dir>              Path to Requirement IR directory (required)
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
