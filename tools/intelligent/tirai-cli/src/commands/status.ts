import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { loadConfig } from '../config.js';
import { loadState } from '../state.js';
import { resolveActiveTask, taskPaths } from '../tasks.js';

export interface StatusOptions {
  cwd: string;
  json?: boolean;
  taskId?: string;
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(paths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new Error(`Task not found: ${opts.taskId}`);
  const taskRoot = task ? taskPaths(paths, task.id) : undefined;
  try {
    loadConfig(paths);
  } catch {
    // ignore
  }
  const state = loadState(paths);
  const taskTestPlanPath = taskRoot ? path.join(taskRoot.artifacts, 'test-plan.json') : undefined;
  const taskTestCasesPath = taskRoot ? path.join(taskRoot.artifacts, 'testcases.json') : undefined;
  const taskTestPlan = taskTestPlanPath && fs.existsSync(taskTestPlanPath)
    ? JSON.parse(fs.readFileSync(taskTestPlanPath, 'utf8')) as { stats?: { testCases?: number }; testCases?: unknown[] }
    : undefined;
  const taskTestCases = taskTestCasesPath && fs.existsSync(taskTestCasesPath)
    ? JSON.parse(fs.readFileSync(taskTestCasesPath, 'utf8')) as unknown[] | { testCases?: unknown[] }
    : undefined;
  const testCaseCount = task
    ? (taskTestPlan?.stats?.testCases ?? (Array.isArray(taskTestCases) ? taskTestCases.length : taskTestCases?.testCases?.length ?? 0))
    : state?.testPlan?.testCaseCount ?? 0;
  const statusState = task ? { ...state, testPlan: { ...state?.testPlan, testCaseCount } } : state;

  const hasE2eMapping = fs.existsSync(paths.e2eMappingPath);
  const hasUnitMapping = fs.existsSync(paths.unitMappingPath);
  let e2eMappingsResolved = 0;
  let e2eMappingsMissing = 0;
  let unitMappingsResolved = 0;
  let unitMappingsMissing = 0;

  if (hasE2eMapping) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths.e2eMappingPath, 'utf8'));
      const mappings = (raw as { testMappings?: unknown[] }).testMappings ?? [];
      e2eMappingsResolved = mappings.filter((m: unknown) => (m as { status?: string }).status === 'ready').length;
      e2eMappingsMissing = mappings.length - e2eMappingsResolved;
      if (mappings.length === 0) e2eMappingsMissing = testCaseCount || 1;
    } catch {
      // ignore
    }
  } else {
    e2eMappingsMissing = testCaseCount;
  }

  if (hasUnitMapping) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths.unitMappingPath, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (raw as { mappings?: unknown[] }).mappings ?? [];
      unitMappingsResolved = Array.isArray(arr) ? arr.length : 0;
      unitMappingsMissing = Math.max(0, testCaseCount - unitMappingsResolved);
    } catch {
      // ignore
    }
  } else {
    unitMappingsMissing = testCaseCount;
  }

  const generatedDir = taskRoot?.generated ?? paths.generatedDir;
  const generatedExists = fs.existsSync(generatedDir) && fs.readdirSync(generatedDir, { recursive: true }).length > 0;
  const specCount = state?.specRegistry?.count ?? 0;

  const lines = [
    ...(task ? [`Task:`, `  ${task.name}`, `  status: ${task.status}`, `  workspace: ${task.workspacePath}`, ''] : []),
    'Workspace:',
    `  ${state ? 'initialized' : 'not initialized'}`,
    '',
    'Source:',
    `  ${state?.source ? path.relative(paths.root, state.source.path) : 'none'}`,
    state?.source ? `  revision: ${state.source.contentHash.slice(0, 8)}` : '',
    '',
    'Specs:',
    `  ${specCount} registered`,
    '',
    'TestCases:',
    `  ${testCaseCount}`,
    '',
    'E2E mappings:',
    `  ${e2eMappingsResolved} resolved`,
    `  ${e2eMappingsMissing} missing`,
    '',
    'Unit mappings:',
    `  ${unitMappingsResolved} resolved`,
    `  ${unitMappingsMissing} missing`,
    '',
    'Generated:',
    `  ${generatedExists ? 'present' : 'stale/missing'}`,
    '',
    'Latest run:',
    `  ${state?.run?.overall ?? 'none'}${state?.run ? ` (${state.run.e2eStatus ?? 'no e2e'}/${state.run.unitStatus ?? 'no unit'})` : ''}`,
  ].filter(Boolean);

  if (opts.json) {
    console.log(JSON.stringify({ task, state: statusState, e2eMappingsResolved, e2eMappingsMissing, unitMappingsResolved, unitMappingsMissing, taskArtifactRoot: taskRoot?.artifacts }, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}
