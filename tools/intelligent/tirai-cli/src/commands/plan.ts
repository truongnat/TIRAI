// ---------------------------------------------------------------------------
// TIRAI — Plan command

import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';
import { resolveActiveTask, taskPaths } from '../tasks.js';
// ---------------------------------------------------------------------------

export interface PlanOptions {
  cwd: string;
  json?: boolean;
  taskId?: string;
}

export async function runPlan(opts: PlanOptions): Promise<void> {
  const basePaths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(basePaths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const root = task ? taskPaths(basePaths, task.id) : undefined;
  const testPlanPath = root ? path.join(root.artifacts, 'test-plan.json') : basePaths.testPlanPath;
  if (!fs.existsSync(testPlanPath)) throw new CliError('CONFIG_INVALID', 'No canonical test plan found. Run `tirai ingest` first.');
  const plan = JSON.parse(fs.readFileSync(testPlanPath, 'utf8')) as { scenarios?: unknown[]; testCases?: unknown[]; quality?: Record<string, unknown>; metadata?: Record<string, unknown> };
  const summary = { schemaVersion: '1.0', source: testPlanPath, scenarios: plan.scenarios?.length ?? 0, testCases: plan.testCases?.length ?? 0, quality: plan.quality ?? {}, metadata: plan.metadata ?? {} };
  const summaryPath = path.join(root?.artifacts ?? basePaths.artifactsDir, 'plan-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (opts.json) console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  else console.log(`TIRAI plan ready: ${summary.scenarios} scenarios, ${summary.testCases} test cases\n  Summary: ${path.relative(basePaths.root, summaryPath)}`);
}
