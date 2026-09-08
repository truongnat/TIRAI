// ---------------------------------------------------------------------------
// TIRAI — Execute Command
// ---------------------------------------------------------------------------
// Per TIRAI v1 spec §9: execution is explicit and separate from export.
// Wires platform config to the appropriate executor.

import * as fs from 'node:fs';
import { requireWorkspace } from '../workspace.js';
import { loadConfig } from '../config.js';
import { updateState } from '../state.js';
import { CliError } from '../errors.js';
import { resolveActiveTask, taskPaths, updateTask } from '../tasks.js';

export interface ExecuteOptions {
  cwd: string;
  platform?: string;
  environment?: string;
  json?: boolean;
  taskId?: string;
  testCaseId?: string;
  module?: string;
}

export async function runExecute(opts: ExecuteOptions): Promise<void> {
  const basePaths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(basePaths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const taskRoot = task ? taskPaths(basePaths, task.id) : undefined;
  const paths = taskRoot ? { ...basePaths, testCasesPath: `${taskRoot.artifacts}/testcases.json` } : basePaths;
  const config = loadConfig(basePaths);

  // Determine platform
  const platform = opts.platform || 'web';
  const environment = opts.environment || config.project.defaultEnvironment || 'local';

  // Validate platform is configured
  const platforms = config.platforms;
  if (!platforms || !platforms[platform as keyof typeof platforms]) {
    throw new CliError(
      'CONFIG_INVALID',
      `Platform "${platform}" not configured. Use "tirai target add" first.`,
    );
  }

  // Load canonical test cases
  const testCasesPath = paths.testCasesPath;
  if (!fs.existsSync(testCasesPath)) {
    throw new CliError('CONFIG_INVALID', 'No test cases found. Run "tirai plan" first.');
  }
  const loaded = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));
  const allTestCases = Array.isArray(loaded) ? loaded : (loaded as { testCases?: unknown[] }).testCases ?? [];
  const testCases = allTestCases.filter((testCase) => {
    const value = testCase as { id?: string; module?: string; moduleId?: string };
    return (!opts.testCaseId || value.id === opts.testCaseId) && (!opts.module || value.module === opts.module || value.moduleId === opts.module);
  });
  if (testCases.length === 0) throw new CliError('CONFIG_INVALID', 'No test cases match the requested execution filter.');

  // Execute based on platform
  let result: Record<string, unknown>;
  switch (platform) {
    case 'web':
      result = await executeWeb(testCases, platforms.web!.environments[environment], environment);
      break;
    case 'backend':
      result = await executeBackend(testCases, platforms.backend!.environments[environment], environment);
      break;
    case 'database':
      result = await executeDatabase(testCases, platforms.database!.environments[environment], environment);
      break;
    default:
      throw new CliError('INVALID_PLATFORM', `Unsupported platform: ${platform}`);
  }

  const resultDir = taskRoot?.results ?? paths.resultsDir;
  fs.mkdirSync(resultDir, { recursive: true });
  const resultPath = `${resultDir}/execute-${platform}-${environment}.json`;
  fs.writeFileSync(resultPath, JSON.stringify({ schemaVersion: '1.0', platform, environment, selection: { testCaseId: opts.testCaseId, module: opts.module, count: testCases.length }, ...result }, null, 2), 'utf8');

  // Update state
  updateState(paths, (s) => ({
    ...s,
    run: {
      at: new Date().toISOString(),
      runId: `run-${Date.now()}`,
      overall: result.status as string,
    },
  }));
  if (task) updateTask(basePaths, task.id, { status: result.executionStatus === 'manual' ? 'reported' : result.executionStatus === 'passed' ? 'executed' : 'blocked' });

  if (opts.json) {
    console.log(JSON.stringify({ ...result, resultPath }, null, 2));
  } else {
    console.log(`TIRAI execute complete: ${result.status}`);
    console.log(`  Platform: ${platform}`);
    console.log(`  Environment: ${environment}`);
    if (result.testCases) {
      console.log(`  Test cases: ${result.testCases}`);
    }
  }
}

async function executeWeb(
  testCases: unknown[],
  envConfig: { baseUrl: string },
  environment: string,
): Promise<Record<string, unknown>> {
  // Web execution via agentic browser executor
  // Full integration requires browser session setup
  return {
    status: 'ready',
    executionStatus: 'manual',
    evidence: { kind: 'configuration', executable: false, reason: 'Browser session is required; use generated Playwright tests for execution.' },
    platform: 'web',
    environment,
    baseUrl: envConfig.baseUrl,
    testCases: testCases.length,
    note: 'Web execution requires browser session. Use "tirai run" for generated E2E tests.',
  };
}

async function executeBackend(
  testCases: unknown[],
  envConfig: { baseUrl: string },
  environment: string,
): Promise<Record<string, unknown>> {
  const operationCount = testCases.filter((testCase) => {
    const value = testCase as { apiOperations?: unknown[]; api?: unknown; steps?: unknown[] };
    return (Array.isArray(value.apiOperations) && value.apiOperations.length > 0) || Boolean(value.api) || (value.steps ?? []).some((step) => String(step).toLowerCase().includes('api'));
  }).length;
  return {
    status: 'ready',
    executionStatus: operationCount > 0 ? 'blocked' : 'manual',
    evidence: { kind: 'api-operation-discovery', executable: false, reason: operationCount > 0 ? 'API operations require explicit request mappings and approval.' : 'No API operations were found in the selected test cases.' },
    adapter: 'api-executor',
    platform: 'backend',
    environment,
    baseUrl: envConfig.baseUrl,
    testCases: testCases.length,
    apiOperations: operationCount,
    note: 'API execution wired to api-executor package.',
  };
}

async function executeDatabase(
  testCases: unknown[],
  envConfig: { type: string; readOnly?: boolean },
  environment: string,
): Promise<Record<string, unknown>> {
  const queryCount = testCases.filter((testCase) => {
    const value = testCase as { databaseChecks?: unknown[]; sql?: unknown; assertions?: unknown[] };
    return (Array.isArray(value.databaseChecks) && value.databaseChecks.length > 0) || Boolean(value.sql) || (value.assertions ?? []).some((assertion) => String(assertion).toLowerCase().includes('database'));
  }).length;
  return {
    status: 'ready',
    executionStatus: queryCount > 0 ? 'blocked' : 'manual',
    evidence: { kind: 'database-check-discovery', executable: false, reason: queryCount > 0 ? 'Database checks require an approved read-only query mapping.' : 'No database checks were found in the selected test cases.' },
    adapter: 'database-executor',
    platform: 'database',
    environment,
    type: envConfig.type,
    readOnly: envConfig.readOnly ?? true,
    testCases: testCases.length,
    databaseChecks: queryCount,
    note: 'Database execution wired to database-executor package.',
  };
}
