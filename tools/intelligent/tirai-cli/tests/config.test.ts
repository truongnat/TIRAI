import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../src/errors.js';
import { defaultConfig, loadConfig, validateAIProviderConfig } from '../src/config.js';
import { getWorkspacePaths } from '../src/workspace.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
describe('AI provider configuration', () => {
  it('accepts an artifact-first CLI command', () => {
    expect(() => validateAIProviderConfig({
      provider: 'cli', command: 'agent --input {input} --output {output}',
    })).not.toThrow();
  });

  it('rejects a CLI command without both artifact placeholders', () => {
    expect(() => validateAIProviderConfig({
      provider: 'cli', command: 'agent --input {input}',
    })).toThrowError(CliError);
    expect(() => validateAIProviderConfig({
      provider: 'cli', command: 'agent --output {output}',
    })).toThrow(/both \{input\} and \{output\}/);
  });

  it.each(['codex', 'claude', 'antigravity'])(
    'accepts the %s subscription CLI without requiring an API-key field',
    (provider) => {
      expect(() => validateAIProviderConfig({ provider })).not.toThrow();
    },
  );

  it.each(['codex', 'claude', 'antigravity'] as const)(
    'loads %s config without requiring API-key environment variables',
    (provider) => {
      vi.stubEnv('GROQ_API_KEY', '');
      vi.stubEnv('DEEPSEEK_API_KEY', '');
      const root = mkdtempSync(path.join(os.tmpdir(), 'tirai-config-test-'));
      temporaryDirectories.push(root);
      const paths = getWorkspacePaths(root);
      mkdirSync(paths.workspace, { recursive: true });
      const config = defaultConfig(root);
      config.ai.provider = provider;
      writeFileSync(paths.configPath, JSON.stringify(config));

      expect(loadConfig(paths).ai.provider).toBe(provider);
    },
  );

  it('rejects unknown provider identifiers', () => {
    expect(() => validateAIProviderConfig({ provider: 'unknown' as never }))
      .toThrow(/Unsupported ai\.provider/);
  });
});
