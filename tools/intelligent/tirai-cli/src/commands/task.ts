import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { createTask, getTask, loadTaskRegistry } from '../tasks.js';
import { CliError } from '../errors.js';

export async function runTaskCreate(opts: { cwd: string; name: string; sourceCodePath?: string; json?: boolean }): Promise<void> {
  if (!opts.name.trim()) throw new CliError('TASK_INVALID', 'Task name cannot be empty.');
  const paths = requireWorkspace(opts.cwd);
  const task = createTask(paths, opts.name.trim(), opts.sourceCodePath ? path.resolve(opts.cwd, opts.sourceCodePath) : undefined);
  if (opts.json) console.log(JSON.stringify(task, null, 2));
  else console.log(`Task created: ${task.id}\n  Name: ${task.name}\n  Workspace: ${task.workspacePath}\n  Status: ${task.status}`);
}

export async function runTaskList(opts: { cwd: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const registry = loadTaskRegistry(paths);
  if (opts.json) console.log(JSON.stringify(registry, null, 2));
  else if (registry.tasks.length === 0) console.log('No tasks.');
  else console.log(registry.tasks.map((task) => `${task.id}\t${task.status}\t${task.name}${task.id === registry.activeTaskId ? ' [active]' : ''}`).join('\n'));
}

export async function runTaskShow(opts: { cwd: string; taskId: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const task = getTask(paths, opts.taskId);
  if (!task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  if (opts.json) console.log(JSON.stringify(task, null, 2));
  else console.log(JSON.stringify(task, null, 2));
}
