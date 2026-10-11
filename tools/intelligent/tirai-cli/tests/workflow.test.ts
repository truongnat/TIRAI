import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePrivateWorkspaceArtifactsIgnored, getWorkflowPaths } from '../src/workflow.js';
import { getWorkspacePaths } from '../src/workspace.js';

describe('private workspace artifact ignore rules', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-workflow-ignore-'));
    fs.mkdirSync(path.join(root, '.tirai'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('adds the runtime ignore rule even to an existing TIRAI ignore file', () => {
    const ignorePath = path.join(root, '.tirai', '.gitignore');
    fs.writeFileSync(ignorePath, '# TIRAI web-testing workflow artifacts\nresults/\n', 'utf8');
    const paths = getWorkspacePaths(root);
    const workflow = getWorkflowPaths(paths);
    expect(workflow.runs).toBe(path.join(paths.workspace, 'workflow', 'runs'));
    expect(workflow.runtime).toBe(path.join(paths.workspace, 'workflow', 'runtime'));

    ensurePrivateWorkspaceArtifactsIgnored(paths);
    const firstWrite = fs.readFileSync(ignorePath, 'utf8');
    ensurePrivateWorkspaceArtifactsIgnored(paths);

    expect(firstWrite).toContain('artifacts/ai/');
    expect(firstWrite).toContain('artifacts/ai-input.json');
    expect(firstWrite).toContain('workflow/runtime/');
    expect(fs.readFileSync(ignorePath, 'utf8')).toBe(firstWrite);
  });
});
