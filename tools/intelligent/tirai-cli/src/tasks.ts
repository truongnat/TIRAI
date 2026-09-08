import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkspacePaths } from './workspace.js';
import { atomicWriteJson, ensureDir, readJsonIfExists } from './workspace.js';

export type TaskStatus =
  | 'created'
  | 'ingesting'
  | 'analyzed'
  | 'contract-ready'
  | 'generated'
  | 'executed'
  | 'reported'
  | 'blocked';

export interface TaskRecord {
  id: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  specIds: string[];
  sourceCodePath?: string;
  contractPath?: string;
  artifactManifestPath?: string;
}

export interface TaskRegistry {
  schemaVersion: '1.0';
  activeTaskId?: string;
  tasks: TaskRecord[];
}

export function taskWorkspaceRoot(paths: WorkspacePaths, taskId: string): string {
  return path.join(paths.tasksDir, taskId);
}

export function taskPaths(paths: WorkspacePaths, taskId: string): Record<string, string> {
  const root = taskWorkspaceRoot(paths, taskId);
  return {
    root,
    raw: path.join(root, 'raw'),
    artifacts: path.join(root, 'artifacts'),
    generated: path.join(root, 'generated'),
    results: path.join(root, 'results'),
    reports: path.join(root, 'reports'),
    outputs: path.join(root, 'outputs'),
  };
}

export function loadTaskRegistry(paths: WorkspacePaths): TaskRegistry {
  return readJsonIfExists<TaskRegistry>(paths.tasksIndexPath) ?? { schemaVersion: '1.0', tasks: [] };
}

export function saveTaskRegistry(paths: WorkspacePaths, registry: TaskRegistry): void {
  atomicWriteJson(paths.tasksIndexPath, registry);
}

export function createTask(paths: WorkspacePaths, name: string, sourceCodePath?: string): TaskRecord {
  const now = new Date().toISOString();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'task';
  const suffix = createHash('sha256').update(`${name}\n${now}`).digest('hex').slice(0, 8);
  const id = `task-${slug}-${suffix}`;
  const task = taskPaths(paths, id);
  for (const directory of Object.values(task)) ensureDir(directory);
  const record: TaskRecord = {
    id,
    name,
    status: 'created',
    createdAt: now,
    updatedAt: now,
    workspacePath: path.relative(paths.root, task.root),
    specIds: [],
    ...(sourceCodePath ? { sourceCodePath } : {}),
  };
  const registry = loadTaskRegistry(paths);
  registry.tasks.push(record);
  registry.activeTaskId = id;
  saveTaskRegistry(paths, registry);
  return record;
}

export function getTask(paths: WorkspacePaths, taskId: string): TaskRecord | undefined {
  return loadTaskRegistry(paths).tasks.find((task) => task.id === taskId);
}

export function updateTask(paths: WorkspacePaths, taskId: string, update: Partial<Pick<TaskRecord, 'status' | 'specIds' | 'sourceCodePath' | 'contractPath' | 'artifactManifestPath'>>): TaskRecord {
  const registry = loadTaskRegistry(paths);
  const task = registry.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  Object.assign(task, update, { updatedAt: new Date().toISOString() });
  registry.activeTaskId = taskId;
  saveTaskRegistry(paths, registry);
  return task;
}

export function resolveActiveTask(paths: WorkspacePaths, taskId?: string): TaskRecord | undefined {
  const registry = loadTaskRegistry(paths);
  return getTask(paths, taskId ?? registry.activeTaskId ?? '');
}

export function taskArtifactRoot(paths: WorkspacePaths, taskId: string): string {
  return taskPaths(paths, taskId).artifacts;
}

export function ensureTaskWorkspace(paths: WorkspacePaths, taskId: string): void {
  const record = getTask(paths, taskId);
  if (!record) throw new Error(`Task not found: ${taskId}`);
  for (const directory of Object.values(taskPaths(paths, taskId))) ensureDir(directory);
}
