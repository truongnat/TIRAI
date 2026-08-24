import { spawn } from 'node:child_process';
import type { OfficeCliCommandResult } from './models.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface RunCommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export function runCommand(options: RunCommandOptions): Promise<OfficeCliCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ command: options.command, args: options.args, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode, signal, timedOut });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process already exited */ }
      }
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
      finish(null, 'SIGTERM');
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode, signal) => finish(exitCode, signal));
  });
}
