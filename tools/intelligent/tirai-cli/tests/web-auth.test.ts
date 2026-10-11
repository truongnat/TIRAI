import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { runWebAuthClear, runWebAuthImport } from '../src/commands/web.js';
import { getActiveWebSession, getImportedSessionPath, getManualSessionPath, getWorkflowPaths } from '../src/workflow.js';
import { getWorkspacePaths } from '../src/workspace.js';

const storageState = {
  cookies: [{
    name: 'session',
    value: 'private-session-token',
    domain: 'staging.example.test',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }],
  origins: [{ origin: 'https://staging.example.test', localStorage: [] }],
};

describe('web browser session import', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-web-auth-'));
    const paths = getWorkspacePaths(root);
    fs.mkdirSync(paths.workspace, { recursive: true });
    const config = defaultConfig(root);
    config.platforms.web!.enabled = true;
    config.platforms.web!.environments.staging = { baseUrl: 'https://staging.example.test' };
    fs.writeFileSync(paths.configPath, JSON.stringify(config), 'utf8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stores a valid imported session privately and keeps it reusable', async () => {
    const source = path.join(root, 'storageState.json');
    fs.writeFileSync(source, JSON.stringify(storageState), 'utf8');
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runWebAuthImport({ cwd: root, environment: 'staging', file: source });

    const workflow = getWorkflowPaths(getWorkspacePaths(root));
    const sessionPath = getImportedSessionPath(workflow.runtime, 'staging');
    const activeSession = getActiveWebSession(workflow.runtime, 'staging');
    expect(fs.existsSync(sessionPath)).toBe(true);
    expect(fs.statSync(sessionPath).mode & 0o777).toBe(0o600);
    expect(activeSession).toEqual({ path: sessionPath, consumeAfterExecution: false });
    expect(output.mock.calls.flat().join(' ')).not.toContain('private-session-token');
  });

  it('rejects invalid storageState without creating an imported session', async () => {
    const source = path.join(root, 'invalid.json');
    fs.writeFileSync(source, JSON.stringify({ cookies: [] }), 'utf8');
    const workflow = getWorkflowPaths(getWorkspacePaths(root));

    await expect(runWebAuthImport({ cwd: root, environment: 'staging', file: source })).rejects.toThrow(/storageState/i);
    expect(fs.existsSync(getImportedSessionPath(workflow.runtime, 'staging'))).toBe(false);
  });

  it('does not overwrite an existing session and clear removes imported and temporary sessions by environment', async () => {
    const source = path.join(root, 'storageState.json');
    fs.writeFileSync(source, JSON.stringify(storageState), 'utf8');
    await runWebAuthImport({ cwd: root, environment: 'staging', file: source });
    const workflow = getWorkflowPaths(getWorkspacePaths(root));
    const importedPath = getImportedSessionPath(workflow.runtime, 'staging');
    const originalContents = fs.readFileSync(importedPath, 'utf8');

    fs.writeFileSync(source, JSON.stringify({ ...storageState, cookies: [{ ...storageState.cookies[0], value: 'replacement-token' }] }), 'utf8');
    await expect(runWebAuthImport({ cwd: root, environment: 'staging', file: source })).rejects.toThrow(/already exists/i);
    expect(fs.readFileSync(importedPath, 'utf8')).toBe(originalContents);

    const manualPath = getManualSessionPath(workflow.runtime, 'staging');
    const otherEnvironmentPath = getImportedSessionPath(workflow.runtime, 'dev');
    fs.writeFileSync(manualPath, '{}', 'utf8');
    fs.writeFileSync(otherEnvironmentPath, '{}', 'utf8');
    await runWebAuthClear({ cwd: root, environment: 'staging' });

    expect(fs.existsSync(importedPath)).toBe(false);
    expect(fs.existsSync(manualPath)).toBe(false);
    expect(fs.existsSync(otherEnvironmentPath)).toBe(true);
  });

  it('marks headed-login sessions as one-run and rejects ambiguous dual sessions', () => {
    const workflow = getWorkflowPaths(getWorkspacePaths(root));
    const manualPath = getManualSessionPath(workflow.runtime, 'staging');
    fs.mkdirSync(workflow.runtime, { recursive: true });
    fs.writeFileSync(manualPath, '{}', 'utf8');
    expect(getActiveWebSession(workflow.runtime, 'staging')).toEqual({ path: manualPath, consumeAfterExecution: true });

    fs.writeFileSync(getImportedSessionPath(workflow.runtime, 'staging'), '{}', 'utf8');
    expect(() => getActiveWebSession(workflow.runtime, 'staging')).toThrow(/both temporary and imported/i);
  });
});
