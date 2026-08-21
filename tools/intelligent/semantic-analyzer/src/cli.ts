// ---------------------------------------------------------------------------
// Semantic Analyzer – CLI entry point
// ---------------------------------------------------------------------------

import { createAIProvider } from 'ai-provider';
import { analyzeSemanticContext } from './analyzer.js';

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

  console.log(`Semantic Analyzer v1`);
  console.log(`  Provider: ${provider.name}`);
  console.log(`  Input:    ${inputDir}`);
  console.log(`  Output:   ${outputDir}`);
  console.log('');

  const startTime = Date.now();

  const ir = await analyzeSemanticContext(inputDir, provider, {
    outputDir: outputDir,
    concurrency: (args.concurrency as number) ?? 2,
    resume: args.resume as boolean | undefined,
    sheets: args.sheet ? [args.sheet as string] : undefined,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Analysis complete in ${elapsed}s`);
  console.log('');
  console.log(`  Sections:      ${ir.sections.length}`);
  console.log(`  Entities:      ${ir.entities.length}`);
  console.log(`  Flows:         ${ir.flows.length}`);
  console.log(`  Rules:         ${ir.rules.length}`);
  console.log(`  Relationships: ${ir.relationships.length}`);
  console.log(`  Unresolved:    ${ir.unresolved.length}`);
  console.log('');
  console.log(`  AI requests:   ${ir.analysis.aiRequests}`);
  console.log(`  Input tokens:  ${ir.analysis.usage.inputTokens}`);
  console.log(`  Output tokens: ${ir.analysis.usage.outputTokens}`);
  console.log(`  Total tokens:  ${ir.analysis.usage.totalTokens}`);
  console.log('');

  if (ir.analysis.warnings.length > 0) {
    console.log(`  Warnings: ${ir.analysis.warnings.length}`);
    for (const w of ir.analysis.warnings.slice(0, 10)) {
      console.log(`    [${w.code}] ${w.message}`);
    }
    if (ir.analysis.warnings.length > 10) {
      console.log(`    ... and ${ir.analysis.warnings.length - 10} more`);
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
Usage: semantic-analyzer --input <context-dir> --output <output-dir> [options]

Options:
  --input <dir>       Path to context package directory (required)
  --output <dir>      Path to output directory (required)
  --provider <name>   AI provider name (default: groq)
  --model <model>     Model override
  --concurrency <n>   Concurrent chunk analysis (default: 2)
  --resume            Resume from cached intermediate results
  --sheet <name>      Analyze only a specific sheet
  --help              Show this help
`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
