import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { requireWorkspace, ensureDir } from '../workspace.js';
import { loadConfig, validateConfigForRun } from '../config.js';
import { updateState, loadState } from '../state.js';
import { CliError } from '../errors.js';
import {
  mapPlaywrightJsonToRunResult,
  mapVitestJsonToRunResult,
  writeRunResultJson,
  type MapContext,
  type VitestMapContext,
} from 'test-code-generator';

export interface RunOptions {
  cwd: string;
  json?: boolean;
}

function parseJsonLoose(s: string): unknown | null {
  const i = s.indexOf('{');
  if (i < 0) return null;
  const j = s.lastIndexOf('}');
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

function tiraiRoot(): string {
  // dist/commands -> src/commands -> tirai-cli -> intelligent -> tools -> TIRAI
  try {
    const url = new URL(import.meta.url);
    const dir = path.dirname(url.pathname);
    // dist/commands/run.js -> dist -> tirai-cli -> intelligent -> tools -> root
    return path.resolve(dir, '..', '..', '..', '..', '..');
  } catch {
    return process.cwd();
  }
}

function runCmd(cmd: string, args: string[], cwd: string, extraEnv?: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
    // Ensure Playwright/Vitest can resolve from TIRAI's node_modules when project is outside TIRAI (e.g., /tmp)
    const repoNodeModules = path.join(tiraiRoot(), 'node_modules');
    if (fs.existsSync(repoNodeModules)) {
      const sep = process.platform === 'win32' ? ';' : ':';
      env.NODE_PATH = [env.NODE_PATH, path.join(cwd, 'node_modules'), repoNodeModules].filter(Boolean).join(sep);
    }
    const child = spawn(cmd, args, { cwd, env: env as NodeJS.ProcessEnv });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ code, out, err }));
    child.on('error', (e) => resolve({ code: -1, out, err: err + String(e) }));
  });
}

