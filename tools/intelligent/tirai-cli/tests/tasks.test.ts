import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkspacePaths } from '../src/workspace.js';
import { createTask, getTask, loadTaskRegistry, taskPaths, updateTask } from '../src/tasks.js';

describe('task workspaces', () => {
  it('creates an isolated task, marks it active, and persists status updates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-task-'));
    try {
      const paths = getWorkspacePaths(root);
      const task = createTask(paths, 'Todo acceptance', '/project/.example');
      const taskRoot = taskPaths(paths, task.id);

      expect(task.status).toBe('created');
      expect(loadTaskRegistry(paths).activeTaskId).toBe(task.id);
      expect(fs.existsSync(taskRoot.artifacts)).toBe(true);
      expect(getTask(paths, task.id)?.sourceCodePath).toBe('/project/.example');

      const updated = updateTask(paths, task.id, { status: 'contract-ready', contractPath: 'artifacts/contract.json' });
      expect(updated.status).toBe('contract-ready');
      expect(getTask(paths, task.id)?.contractPath).toBe('artifacts/contract.json');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
