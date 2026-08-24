import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { BenchmarkEnvironment, BenchmarkGitMetadata } from './models.js';
function command(args: string[]): string | undefined { try { return execFileSync(args[0], args.slice(1), { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim() || undefined; } catch { return undefined; } }
export function collectEnvironment(): BenchmarkEnvironment { return { hostname: os.hostname(), platform: process.platform, architecture: process.arch, osRelease: os.release(), nodeVersion: process.version, cpuModel: os.cpus()[0]?.model, cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() }; }
export function collectGitMetadata(cwd = process.cwd()): BenchmarkGitMetadata { const run = (args:string[]) => { try { return execFileSync('git', ['-C',cwd,...args], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch { return undefined; } }; const status = run(['status','--porcelain']); return { commit: run(['rev-parse','HEAD']), branch: run(['branch','--show-current']), dirty: status !== undefined ? status.length > 0 : undefined }; }
export function cpuModel(): string | undefined { return command(['uname','-p']); }
