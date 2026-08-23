/* eslint-disable no-console -- CLI tool legitimately uses console for output */
// ---------------------------------------------------------------------------
// Data Resolver – CLI entry point
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import { resolveDataPlan, buildManifest } from './resolver-engine.js';
import { writeOutput } from './persistence/output-writer.js';
import type { TestDataPlanIR, EnvironmentProfile, ResourceMapping } from './models.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.input) {
    console.error('Error: --input is required (path to test-data-plan-ir.json)');
    printUsage();
    process.exit(1);
  }

  if (!args.output) {
    console.error('Error: --output is required');
    printUsage();
    process.exit(1);
  }

  if (!args.environment) {
    console.error('Error: --environment is required (path to environment profile JSON)');
    printUsage();
    process.exit(1);
  }

  const inputPath = args.input as string;
  const outputDir = args.output as string;
  const envPath = args.environment as string;

  // Load inputs
  const plan = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as TestDataPlanIR;
  const environment = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as EnvironmentProfile;

  // Optional mappings
  let mappings: ResourceMapping[] = [];
  if (args.mappings) {
    mappings = JSON.parse(fs.readFileSync(args.mappings as string, 'utf-8'));
  }

  console.log('Data Resolver v1');
  console.log(`  Input:       ${inputPath}`);
  console.log(`  Environment: ${envPath}`);
  console.log(`  Output:      ${outputDir}`);
  console.log('');

  const startTime = Date.now();

  const { ir, warnings } = resolveDataPlan(plan, environment, {
    outputDir,
    mappings,
    manualFallback: args.manualFallback !== false,
    generationSeed: args.seed as string | undefined,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const manifest = buildManifest(inputPath, environment.id, ir, warnings);
  writeOutput(outputDir, ir, manifest);

  console.log(`Resolution complete in ${elapsed}s`);
  console.log('');
  console.log(`  Data items:     ${ir.quality.dataItemsTotal}`);
  console.log(`  Operations:     ${ir.quality.operations}`);
  console.log(`  Automated:      ${ir.quality.automatedOperations}`);
  console.log(`  Manual:         ${ir.quality.manualOperations}`);
  console.log(`  Unresolved:     ${ir.quality.unresolved}`);
  console.log(`  Bindings:       ${ir.quality.bindings}`);
  console.log(`  Dependencies:   ${ir.quality.dependencyEdges}`);
  console.log(`  Cycles:         ${ir.quality.cyclicDependencies}`);
  console.log('');

  // Resolver breakdown
  const resolverCounts = new Map<string, number>();
  for (const op of ir.operations) {
    resolverCounts.set(op.resolver, (resolverCounts.get(op.resolver) ?? 0) + 1);
  }
  if (resolverCounts.size > 0) {
    console.log('  Resolver breakdown:');
    for (const [resolver, count] of [...resolverCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${resolver}: ${count}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  Warnings: ${warnings.length}`);
    for (const w of warnings.slice(0, 5)) {
      console.log(`    [${w.code}] ${w.message}`);
    }
    if (warnings.length > 5) {
      console.log(`    ... and ${warnings.length - 5} more`);
    }
    console.log('');
  }

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
Usage: data-resolver --input <plan.json> --environment <env.json> --output <dir> [options]

Options:
  --input <path>              Path to test-data-plan-ir.json (required)
  --environment <path>        Path to environment profile JSON (required)
  --output <dir>              Path to output directory (required)
  --mappings <path>           Path to resource mappings JSON (optional)
  --seed <string>             Generation seed for deterministic values
  --no-manual-fallback        Disable manual resolver fallback
  --help                      Show this help
`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
