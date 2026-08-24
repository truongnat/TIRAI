import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import type { BenchmarkCase, BenchmarkRunConfig, BenchmarkSample } from './models.js';
import { ProcessSampler } from './process-monitor.js';
export async function runSample(testCase: BenchmarkCase, runIndex: number, config: BenchmarkRunConfig, inputBytes?: number): Promise<BenchmarkSample> {
  const started = new Date(); const startMs = performance.now(); const args = testCase.target.args;
  return new Promise(resolve => {
    const child = spawn(testCase.target.command, args, { cwd: testCase.target.cwd, env: { ...process.env, ...testCase.target.env }, shell: false });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let timedOut = false; let settled = false;
    child.stdout.on('data', b => { stdout = Buffer.concat([stdout, Buffer.from(b)]); }); child.stderr.on('data', b => { stderr = Buffer.concat([stderr, Buffer.from(b)]); });
    const sampler = child.pid ? new ProcessSampler(child.pid, config.memorySampleIntervalMs) : undefined; sampler?.start();
    const timeoutMs = config.timeoutMs ?? testCase.target.timeoutMs; const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 250); }, timeoutMs);
    child.on('error', error => { if (settled) return; settled = true; clearTimeout(timeout); const metrics=sampler?.stop() ?? {}; resolve(makeSample()); function makeSample(): BenchmarkSample { const wallTimeMs=performance.now()-startMs; return { runIndex,startedAt:started.toISOString(),finishedAt:new Date().toISOString(),wallTimeMs,cpuUserMs:metrics.cpuUserMs,cpuSystemMs:metrics.cpuSystemMs,cpuTotalMs:sum(metrics.cpuUserMs,metrics.cpuSystemMs),peakRssBytes:metrics.rssBytes,inputBytes,outputBytes:outputSize(testCase) ?? stdout.length + stderr.length,stdoutBytes:stdout.length,stderrBytes:stderr.length,outputHash:hashOutput(stdout,stderr),success:false,timeout:timedOut,warnings:[error.message]}; } });
    child.on('close', (exitCode, signal) => { if (settled) return; settled=true; clearTimeout(timeout); const metrics=sampler?.stop() ?? {}; const success=!timedOut && exitCode===0; const context={stdout:stdout.toString(),stderr:stderr.toString(),exitCode:exitCode ?? undefined,success}; let domainMetrics; const warnings:string[]=[]; try { domainMetrics=testCase.target.parser?.(context); } catch (error) { warnings.push(`DOMAIN_METRICS_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`); } const wallTimeMs=performance.now()-startMs; resolve({runIndex,startedAt:started.toISOString(),finishedAt:new Date().toISOString(),wallTimeMs,cpuUserMs:metrics.cpuUserMs,cpuSystemMs:metrics.cpuSystemMs,cpuTotalMs:sum(metrics.cpuUserMs,metrics.cpuSystemMs),peakRssBytes:metrics.rssBytes,inputBytes,outputBytes:outputSize(testCase) ?? stdout.length + stderr.length,stdoutBytes:stdout.length,stderrBytes:stderr.length,outputHash:hashOutput(stdout,stderr),exitCode:exitCode ?? undefined,signal:signal ?? undefined,success,timeout:timedOut,domainMetrics,warnings}); });
  });
}
function sum(a?:number,b?:number):number|undefined { return a === undefined && b === undefined ? undefined : (a ?? 0)+(b ?? 0); }
function outputSize(testCase: BenchmarkCase): number|undefined { if (!testCase.target.outputPaths?.length) return undefined; return testCase.target.outputPaths.reduce((n,p) => { try { return n + statSync(p).size; } catch { return n; } }, 0); }
function hashOutput(stdout: Buffer, stderr: Buffer): string { return createHash('sha256').update(stdout).update(stderr).digest('hex'); }
export function commandDescription(testCase: BenchmarkCase): string { return [testCase.target.command,...testCase.target.args].join(' '); }
