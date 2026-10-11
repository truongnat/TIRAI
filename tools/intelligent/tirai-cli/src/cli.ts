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
import { runTaskCreate, runTaskList, runTaskShow } from './commands/task.js';
import { runContractValidate, runContractImport } from './commands/contract.js';
import { runArtifactPlan, runArtifactVerify } from './commands/artifact.js';
import { runAnalyze } from './commands/analyze.js';
import { CliError } from './errors.js';
import { runMappingValidate } from './commands/mapping.js';

import { runWebDiscover, runWebAuthLogin, runWebAuthImport, runWebAuthClear } from './commands/web.js';
import { runReviewApprove, runReviewClarify } from './commands/review.js';
const VERSION = '1.0.0';

function printHelp(): void {
  console.log(`
tirai — TIRAI workspace + web testing CLI

Usage:
  tirai <command> [options]

Commands:
  init                    Initialize TIRAI workspace (.tirai/)
  ingest <spec>           Ingest a local spec into canonical contract/TestCases
    --source-code <dir>   Explicit read-only source scan; default is black-box
  generate                Generate tests (requires --target)
    --target playwright   Generate Playwright E2E (requires E2E mapping)
    --target vitest       Generate Vitest unit (requires source mapping)
  run                     Execute generated tests (real Chromium + Vitest)
  report                  Show canonical run summary
  status                  Show workspace status
  target list             List configured platform targets
  target add              Add a target environment; web auth uses env:NAME refs
  target validate         Validate platform configuration
  spec add                Add a specification to the registry
  spec list               List registered specifications
  spec inspect            Inspect a specification
  task create             Create an isolated task workspace
  task list               List task workspaces
  task show <task-id>     Show a task workspace
  contract validate       Validate canonical contract JSON
  contract import <file>  Import an externally generated contract (--task <id> supported)
  artifact plan           Plan outputs from canonical contract
  artifact verify         Verify exported artifact checksums
  mapping validate <file> Validate explicit API/DB execution mapping
  analyze                 Inspect AI input and raw context package
  plan                    Inspect canonical test plan and coverage quality
  export                  Export test cases (json/xlsx/markdown/pdf/docx/all)
  execute                 Execute selected approved cases on the configured platform
    --test-case <id>       Execute one canonical test case
    --test-cases <ids>     Execute comma-separated approved case IDs (web only)
    --module <id>          Execute test cases from one module (non-web platforms)
    --environment <name>  Required for every web run
    --confirm-dedicated-test-tenant
                            Confirms the tester reviewed the non-production tenant/data
  web discover            Discover same-origin routes and safe navigation controls
    --environment <name>  Required non-production web environment
    --max-routes <1-50>   Maximum routes to inspect (default: 50)
  auth login              Open a headed browser for temporary manual SSO
    --environment <name>  Required non-production web environment
  auth import             Import a Playwright storageState JSON session
    --environment <name>  Required non-production web environment
    --file <json>         Existing Playwright storageState JSON file
  auth clear              Delete TIRAI browser sessions
  review approve          Approve a case after human review
    --test-case <id> --route </path> --reviewer <name>
  review clarify          Resolve one ambiguous case from a reviewed plan
    --file <json>         JSON with reviewId, testCaseId, questionId, question, answer, resolvedTestCase
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  tirai init
  tirai ingest ./spec.xlsx
  tirai generate --target playwright
  tirai generate --target vitest --source-mapping ./unit.json
  tirai run
  tirai report
  tirai target add web --environment staging --url https://staging.example.com
  tirai target list
  tirai spec add ./spec.xlsx
  tirai task create "Test Todo feature"
  tirai task list
  tirai spec list
  tirai plan
  tirai export --format all
  tirai web discover --environment staging
  tirai auth login --environment staging
  tirai auth import --environment staging --file ./storageState.json
  tirai review approve --test-case TC-1 --route /orders --reviewer "Tester"
  tirai execute --platform web --environment staging --test-cases TC-1 --confirm-dedicated-test-tenant
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
      case 'contract': {
        if (args[0] === 'validate') await runContractValidate({ cwd, contractPath: flags.file as string, taskId: flags.task as string, json: Boolean(flags.json) });
        else if (args[0] === 'import' && args[1]) await runContractImport({ cwd, inputPath: args[1], taskId: flags.task as string, json: Boolean(flags.json) });
        else throw new CliError('INVALID_TARGET', 'Usage: tirai contract validate | tirai contract import <file>');
        break;
      }
      case 'artifact': {
        if (args[0] === 'plan') await runArtifactPlan({ cwd, contractPath: flags.file as string, taskId: flags.task as string, json: Boolean(flags.json) });
        else if (args[0] === 'verify') await runArtifactVerify({ cwd, taskId: flags.task as string, json: Boolean(flags.json) });
        else throw new CliError('INVALID_TARGET', 'Usage: tirai artifact plan | tirai artifact verify');
        break;
      }
      case 'analyze': {
        await runAnalyze({ cwd, taskId: flags.task as string, json: Boolean(flags.json) });
        break;
      }
      case 'mapping': {
        if (args[0] === 'validate' && args[1]) await runMappingValidate({ cwd, inputPath: args[1], platform: flags.platform as string, json: Boolean(flags.json) });
        else throw new CliError('INVALID_TARGET', 'Usage: tirai mapping validate <file> --platform api|database');
        break;
      }
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
        await runIngest({ cwd, sourcePath, sourceCodePath: flags['source-code'] as string, taskId: flags.task as string, json });
        break;
      }
      case 'generate': {
        const target = flags.target as 'playwright' | 'vitest' | undefined;
        await runGenerate({
          cwd,
          target,
          sourceMapping: flags['source-mapping'] as string,
          taskId: flags.task as string,
        });
        break;
      }
      case 'run': {
        const json = Boolean(flags.json);
        const code = await runRun({ cwd, json, taskId: flags.task as string });
        process.exit(code);
        break;
      }
      case 'report': {
        const json = Boolean(flags.json);
        await runReport({ cwd, json, taskId: flags.task as string });
        break;
      }
      case 'status': {
        const json = Boolean(flags.json);
        await runStatus({ cwd, json, taskId: flags.task as string });
        break;
      }
      case 'web': {
        if (args[0] !== 'discover') throw new CliError('INVALID_TARGET', 'Usage: tirai web discover --environment local|dev|staging');
        if (typeof flags.environment !== 'string') throw new CliError('INVALID_TARGET', 'Web discovery requires --environment.');
        const maxRoutes = flags['max-routes'] === undefined ? undefined : Number(flags['max-routes']);
        await runWebDiscover({ cwd, environment: flags.environment, maxRoutes, json: Boolean(flags.json) });
        break;
      }
      case 'auth': {
        if (args[0] === 'login') {
          if (typeof flags.environment !== 'string') throw new CliError('INVALID_TARGET', 'Manual sign-in requires --environment.');
          await runWebAuthLogin({ cwd, environment: flags.environment, json: Boolean(flags.json) });
        } else if (args[0] === 'import') {
          if (typeof flags.environment !== 'string' || typeof flags.file !== 'string') {
            throw new CliError('INVALID_TARGET', 'Usage: tirai auth import --environment <name> --file <storageState.json>');
          }
          await runWebAuthImport({ cwd, environment: flags.environment, file: flags.file, json: Boolean(flags.json) });
        } else if (args[0] === 'clear') {
          await runWebAuthClear({ cwd, environment: flags.environment as string | undefined, json: Boolean(flags.json) });
        } else {
          throw new CliError('INVALID_TARGET', 'Usage: tirai auth login --environment <name> | tirai auth import --environment <name> --file <storageState.json> | tirai auth clear [--environment <name>]');
        }
        break;
      }
      case 'review': {
        if (args[0] === 'approve') {
          const testCaseId = flags['test-case'] as string;
          const route = flags.route as string;
          const reviewer = flags.reviewer as string;
          if (!testCaseId || !route || !reviewer) throw new CliError('INVALID_TARGET', 'Usage: tirai review approve --test-case <id> --route </path> --reviewer <name>');
          await runReviewApprove({ cwd, testCaseId, route, reviewer, json: Boolean(flags.json) });
        } else if (args[0] === 'clarify') {
          const inputPath = flags.file as string;
          if (!inputPath) throw new CliError('INVALID_TARGET', 'Usage: tirai review clarify --file <json>');
          await runReviewClarify({ cwd, inputPath, json: Boolean(flags.json) });
        } else {
          throw new CliError('INVALID_TARGET', 'Usage: tirai review approve | tirai review clarify');
        }
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
            throw new CliError('INVALID_TARGET', 'Usage: tirai target add <platform> <environment> --url <url> [--username-ref env:NAME --password-ref env:NAME]');
          }
          await runTargetAdd({
            cwd,
            platform,
            environment,
            url: flags.url as string,
            authType: flags['auth-type'] as 'basic' | 'bearer' | 'oauth' | 'cookie' | 'none' | undefined,
            usernameRef: flags['username-ref'] as string | undefined,
            passwordRef: flags['password-ref'] as string | undefined,
            tokenRef: flags['token-ref'] as string | undefined,
            json: Boolean(flags.json),
          });
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
      case 'task': {
        const subcmd = args[0];
        if (subcmd === 'create') {
          const name = (flags.name as string) || args.slice(1).join(' ');
          await runTaskCreate({ cwd, name, sourceCodePath: flags['source-code'] as string, json: Boolean(flags.json) });
        } else if (subcmd === 'list') {
          await runTaskList({ cwd, json: Boolean(flags.json) });
        } else if (subcmd === 'show') {
          const taskId = args[1] || (flags.id as string);
          if (!taskId) throw new CliError('TASK_INVALID', 'Usage: tirai task show <task-id>');
          await runTaskShow({ cwd, taskId, json: Boolean(flags.json) });
        } else {
          throw new CliError('TASK_INVALID', 'Unknown task subcommand. Use create, list, or show.');
        }
        break;
      }
      case 'plan': {
        await runPlan({ cwd, json: Boolean(flags.json), taskId: flags.task as string });
        break;
      }
      case 'export': {
        const format = args[0] || (flags.format as string) || 'all';
        await runExport({
          cwd,
          format,
          outDir: flags.out as string,
          taskId: flags.task as string,
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
          taskId: flags.task as string,
          testCaseId: flags['test-case'] as string,
          testCaseIds: typeof flags['test-cases'] === 'string' ? flags['test-cases'].split(',').map((id) => id.trim()).filter(Boolean) : undefined,
          confirmDedicatedTestTenant: Boolean(flags['confirm-dedicated-test-tenant']),
          module: flags.module as string,
          mappingPath: flags.mapping as string,
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
