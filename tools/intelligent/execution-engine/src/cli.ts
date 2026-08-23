/* eslint-disable no-console -- CLI tool legitimately uses console for output */
// ---------------------------------------------------------------------------
// Execution Engine – CLI entry point
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import { executePreparation, buildManifest } from './engine.js';
import { writeOutput } from './persistence/output-writer.js';
import { defaultPolicy, mergePolicy, validateExecuteGate } from './policy.js';
import { registerExecutor } from './registry.js';
import { InMemoryDbExecutor } from './executors/in-memory-db-executor.js';
import { ValueGeneratorExecutor } from './executors/value-generator-executor.js';
import { ManualExecutor } from './executors/manual-executor.js';
import type { ExecutableDataPreparationIR, ExecutionMode } from './models.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.input) {
    console.error('Error: --input is required (path to executable-data-preparation-ir.json)');
    printUsage();
    process.exit(1);
  }

  if (!args.output) {
    console.error('Error: --output is required');
    printUsage();
    process.exit(1);
  }

  const inputPath = args.input as string;
  const outputDir = args.output as string;
  const mode = (args.mode as ExecutionMode) ?? 'dry-run';
  const allowMutation = args['allow-mutation'] === true;

  // Double-gate check for execute mode
  validateExecuteGate(mode, mergePolicy(defaultPolicy(), { allowMutation }), allowMutation);

  // Register built-in executors
  registerExecutor(new InMemoryDbExecutor());
  registerExecutor(new ValueGeneratorExecutor());
  registerExecutor(new ManualExecutor());

  const ir = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as ExecutableDataPreparationIR;

  console.log('Execution Engine v1');
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Mode:   ${mode}`);
  console.log(`  Output: ${outputDir}`);
  console.log('');

  const { result, warnings } = await executePreparation(ir, {
    policy: { mode },
    seed: args.seed as string | undefined,
  });

  const manifest = buildManifest(inputPath, mode, result, warnings);
  writeOutput(outputDir, result, manifest);

  console.log(`Execution complete (${mode})`);
  console.log('');
  console.log(`  Status:         ${result.status}`);
  console.log(`  Operations:     ${result.quality.operationsTotal}`);
  console.log(`  Succeeded:      ${result.quality.succeeded}`);
  console.log(`  Failed:         ${result.quality.failed}`);
  console.log(`  Blocked:        ${result.quality.blocked}`);
  console.log(`  Manual:         ${result.quality.manual}`);
  console.log(`  Bindings:       ${result.quality.bindingsProduced}`);
  console.log(`  Audit events:   ${result.auditTrail.length}`);
  console.log('');

  if (warnings.length > 0) {
    console.log(`  Warnings: ${warnings.length}`);
    for (const w of warnings.slice(0, 5)) {
      console.log(`    [${w.code}] ${w.message}`);
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
Usage: execution-engine --input <ir.json> --output <dir> [options]

Options:
  --input <path>          Path to executable-data-preparation-ir.json (required)
  --output <dir>          Path to output directory (required)
  --mode <mode>           dry-run | simulate | execute (default: dry-run)
  --seed <string>         Seed for deterministic value generation
  --allow-mutation        Required with --mode execute
  --help                  Show this help
`);
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
