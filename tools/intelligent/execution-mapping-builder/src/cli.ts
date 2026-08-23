// Execution Mapping Builder — CLI entry point.
//
// Usage:
//   execution-mapping-builder \
//     --test-cases output/test-planner/test-case-ir.json \
//     --ui-catalog catalog/ui.json \
//     --bindings output/data-resolver/bindings.json \
//     --output output/execution-mapping \
//     --provider none \
//     --resume

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExecutionMapping } from './builder.js';
import { writeOutput } from './persistence/writer.js';
import type {
  ExecutionMappingBuilderOptions,
  TestCase,
  UIElementCatalog,
  BindingsCatalog,
} from './models.js';

// ---- Parse CLI args --------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] ?? '';
      args[key] = value;
      i++;
    }
  }
  return args;
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args['help'] !== undefined || Object.keys(args).length === 0) {
    console.log(`
Execution Mapping Builder v1

Usage:
  execution-mapping-builder [options]

Options:
  --test-cases <path>   Path to Test Case IR JSON (required)
  --semantic <path>     Path to Semantic IR JSON (optional)
  --ui-catalog <path>   Path to UI Element Catalog JSON (optional)
  --bindings <path>     Path to Bindings Catalog JSON (optional)
  --output <path>       Output directory (default: output/execution-mapping)
  --provider <name>     AI provider name or "none" (default: none)
  --resume              Resume from checkpoint if available
  --checkpoint <path>   Checkpoint directory (optional)
  --help                Show this help message
`);
    process.exit(0);
  }

  // Load test cases
  if (!args['test-cases']) {
    console.error('Error: --test-cases is required');
    process.exit(1);
  }

  const testCasesPath = resolve(args['test-cases']);
  const testCasesData = JSON.parse(readFileSync(testCasesPath, 'utf-8'));
  const testCases: TestCase[] = testCasesData.testCases ?? testCasesData;

  // Load optional inputs
  let uiCatalog: UIElementCatalog | undefined;
  if (args['ui-catalog']) {
    uiCatalog = JSON.parse(readFileSync(resolve(args['ui-catalog']), 'utf-8'));
  }

  let bindingsCatalog: BindingsCatalog | undefined;
  if (args['bindings']) {
    bindingsCatalog = JSON.parse(readFileSync(resolve(args['bindings']), 'utf-8'));
  }

  // Build options
  const options: ExecutionMappingBuilderOptions = {
    testCases,
    uiCatalog,
    bindingsCatalog,
    providerName: args['provider'] ?? 'none',
    resume: args['resume'] !== undefined,
    checkpointDir: args['checkpoint'] ? resolve(args['checkpoint']) : undefined,
  };

  // Run builder
  const outputDir = resolve(args['output'] ?? 'output/execution-mapping');

  try {
    const result = await buildExecutionMapping(options);

    // Write output
    writeOutput(outputDir, result);

    // Print summary
    console.log('\nExecution Mapping Builder v1 — Complete');
    console.log(`  Test cases: ${result.mapping.quality.testCasesTotal}`);
    console.log(`  Ready: ${result.mapping.quality.ready}`);
    console.log(`  Partial: ${result.mapping.quality.partial}`);
    console.log(`  Unresolved: ${result.mapping.quality.unresolved}`);
    console.log(`  AI calls: ${result.aiCalls}`);
    console.log(`  Output: ${outputDir}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
