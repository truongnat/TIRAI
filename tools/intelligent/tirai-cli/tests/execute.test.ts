import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runExecute } from '../src/commands/execute.js';
import { runTargetAdd } from '../src/commands/target.js';
import { getWorkspacePaths } from '../src/workspace.js';

describe('execute command', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-execute-'));
    // Initialize workspace
    fs.mkdirSync(path.join(tmp, '.tirai', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.tirai', 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.tirai', 'config.json'), JSON.stringify({
      version: 2,
      workspaceVersion: 1,
      ai: { provider: 'fake', model: 'fake-model' },
      project: { root: tmp, defaultEnvironment: 'local', defaultLanguage: 'en' },
      platforms: {},
      source: {},
      e2e: { baseUrl: 'http://localhost:4173' },
      unit: { projectRoot: tmp, language: 'typescript' },
    }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.tirai', 'specs', 'index.json'), JSON.stringify({ specs: [] }), 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('requires platform to be configured', async () => {
    let error: Error | null = null;
    try {
      await runExecute({ cwd: tmp, platform: 'web' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain('not configured');
  });

  it('executes for configured web platform', async () => {
    await runTargetAdd({ cwd: tmp, platform: 'web', environment: 'staging', url: 'https://staging.example.com' });
    const paths = getWorkspacePaths(tmp);
    fs.writeFileSync(paths.testCasesPath, JSON.stringify([
      { id: 'TC-001', title: 'test' },
    ]), 'utf8');

    let error: Error | null = null;
    try {
      await runExecute({ cwd: tmp, platform: 'web', environment: 'staging' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeNull();
  });

  it('executes for configured backend platform', async () => {
    await runTargetAdd({ cwd: tmp, platform: 'backend', environment: 'staging', url: 'https://api.example.com' });
    const paths = getWorkspacePaths(tmp);
    fs.writeFileSync(paths.testCasesPath, JSON.stringify([
      { id: 'TC-001', title: 'test' },
    ]), 'utf8');

    let error: Error | null = null;
    try {
      await runExecute({ cwd: tmp, platform: 'backend', environment: 'staging' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeNull();
  });

  it('executes for configured database platform', async () => {
    await runTargetAdd({ cwd: tmp, platform: 'database', environment: 'staging', url: 'env:TIRAI_DATABASE_URL' });
    const paths = getWorkspacePaths(tmp);
    fs.writeFileSync(paths.testCasesPath, JSON.stringify([
      { id: 'TC-001', title: 'test' },
    ]), 'utf8');

    let error: Error | null = null;
    try {
      await runExecute({ cwd: tmp, platform: 'database', environment: 'staging' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeNull();
  });
});