function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest);
  if (!fs.existsSync(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

function cleanDir(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

async function startServer(startCommand: string, cwd: string, env: Record<string, string>): Promise<ChildProcess | null> {
  if (!startCommand) return null;
  // startCommand is like "node server.mjs" or "npm run dev"
  const parts = startCommand.split(' ').filter(Boolean);
  const cmd = parts[0];
  const args = parts.slice(1);
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait a bit for ready (simple delay + check)
  await new Promise((r) => setTimeout(r, 2000));
  if (child.exitCode !== null) {
    throw new CliError('INFRA_ERROR', `E2E start command failed: ${startCommand} exited ${child.exitCode}`);
  }
  return child;
}

function killServer(child: ChildProcess | null): void {
  if (!child) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore
  }
}

export async function runRun(opts: RunOptions): Promise<number> {
  const paths = requireWorkspace(opts.cwd);
  const config = loadConfig(paths);
  validateConfigForRun(config);

  const state = loadState(paths);
  if (!state?.generation) {
    throw new CliError('CONFIG_INVALID', 'No generated tests found. Run `tirai generate` first.');
  }

  // Check generated artifacts exist
  const hasE2eGenerated = fs.existsSync(paths.generatedE2eDir) && fs.readdirSync(paths.generatedE2eDir).some((f) => f.endsWith('.spec.ts'));
  const hasUnitGenerated = fs.existsSync(paths.generatedUnitDir) && fs.readdirSync(paths.generatedUnitDir).some((f) => f.endsWith('.spec.ts'));
  if (!hasE2eGenerated && !hasUnitGenerated) {
    throw new CliError('CONFIG_INVALID', 'No generated test files found. Run `tirai generate` first.');
  }

  // Load TestCases for mapping context
  let testCases: any[] = [];
  if (fs.existsSync(paths.testCasesPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths.testCasesPath, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (raw as { testCases?: unknown[] }).testCases ?? [];
      testCases = arr as any[];
    } catch {
      // ignore
    }
  }

  // Materialize to runtime (separated from canonical artifacts)
  cleanDir(paths.runtimeE2eDir);
  cleanDir(paths.runtimeUnitDir);
  copyDirRecursive(paths.generatedE2eDir, paths.runtimeE2eDir);
  copyDirRecursive(paths.generatedUnitDir, paths.runtimeUnitDir);

  // Playwright ignores hidden directories (dotfiles) — .tirai/runtime is hidden, so explicit file args still yield 0 tests.
  // To avoid the Phase 5.4 gitignore/hidden bug, we also materialize E2E tests to a non-hidden, non-gitignored exec dir.
  const e2eExecDir = path.join(paths.root, 'tirai-runtime', 'e2e');
  cleanDir(e2eExecDir);
  copyDirRecursive(paths.generatedE2eDir, e2eExecDir);

  // Ensure Playwright/Vitest can resolve from the project's node_modules.
  // When the workspace is outside the TIRAI repo (e.g., /tmp), the project has no node_modules and the test's
  // `import { test } from "@playwright/test"` would resolve via NODE_PATH to TIRAI's copy, causing a
  // "two different versions of @playwright/test" error. Creating a symlink makes both runner and test resolve to the same copy.
  const repoNodeModules = path.join(tiraiRoot(), 'node_modules');
  const projectNodeModules = path.join(paths.root, 'node_modules');
  if (fs.existsSync(repoNodeModules)) {
    try {
      const stat = fs.existsSync(projectNodeModules) ? fs.lstatSync(projectNodeModules) : null;
      const isSymlink = stat?.isSymbolicLink();
      const isDir = stat?.isDirectory();
      if (!stat) {
        fs.symlinkSync(repoNodeModules, projectNodeModules, 'dir');
      } else if (isDir && !isSymlink) {
        // Existing real directory (e.g., vitest cache .vite) — keep it, but ensure @playwright/test is resolvable via NODE_PATH fallback.
        // Do not overwrite.
      }
    } catch {
      // ignore symlink errors
    }
  }

  const rel = (p: string) => path.relative(paths.root, p);

  // Start E2E server if configured
  let server: ChildProcess | null = null;
  if (config.e2e.startCommand) {
    const env: Record<string, string> = {};
    // Pass baseUrl port env if needed
    try {
      const url = new URL(config.e2e.baseUrl);
      if (url.port) env.PORT = url.port;
    } catch {
      // ignore
    }
    server = await startServer(config.e2e.startCommand, paths.root, env);
  }

  let e2eStatus: string | undefined;
  let unitStatus: string | undefined;
  let e2eResult: unknown = null;
  let unitResult: unknown = null;
  let e2eDiscovered = 0;
  let unitDiscovered = 0;
  let overallStatus: 'passed' | 'failed' | 'error' | 'partial' = 'passed';
  let hasError = false;
  let hasFail = false;
  const hasBlocked = false;

  try {
    // --- Playwright ---
    if (hasE2eGenerated) {
      const e2eFiles = fs.readdirSync(e2eExecDir).filter((f) => f.endsWith('.spec.ts')).map((f) => path.join(e2eExecDir, f));
      if (e2eFiles.length === 0) {
        // Empty run -> ERROR
        hasError = true;
        overallStatus = 'error';
        console.error('ERROR: No E2E tests discovered in runtime workspace');
        // Still need to map as error? We will create a synthetic error result
        e2eStatus = 'error';
        const emptyCtx: MapContext = {
          runId: `e2e-${Date.now()}`,
          framework: 'playwright',
          executionMode: 'GENERATED_E2E',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          testCases: testCases as unknown as MapContext['testCases'],
          mapping: { testMappings: [], unresolved: [], catalogs: {}, quality: {} } as unknown as MapContext['mapping'],
          titleToTestCaseId: new Map(),
        };
        const mappedEmpty = mapPlaywrightJsonToRunResult({ suites: [] } as unknown as Parameters<typeof mapPlaywrightJsonToRunResult>[0], emptyCtx);
        e2eResult = mappedEmpty.result;
        // persist
        ensureDir(paths.resultsDir);
        writeRunResultJson(paths.e2eResultPath, e2eResult as Parameters<typeof writeRunResultJson>[1]);
      } else {
        // Run with explicit file args to ensure discovery despite gitignore
        const args = ['playwright', 'test', ...e2eFiles.map(rel), '--reporter=json'];
        const res = await runCmd('npx', args, paths.root);
        const report = parseJsonLoose(res.out) as unknown;
        // Persist raw
        ensureDir(path.dirname(paths.e2eResultPath));
        fs.mkdirSync(path.dirname(paths.e2eResultPath), { recursive: true });
        fs.writeFileSync(path.join(paths.resultsDir, 'playwright-result.json'), JSON.stringify(report ?? { raw: res.out, err: res.err }, null, 2), 'utf8');

        if (!report || typeof report !== 'object' || !('suites' in (report as Record<string, unknown>))) {
          // Infra error: runner crashed
          hasError = true;
          overallStatus = 'error';
          console.error('ERROR: Playwright runner failed to produce report');
          e2eStatus = 'error';
          // Create error result via mapper with empty
          const emptyCtx: MapContext = {
            runId: `e2e-${Date.now()}`,
            framework: 'playwright',
            executionMode: 'GENERATED_E2E',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            testCases: testCases as unknown as MapContext['testCases'],
            mapping: { testMappings: [], unresolved: [], catalogs: {}, quality: {} } as unknown as MapContext['mapping'],
            titleToTestCaseId: new Map(testCases.map((tc: any) => [tc.title, tc.id])),
          };
          const mappedEmpty = mapPlaywrightJsonToRunResult({ suites: [] } as unknown as Parameters<typeof mapPlaywrightJsonToRunResult>[0], emptyCtx);
          e2eResult = mappedEmpty.result;
          writeRunResultJson(paths.e2eResultPath, e2eResult as Parameters<typeof writeRunResultJson>[1]);
        } else {
          const titleMap = new Map(testCases.map((tc: any) => [tc.title, tc.id]));
          const ctx: MapContext = {
            runId: `e2e-${Date.now()}`,
            framework: 'playwright',
            executionMode: 'GENERATED_E2E',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            testCases: testCases as unknown as MapContext['testCases'],
            mapping: { testMappings: [], unresolved: [], catalogs: {}, quality: {} } as unknown as MapContext['mapping'],
            titleToTestCaseId: titleMap,
          };
          const mapped = mapPlaywrightJsonToRunResult(report as unknown as Parameters<typeof mapPlaywrightJsonToRunResult>[0], ctx);
          e2eResult = mapped.result;
          writeRunResultJson(paths.e2eResultPath, e2eResult as Parameters<typeof writeRunResultJson>[1]);
          e2eDiscovered = (e2eResult as { summary: { testsTotal: number } }).summary.testsTotal;
          e2eStatus = (e2eResult as { status: string }).status;
          if (e2eDiscovered === 0) {
            hasError = true;
            overallStatus = 'error';
            console.error('ERROR: Playwright discovered 0 tests');
          } else if (e2eStatus === 'failed' || e2eStatus === 'partial') {
            hasFail = true;
            if ((overallStatus as string) !== 'error') overallStatus = 'failed';
          } else if (e2eStatus === 'error') {
            hasError = true;
            overallStatus = 'error';
          }
        }
      }
    }

    // --- Vitest ---
    if (hasUnitGenerated) {
      const unitFiles = fs.readdirSync(paths.runtimeUnitDir).filter((f) => f.endsWith('.spec.ts')).map((f) => path.join(paths.runtimeUnitDir, f));
      if (unitFiles.length === 0) {
        hasError = true;
        overallStatus = 'error';
        console.error('ERROR: No Unit tests discovered in runtime workspace');
        unitStatus = 'error';
        const emptyCtx: VitestMapContext = {
          runId: `unit-${Date.now()}`,
          framework: 'vitest',
          executionMode: 'GENERATED_UNIT',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          testCases: testCases as unknown as VitestMapContext['testCases'],
          titleToTestCaseId: new Map(),
        };
        const mappedEmpty = mapVitestJsonToRunResult({ testResults: [] } as unknown as Parameters<typeof mapVitestJsonToRunResult>[0], emptyCtx);
        unitResult = mappedEmpty.result;
        writeRunResultJson(paths.unitResultPath, unitResult as Parameters<typeof writeRunResultJson>[1]);
      } else {
        const args = ['vitest', 'run', ...unitFiles.map(rel), '--reporter=json'];
        const res = await runCmd('npx', args, paths.root);
        const report = parseJsonLoose(res.out) as unknown;
        fs.writeFileSync(path.join(paths.resultsDir, 'vitest-result.json'), JSON.stringify(report ?? { raw: res.out, err: res.err }, null, 2), 'utf8');
        if (!report || typeof report !== 'object' || !('testResults' in (report as Record<string, unknown>))) {
          hasError = true;
          overallStatus = 'error';
          console.error('ERROR: Vitest runner failed to produce report');
          unitStatus = 'error';
          const emptyCtx: VitestMapContext = {
            runId: `unit-${Date.now()}`,
            framework: 'vitest',
            executionMode: 'GENERATED_UNIT',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            testCases: testCases as unknown as VitestMapContext['testCases'],
            titleToTestCaseId: new Map(testCases.map((tc: any) => [tc.title, tc.id])),
          };
          const mappedEmpty = mapVitestJsonToRunResult({ testResults: [] } as unknown as Parameters<typeof mapVitestJsonToRunResult>[0], emptyCtx);
          unitResult = mappedEmpty.result;
          writeRunResultJson(paths.unitResultPath, unitResult as Parameters<typeof writeRunResultJson>[1]);
        } else {
          const titleMap = new Map(testCases.map((tc: any) => [tc.title, tc.id]));
          const ctx: VitestMapContext = {
            runId: `unit-${Date.now()}`,
            framework: 'vitest',
            executionMode: 'GENERATED_UNIT',
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            testCases: testCases as unknown as VitestMapContext['testCases'],
            titleToTestCaseId: titleMap,
          };
          const mapped = mapVitestJsonToRunResult(report as unknown as Parameters<typeof mapVitestJsonToRunResult>[0], ctx);
          unitResult = mapped.result;
          writeRunResultJson(paths.unitResultPath, unitResult as Parameters<typeof writeRunResultJson>[1]);
          unitDiscovered = (unitResult as { summary: { testsTotal: number } }).summary.testsTotal;
          unitStatus = (unitResult as { status: string }).status;
          if (unitDiscovered === 0) {
            hasError = true;
            overallStatus = 'error';
            console.error('ERROR: Vitest discovered 0 tests');
          } else if (unitStatus === 'failed' || unitStatus === 'partial') {
            hasFail = true;
            if ((overallStatus as string) !== 'error') overallStatus = 'failed';
          } else if (unitStatus === 'error') {
            hasError = true;
            overallStatus = 'error';
          }
        }
      }
    }

    // If both had zero discovered, overall is error
    if ((hasE2eGenerated && e2eDiscovered === 0) || (hasUnitGenerated && unitDiscovered === 0)) {
      hasError = true;
      overallStatus = 'error';
    }

    // Update state with run info
    const runId = `run-${Date.now()}`;
    updateState(paths, (s) => ({
      ...s,
      run: {
        at: new Date().toISOString(),
        runId,
        e2eStatus,
        unitStatus,
        overall: overallStatus,
      },
    }));

    // Determine exit code
    let exitCode = 0;
    if (hasError || hasBlocked) exitCode = 2;
    else if (hasFail) exitCode = 1;
    else exitCode = 0;

    // Print summary
    if (!opts.json) {
      console.log(`TIRAI run complete: ${overallStatus.toUpperCase()}`);
      if (e2eStatus) console.log(`  E2E: ${e2eStatus} (${e2eDiscovered} tests)`);
      if (unitStatus) console.log(`  Unit: ${unitStatus} (${unitDiscovered} tests)`);
      console.log(`  Results: ${path.relative(paths.root, paths.resultsDir)}/`);
    } else {
      console.log(JSON.stringify({ e2eStatus, unitStatus, overall: overallStatus, e2eDiscovered, unitDiscovered }, null, 2));
    }

    return exitCode;
  } finally {
    killServer(server);
  }
}
