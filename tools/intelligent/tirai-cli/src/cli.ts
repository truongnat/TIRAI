#!/usr/bin/env node
// tirai CLI — thin product surface over frozen core capabilities.
// Composes: source-to-testcase, test-code-generator, project-adapter, execution-mapping-builder, ai-provider.

import { runInit } from './commands/init.js';
import { runIngest } from './commands/ingest.js';
import { runGenerate } from './commands/generate.js';
import { runRun } from './commands/run.js';
import { runReport } from './commands/report.js';
import { runStatus } from './commands/status.js';
import { CliError } from './errors.js';

const VERSION = '1.0.0';

function printHelp(): void {
  console.log(`
tirai — TIRAI workspace + CLI (developer-runnable MVP)

Usage:
  tirai <command> [options]

Commands:
  init                    Initialize TIRAI workspace (.tirai/)
  ingest <spec>           Ingest Excel/Markdown spec → canonical TestCases
  generate [--e2e|--unit] Generate Playwright + Vitest tests from mappings
  run                     Execute generated tests (real Chromium + Vitest)
  report                  Show canonical run summary
  status                  Show workspace status
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  tirai init
  tirai ingest ./spec.xlsx
  tirai generate
  tirai run
  tirai report
`);
}

function printVersion(): void {
  console.log(`tirai ${VERSION}`);
}

function parseArgs(argv: string[]): { cmd: string; args: string[]; flags: Record<string, string | boolean> } {
  const raw = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  let cmd = '';
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = raw[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (tok.startsWith('-') && tok.length === 2) {
      const key = tok.slice(1);
      flags[key] = true;
    } else {
      if (!cmd && !tok.startsWith('-')) {
        cmd = tok;
      } else {
        args.push(tok);
      }
    }
  }
  return { cmd, args, flags };
}

async function main(): Promise<void> {
  const { cmd, args, flags } = parseArgs(process.argv);
  const cwd = process.cwd();

  if (flags.help || flags.h || cmd === 'help') {
    printHelp();
    process.exit(0);
  }
  if (flags.version || flags.v) {
    printVersion();
    process.exit(0);
  }
  if (!cmd) {
    printHelp();
    process.exit(0);
  }

  try {
    switch (cmd) {
      case 'init': {
        const force = Boolean(flags.force);
        await runInit({ cwd, force });
        break;
      }
      case 'ingest': {
        const sourcePath = (flags.source as string) || (flags.spec as string) || args[0];
        if (!sourcePath) {
          throw new CliError('SOURCE_INPUT_ERROR', 'Missing source path. Usage: tirai ingest <spec.xlsx>');
        }
        const json = Boolean(flags.json);
        await runIngest({ cwd, sourcePath, json });
        break;
      }
      case 'generate': {
        const e2e = Boolean(flags.e2e);
        const unit = Boolean(flags.unit);
        await runGenerate({ cwd, e2e: e2e || undefined, unit: unit || undefined });
        break;
      }
      case 'run': {
        const json = Boolean(flags.json);
        const code = await runRun({ cwd, json });
        process.exit(code);
        break;
      }
      case 'report': {
        const json = Boolean(flags.json);
        await runReport({ cwd, json });
        break;
      }
      case 'status': {
        const json = Boolean(flags.json);
        await runStatus({ cwd, json });
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(2);
    }
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error [${err.code}]: ${err.message}`);
      if (err.hint) console.error(`Hint: ${err.hint}`);
      process.exit(2);
    }
    // Unexpected
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack && process.env.DEBUG) console.error(err.stack);
    process.exit(2);
  }
}

main();
