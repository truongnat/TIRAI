// ---------------------------------------------------------------------------
// Requirement Builder – CLI entry point
// ---------------------------------------------------------------------------

import { createAIProvider } from 'ai-provider';
import { buildRequirements } from './builder.js';

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

  console.log(`Requirement Builder v1`);
  console.log(`  Provider: ${provider.name}`);
  console.log(`  Input:    ${inputDir}`);
  console.log(`  Output:   ${outputDir}`);
  console.log('');

  const startTime = Date.now();

  const ir = await buildRequirements(inputDir, provider, {
    outputDir,
    resume: args.resume as boolean | undefined,
    maxRepairAttempts: args.maxRepairAttempts as number | undefined,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Build complete in ${elapsed}s`);
  console.log('');
  console.log(`  Requirements: ${ir.requirements.length}`);
  console.log(`  Explicit:     ${ir.quality.explicit}`);
  console.log(`  Derived:      ${ir.quality.derived}`);
  console.log(`  Unresolved:   ${ir.unresolved.length}`);
  console.log(`  Conflicts:    ${ir.conflicts.length}`);
  console.log('');
  console.log(`  Testable:          ${ir.quality.testable}`);
  console.log(`  Partially-testable:${ir.quality.partiallyTestable}`);
  console.log(`  Not-testable:      ${ir.quality.notTestable}`);
  console.log('');
  console.log(`  AI requests:   ${ir.quality.total > 0 ? 'see manifest' : '0'}`);
  console.log(`  Provenance:    ${ir.quality.provenanceCoverage}`);
  console.log('');

  if (ir.requirements.length > 0) {
    console.log('  Sample requirements:');
    for (const req of ir.requirements.slice(0, 5)) {
      console.log(`    ${req.id} [${req.type}] [${req.sourceNature}] ${req.statement.slice(0, 80)}`);
    }
    if (ir.requirements.length > 5) {
      console.log(`    ... and ${ir.requirements.length - 5} more`);
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
Usage: requirement-builder --input <semantic-dir> --output <output-dir> [options]

Options:
  --input <dir>              Path to Semantic IR directory (required)
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
