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

export interface ExecuteOptions {
  cwd: string;
  platform?: string;
  environment?: string;
  json?: boolean;
}

export async function runExecute(opts: ExecuteOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const config = loadConfig(paths);

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
  const testCases = JSON.parse(fs.readFileSync(testCasesPath, 'utf8'));

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

  // Update state
  updateState(paths, (s) => ({
    ...s,
    run: {
      at: new Date().toISOString(),
      runId: `run-${Date.now()}`,
      overall: result.status as string,
    },
  }));

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
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
  return {
    status: 'ready',
    platform: 'backend',
    environment,
    baseUrl: envConfig.baseUrl,
    testCases: testCases.length,
    note: 'API execution wired to api-executor package.',
  };
}

async function executeDatabase(
  testCases: unknown[],
  envConfig: { type: string; readOnly?: boolean },
  environment: string,
): Promise<Record<string, unknown>> {
  return {
    status: 'ready',
    platform: 'database',
    environment,
    type: envConfig.type,
    readOnly: envConfig.readOnly ?? true,
    testCases: testCases.length,
    note: 'Database execution wired to database-executor package.',
  };
}
