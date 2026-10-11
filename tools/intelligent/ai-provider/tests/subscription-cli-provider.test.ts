import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAIProvider } from '../src/registry.js';
import { AIProviderErrorCode } from '../src/errors.js';
import type { SubscriptionCLIProviderName } from '../src/providers/subscription-cli-provider.js';

const fixtureDirectories: string[] = [];
const responseSchema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

interface FakeCLIOptions {
  mode?: 'success' | 'invalid-schema' | 'bad-envelope' | 'fail' | 'hang';
  output?: unknown;
}

function installFakeCLI(name: SubscriptionCLIProviderName, options: FakeCLIOptions = {}) {
  const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-test-'));
  fixtureDirectories.push(fixtureDirectory);
  const binaryDirectory = path.join(fixtureDirectory, 'bin');
  const capturePath = path.join(fixtureDirectory, 'capture.json');
  mkdirSync(binaryDirectory);

  const output = options.output ?? (options.mode === 'invalid-schema' ? { answer: 42 } : { answer: 'ok' });
  const scriptPath = path.join(binaryDirectory, name === 'antigravity' ? 'agy' : name);
  const script = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args, stdin, cwd: process.cwd(), apiKeyPresent: Boolean(process.env.GROQ_API_KEY) }));
  const mode = ${JSON.stringify(options.mode ?? 'success')};
  const output = ${JSON.stringify(output)};
  if (mode === 'hang') { while (true) {} }
  if (mode === 'fail') { process.stderr.write('private diagnostic'); process.exit(7); }
  if (${JSON.stringify(name)} === 'codex') {
    const responsePath = args[args.indexOf('-o') + 1];
    writeFileSync(responsePath, JSON.stringify(output));
  } else if (${JSON.stringify(name)} === 'claude') {
    const envelope = mode === 'bad-envelope' ? { result: 'missing structured output' } : { structured_output: output };
    process.stdout.write(JSON.stringify(envelope));
  } else {
    const result = mode === 'bad-envelope' ? { status: 'SUCCESS' } : { status: 'SUCCESS', structured_output: output };
    process.stdout.write(JSON.stringify({ event: 'result', result }) + '\\n');
  }
});
`;

  writeFileSync(scriptPath, script, { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  return { binaryDirectory, capturePath };
}

function waitForFile(filePath: string): Promise<void> {
  if (existsSync(filePath)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = watch(path.dirname(filePath), (_eventType, filename) => {
      if (filename?.toString() === path.basename(filePath) && existsSync(filePath)) {
        watcher.close();
        resolve();
      }
    });
    watcher.on('error', (error) => {
      watcher.close();
      reject(error);
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const processTests = process.platform === 'win32' ? describe.skip : describe;

processTests('subscription-backed CLI providers', () => {
  it.each(['codex', 'claude', 'antigravity'] as const)(
    '%s uses its structured-output CLI protocol in an isolated workspace',
    async (name) => {
      const { binaryDirectory, capturePath } = installFakeCLI(name);
      vi.stubEnv('PATH', `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`);
      vi.stubEnv('GROQ_API_KEY', 'must-not-reach-provider-cli');

      const provider = createAIProvider({ provider: name, config: { model: 'test-model' } });
      const response = await provider.generate({
        messages: [
          { role: 'system', content: 'Return an answer.' },
          { role: 'user', content: 'Say ok.' },
        ],
        responseSchema,
      });

      expect(response.data).toEqual({ answer: 'ok' });
      expect(response.provider).toBe(name);
      expect(response.model).toBe('test-model');
      const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as {
        args: string[];
        stdin: string;
        cwd: string;
        apiKeyPresent: boolean;
      };
      expect(capture.cwd).not.toBe(process.cwd());
      expect(path.basename(capture.cwd).startsWith(`tirai-${name}-`)).toBe(true);
      expect(existsSync(capture.cwd)).toBe(false);
      expect(capture.apiKeyPresent).toBe(false);
      expect(capture.args).toContain('--model');
      expect(capture.args).toContain('test-model');

      if (name === 'codex') {
        expect(capture.args).toContain('--output-schema');
        expect(capture.args).toContain('--ephemeral');
        expect(capture.args).toContain('--ignore-user-config');
        expect(capture.args).toContain('--skip-git-repo-check');
        expect(capture.args).toContain('read-only');
        expect(JSON.parse(capture.stdin)).toHaveLength(2);
      } else if (name === 'claude') {
        expect(capture.args).toContain('--safe-mode');
        expect(capture.args).toContain('--tools');
        expect(capture.args).toContain('--disallowedTools');
        expect(capture.args).toContain('--no-session-persistence');
        expect(capture.args).toContain('--json-schema');
        expect(capture.args).not.toContain('--bare');
        expect(capture.args).not.toContain('--dangerously-skip-permissions');
        expect(JSON.parse(capture.stdin)).toHaveLength(2);
      } else {
        expect(capture.args).toContain('--sandbox');
        expect(capture.args).toContain('stream-json');
        expect(capture.args).toContain('--json-schema');
        expect(capture.args).not.toContain('--dangerously-skip-permissions');
        const input = JSON.parse(capture.stdin) as { event: string; message: { content: string } };
        expect(input.event).toBe('user');
        expect(input.message.content).toContain('TIRAI messages JSON:');
      }
    },
  );

  it('validates returned data locally against the requested schema', async () => {
    const { binaryDirectory } = installFakeCLI('codex', { mode: 'invalid-schema' });
    vi.stubEnv('PATH', `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`);
    const provider = createAIProvider({ provider: 'codex' });

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'Return an answer.' }],
      responseSchema,
    })).rejects.toMatchObject({ code: AIProviderErrorCode.RESPONSE_SCHEMA_ERROR });
  });

  it('maps unsuccessful CLI exits without exposing stderr', async () => {
    const { binaryDirectory } = installFakeCLI('claude', { mode: 'fail' });
    vi.stubEnv('PATH', `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`);
    const provider = createAIProvider({ provider: 'claude' });

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'Return an answer.' }],
      responseSchema,
    })).rejects.toMatchObject({
      code: AIProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: expect.not.stringContaining('private diagnostic'),
    });
  });

  // This exercises OS process termination; fake timers cannot terminate a spawned CLI.
  it('times out and removes the isolated workspace', async () => {
    const { binaryDirectory, capturePath } = installFakeCLI('codex', { mode: 'hang' });
    vi.stubEnv('PATH', `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`);
    const provider = createAIProvider({ provider: 'codex' });

    const timedOut = expect(provider.generate({
      messages: [{ role: 'user', content: 'Return an answer.' }],
      responseSchema,
      timeoutMs: 1500,
    })).rejects.toMatchObject({ code: AIProviderErrorCode.TIMEOUT });
    await waitForFile(capturePath);
    await timedOut;

    const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as { cwd: string };
    expect(existsSync(capture.cwd)).toBe(false);
  });

  it('rejects CLI envelopes without structured output', async () => {
    const { binaryDirectory } = installFakeCLI('claude', { mode: 'bad-envelope' });
    vi.stubEnv('PATH', `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`);
    const provider = createAIProvider({ provider: 'claude' });

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'Return an answer.' }],
      responseSchema,
    })).rejects.toMatchObject({ code: AIProviderErrorCode.MALFORMED_PROVIDER_RESPONSE });
  });

  it('reports missing CLI installation and native login requirements', async () => {
    const binaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'tirai-missing-cli-'));
    fixtureDirectories.push(binaryDirectory);
    vi.stubEnv('PATH', binaryDirectory);
    const provider = createAIProvider({ provider: 'codex' });

    await expect(provider.generate({
      messages: [{ role: 'user', content: 'Return an answer.' }],
      responseSchema,
    })).rejects.toMatchObject({
      code: AIProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: expect.stringContaining('Install it and authenticate'),
    });
  });
});
