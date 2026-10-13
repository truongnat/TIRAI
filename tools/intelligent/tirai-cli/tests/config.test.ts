import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { defaultConfig, loadConfig } from '../src/config.js';
import { getWorkspacePaths } from '../src/workspace.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('CLI configuration', () => {
  it('produces a deterministic default config without AI provider settings', () => {
    const config = defaultConfig('/tmp/project');
    expect(config.version).toBeGreaterThan(0);
    expect(config.project.root).toBe('/tmp/project');
    expect('ai' in config).toBe(false);
  });

  it('loads a valid config from disk', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tirai-config-test-'));
    temporaryDirectories.push(root);
    const paths = getWorkspacePaths(root);
    mkdirSync(paths.workspace, { recursive: true });
    const config = defaultConfig(root);
    writeFileSync(paths.configPath, JSON.stringify(config));

    const loaded = loadConfig(paths);
    expect(loaded.version).toBe(config.version);
    expect(loaded.project.root).toBe(root);
  });

  it('rejects configs with an unsupported version', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tirai-config-test-'));
    temporaryDirectories.push(root);
    const paths = getWorkspacePaths(root);
    mkdirSync(paths.workspace, { recursive: true });
    const config = { ...defaultConfig(root), version: 999 };
    writeFileSync(paths.configPath, JSON.stringify(config));

    expect(() => loadConfig(paths)).toThrow(/Unsupported config version/);
  });
});
