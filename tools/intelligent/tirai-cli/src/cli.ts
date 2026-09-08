// tirai CLI — thin product surface over frozen core capabilities.

import { runInit } from './commands/init.js';
import { runIngest } from './commands/ingest.js';
import { runGenerate } from './commands/generate.js';
import { runRun } from './commands/run.js';
import { runReport } from './commands/report.js';
import { runStatus } from './commands/status.js';
import { runTargetList, runTargetAdd, runTargetValidate } from './commands/target.js';
import { runSpecAdd, runSpecList, runSpecInspect } from './commands/spec.js';
import { runPlan } from './commands/plan.js';
import { runExport } from './commands/export.js';
import { runExecute } from './commands/execute.js';
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
  generate [--e2e|--unit] Generate tests from TestCase JSON (no mapping → preview artifact only)
  run                     Execute generated tests (real Chromium + Vitest)
  report                  Show canonical run summary
  status                  Show workspace status
  target list             List configured platform targets
  target add              Add a target platform environment
  target validate         Validate platform configuration
  spec add                Add a specification to the registry
  spec list               List registered specifications
  spec inspect            Inspect a specification
  plan                    Generate canonical test plan from specs + targets
  export                  Export test cases (json/xlsx/markdown/pdf/docx/all)
  execute                 Execute tests against configured platform
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  tirai init
  tirai ingest ./spec.xlsx
  tirai generate
  tirai run
  tirai report
  tirai target add web --environment staging --url https://staging.example.com
  tirai target list
  tirai spec add ./spec.xlsx
  tirai spec list
  tirai plan
  tirai export --format all
  tirai execute --platform web --environment staging
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
      case 'target': {
        const subcmd = args[0];
        if (subcmd === 'list') {
          await runTargetList({ cwd, json: Boolean(flags.json) });
        } else if (subcmd === 'add') {
          const platform = args[1] || (flags.platform as string);
          const environment = args[2] || (flags.environment as string);
          if (!platform || !environment) {
            throw new CliError('INVALID_TARGET', 'Usage: tirai target add <platform> <environment> --url <url>');
          }
          await runTargetAdd({ cwd, platform, environment, url: flags.url as string, json: Boolean(flags.json) });
        } else if (subcmd === 'validate') {
          await runTargetValidate({ cwd });
        } else {
          throw new CliError('INVALID_TARGET', `Unknown target subcommand: ${subcmd}. Use list, add, or validate.`);
        }
        break;
      }
      case 'spec': {
        const subcmd = args[0];
        if (subcmd === 'add') {
          const sourcePath = args[1] || (flags.source as string) || (flags.path as string);
          if (!sourcePath) {
            throw new CliError('SOURCE_INPUT_ERROR', 'Usage: tirai spec add <source-path>');
          }
          await runSpecAdd({
            cwd,
            sourcePath,
            name: flags.name as string,
            language: flags.language as string,
            domain: flags.domain as string,
            priority: flags.priority as string,
            json: Boolean(flags.json),
          });
        } else if (subcmd === 'list') {
          await runSpecList({ cwd, json: Boolean(flags.json) });
        } else if (subcmd === 'inspect') {
          const specId = args[1] || (flags.id as string);
          if (!specId) {
            throw new CliError('SOURCE_INPUT_ERROR', 'Usage: tirai spec inspect <spec-id>');
          }
          await runSpecInspect({ cwd, specId, json: Boolean(flags.json) });
        } else {
          throw new CliError('SOURCE_INPUT_ERROR', `Unknown spec subcommand: ${subcmd}. Use add, list, or inspect.`);
        }
        break;
      }
      case 'plan': {
        await runPlan({ cwd, json: Boolean(flags.json) });
        break;
      }
      case 'export': {
        const format = args[0] || (flags.format as string) || 'all';
        await runExport({
          cwd,
          format,
          outDir: flags.out as string,
          includeBlocked: Boolean(flags['include-blocked']),
          json: Boolean(flags.json),
        });
        break;
      }
      case 'execute': {
        await runExecute({
          cwd,
          platform: flags.platform as string,
          environment: flags.environment as string,
          json: Boolean(flags.json),
        });
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
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack && process.env.DEBUG) console.error(err.stack);
    process.exit(2);
  }
}

main();
