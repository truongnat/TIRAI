import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');

function run(args: string[], cwd: string, env?: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => resolve({ code, out, err }));
  });
}

describe('tirai CLI', () => {
  it('shows help', async () => {
    const r = await run(['--help'], REPO);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tirai');
    expect(r.out).toContain('init');
  });

  it('shows version', async () => {
    const r = await run(['--version'], REPO);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tirai');
  });

  it('workspace resolution and config validation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-test-'));
    try {
      // No workspace -> generate should fail with WORKSPACE_NOT_FOUND
      let r = await run(['generate'], tmp);
      expect(r.code).toBe(2);
      expect(r.err).toContain('WORKSPACE_NOT_FOUND');

      // Init should create workspace
      r = await run(['init'], tmp);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.tirai/config.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmp, '.tirai/state/workspace.json'))).toBe(true);
      const cfg = JSON.parse(fs.readFileSync(path.join(tmp, '.tirai/config.json'), 'utf8'));
      expect(cfg.version).toBe(2);
      expect(cfg.workspaceVersion).toBe(1);

      // Second init without --force should fail
      r = await run(['init'], tmp);
      expect(r.code).toBe(2);
      expect(r.err).toContain('WORKSPACE_ALREADY_EXISTS');

      // Init with --force should succeed
      r = await run(['init', '--force'], tmp);
      expect(r.code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reads canonical test plan and writes a summary', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-plan-'));
    try {
      expect((await run(['init'], tmp)).code).toBe(0);
      const artifacts = path.join(tmp, '.tirai', 'artifacts');
      fs.writeFileSync(path.join(artifacts, 'test-plan.json'), JSON.stringify({
        scenarios: [{ id: 'SCN-1' }], testCases: [{ id: 'TC-1' }], quality: { coverageRate: 1 }, metadata: { promptVersion: 'test' },
      }));
      const result = await run(['plan', '--json'], tmp);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out).testCases).toBe(1);
      expect(fs.existsSync(path.join(artifacts, 'plan-summary.json'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exit code mapping for missing source', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-test-'));
    try {
      await run(['init'], tmp);
      const r = await run(['ingest', './nope.xlsx'], tmp);
      expect(r.code).toBe(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('ingests raw source artifacts and awaits host-agent canonical IR', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-host-agent-'));
    try {
      fs.writeFileSync(path.join(tmp, 'spec.md'), '# Requirement\n\nThe todos page shows current tasks.\n');
      expect((await run(['init'], tmp)).code).toBe(0);

      const result = await run(['ingest', './spec.md'], tmp);
      expect(result.code, result.err || result.out).toBe(0);
      expect(result.out).toContain('awaiting-agent');
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/ai-input.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/contract.json'))).toBe(false);
      expect(fs.existsSync(path.join(tmp, '.tirai/artifacts/testcases.json'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('returns blocked exit status and reports API preparation-only execution', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-execute-status-'));
    try {
      expect((await run(['init'], tmp)).code).toBe(0);
      expect((await run(['target', 'add', 'backend', 'staging', '--url', 'https://api.staging.example.test'], tmp)).code).toBe(0);
      fs.writeFileSync(path.join(tmp, '.tirai/artifacts/testcases.json'), JSON.stringify([{ id: 'TC-1', title: 'API case' }]));

      const execution = await run(['execute', '--platform', 'backend', '--environment', 'staging'], tmp);
      expect(execution.code).toBe(2);
      expect(execution.out).toContain('TIRAI execute complete: ready');

      const report = await run(['report', '--json'], tmp);
      expect(report.code).toBe(0);
      expect(JSON.parse(report.out).overall).toBe('MANUAL');
      expect(fs.readFileSync(path.join(tmp, '.tirai/reports/latest-summary.md'), 'utf8')).toContain('manual');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('imports a private reusable storageState session through the CLI and clears it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tirai-cli-auth-import-'));
    try {
      expect((await run(['init'], tmp)).code).toBe(0);
      const configPath = path.join(tmp, '.tirai', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.platforms.web.enabled = true;
      config.platforms.web.environments.staging = { baseUrl: 'https://staging.example.test' };
      fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');

      const secret = 'session-token-must-not-print';
      const statePath = path.join(tmp, 'storageState.json');
      fs.writeFileSync(statePath, JSON.stringify({
        cookies: [{ name: 'session', value: secret, domain: 'staging.example.test', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }],
        origins: [{ origin: 'https://staging.example.test', localStorage: [] }],
      }), 'utf8');

      const imported = await run(['auth', 'import', '--environment', 'staging', '--file', statePath, '--json'], tmp);
      expect(imported.code).toBe(0);
      expect(imported.out).toContain('"status": "imported"');
      expect(imported.out).not.toContain(secret);
      const importedPath = path.join(tmp, '.tirai', 'workflow', 'runtime', 'imported-session-staging.json');
      expect(fs.existsSync(importedPath)).toBe(true);
      expect(fs.statSync(importedPath).mode & 0o777).toBe(0o600);

      const cleared = await run(['auth', 'clear', '--environment', 'staging', '--json'], tmp);
      expect(cleared.code).toBe(0);
      expect(fs.existsSync(importedPath)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
