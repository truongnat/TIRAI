#!/usr/bin/env node
// CLI entry point for tirai-run (spec §65-68).
//
// Non-interactive by default. No prompts. Explicit flags for execution.

import { resolve } from 'node:path';
import { EndToEndRunner } from './runner.js';
import { defaultPolicy, isValidMode } from './policy.js';
import { loadAllInputs } from './loader.js';
import type { EndToEndRunMode, EndToEndExitCode, TestSelection } from './models.js';

async function main(): Promise<EndToEndExitCode> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  // Parse arguments.
  const mode = getArg(args, '--mode') ?? 'dry-run';
  if (!isValidMode(mode)) {
    console.error(`Invalid mode: ${mode}`);
    return 4;
  }

  const profilePath = getArg(args, '--project-profile');
  const projectDir = getArg(args, '--project');
  const testCasesPath = getArg(args, '--test-cases');
  const mappingsPath = getArg(args, '--mappings');
  const dataPlanPath = getArg(args, '--test-data');
  const preparedDataPath = getArg(args, '--prepared-data');
  const outputDir = getArg(args, '--output') ?? 'output/e2e-runs';
  const environment = getArg(args, '--environment');
  const allowExecution = args.includes('--allow-execution');
  const allowDbMutation = args.includes('--allow-database-mutation');
  const allowApiMutation = args.includes('--allow-api-mutation');
  const allowBrowser = args.includes('--allow-browser');
  const allowCommands = args.includes('--allow-commands');
  const failFast = args.includes('--fail-fast');
  const pretty = args.includes('--pretty');
  const maxTestsStr = getArg(args, '--max-tests');
  const maxTests = maxTestsStr ? parseInt(maxTestsStr, 10) : undefined;

  if (!testCasesPath || !mappingsPath) {
    console.error('--test-cases and --mappings are required');
    return 4;
  }

  // Build policy.
  const policy = defaultPolicy({
    mode: mode as EndToEndRunMode,
    allowExecution,
    allowDatabaseMutation: allowDbMutation,
    allowApiMutation,
    allowBrowserExecution: allowBrowser,
    allowCommands,
    failFast,
    maxTests,
  });

  // Build selection.
  const selection: TestSelection = {};
  const testId = getArg(args, '--test');
  if (testId) selection.testCaseIds = [testId];
  const scenario = getArg(args, '--scenario');
  if (scenario) selection.scenarioIds = [scenario];
  const requirement = getArg(args, '--requirement');
  if (requirement) selection.requirementIds = [requirement];

  try {
    const input = await loadAllInputs({
      profilePath,
      testCasesPath: resolve(testCasesPath),
      mappingsPath: resolve(mappingsPath),
      dataPlanPath: dataPlanPath ? resolve(dataPlanPath) : undefined,
      preparedDataPath: preparedDataPath ? resolve(preparedDataPath) : undefined,
      projectDir,
      environment,
    });

    const runner = new EndToEndRunner({
      policy,
      selection: Object.keys(selection).length > 0 ? selection : undefined,
      outputDir: resolve(outputDir),
      pretty,
    });

    const result = await runner.run(input);

    switch (result.status) {
      case 'validated':
      case 'passed':
        return 0;
      case 'failed':
        return 1;
      case 'blocked':
        return 2;
      case 'error':
        return 3;
      case 'partial':
        return 1;
      default:
        return 3;
    }
  } catch (err) {
    console.error(`Runner error: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function printHelp(): void {
  console.log(`
tirai-run — End-to-End Test Runner v1

Usage:
  tirai-run [options]

Options:
  --project-profile <path>   Path to project execution profile JSON
  --project <dir>            Path to project root (adapter mode)
  --test-cases <path>        Path to test case IR JSON (required)
  --mappings <path>          Path to execution mapping IR JSON (required)
  --test-data <path>         Path to test data plan IR JSON
  --prepared-data <path>     Path to prepared data IR JSON
  --environment <id>         Environment ID
  --mode <mode>              validate | dry-run | simulate | execute (default: dry-run)
  --output <dir>             Output directory (default: output/e2e-runs)
  --allow-execution           Allow real execution (requires mode=execute)
  --allow-database-mutation   Allow database mutations
  --allow-api-mutation        Allow API mutations
  --allow-browser             Allow browser execution
  --allow-commands            Allow command execution
  --fail-fast                 Stop on first failure
  --max-tests <n>             Maximum tests to run
  --test <id>                 Filter by test case ID
  --scenario <id>             Filter by scenario ID
  --requirement <id>          Filter by requirement ID
  --pretty                    Pretty-print JSON output
  --help                      Show this help

Exit codes:
  0 = success / validated
  1 = test failures
  2 = blocked / preflight
  3 = infrastructure error
  4 = invalid input / config
`.trim());
}

main().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  console.error(err);
  process.exitCode = 3;
});
