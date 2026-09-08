import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fingerprintInputs } from './fingerprint.js';
import { collectEnvironment, collectGitMetadata } from './environment.js';
import { calculateStatistics } from './statistics.js';
import { runSample } from './runner.js';
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkResultIR, BenchmarkRunConfig, BenchmarkSample } from './models.js';
export async function runBenchmark(benchmarkId: string, cases: BenchmarkCase[], config: BenchmarkRunConfig, cwd=process.cwd()): Promise<BenchmarkResultIR> {
  const results: BenchmarkCaseResult[]=[];
  for (const testCase of cases) {
    const fingerprints=await fingerprintInputs(testCase.inputArtifacts); const inputBytes=fingerprints.reduce((n,f)=>n+f.sizeBytes,0); const warmupSamples: BenchmarkSample[]=[]; const samples: BenchmarkSample[]=[];
    for(let i=0;i<config.warmupRuns;i++) warmupSamples.push(await runSample(testCase,i,config,inputBytes));
    for(let i=0;i<config.measurementRuns;i++) samples.push(await runSample(testCase,i,config,inputBytes));
    const failed=samples.filter(s=>!s.success); const warnings=samples.flatMap(s=>s.warnings); const peakBudgetBytes=(config.maxPeakRssMB??Infinity)*1024*1024; if((config.maxPeakRssMB??Infinity)<=0 || samples.some(s=>(s.peakRssBytes??0)>peakBudgetBytes)) warnings.push('PEAK_RSS_BUDGET_EXCEEDED'); if(samples.some(s=>s.wallTimeMs>(config.maxWallTimeMs??Infinity))) warnings.push('WALL_TIME_BUDGET_EXCEEDED');
    const status: BenchmarkCaseResult['status'] = failed.length===0 ? 'passed' : failed.length===samples.length ? 'failed' : 'partial';
    results.push({caseId:testCase.id,inputFingerprint:fingerprints,warmupSamples,samples,statistics:calculateStatistics(samples),status,warnings:[...new Set(warnings)]});
  }
  return {schemaVersion:'1.0',benchmarkId,createdAt:new Date().toISOString(),environment:collectEnvironment(),git:collectGitMetadata(cwd),config,cases:results,summary:{casesPassed:results.filter(r=>r.status==='passed').length,casesFailed:results.filter(r=>r.status==='failed').length,casesPartial:results.filter(r=>r.status==='partial').length,warnings:results.flatMap(r=>r.warnings)}};
}
export function writeResult(result: BenchmarkResultIR, outputPath: string, force = false): void { mkdirSync(outputPath,{recursive:true}); const resultPath=`${outputPath}/benchmark-result.json`; if(existsSync(resultPath)&&!force) throw new Error(`BENCHMARK_EXISTS: ${resultPath}; use force to overwrite`); writeFileSync(resultPath,`${JSON.stringify(result,null,2)}\n`); writeFileSync(`${outputPath}/summary.md`,renderSummary(result)); }
export function renderSummary(result: BenchmarkResultIR): string { const lines=[`# Benchmark ${result.benchmarkId}`,'',`- Commit: ${result.git.commit ?? 'unknown'}`,`- Environment: ${result.environment.platform} ${result.environment.architecture}, Node ${result.environment.nodeVersion}`,`- Passed: ${result.summary.casesPassed}`,`- Failed: ${result.summary.casesFailed}`,`- Partial: ${result.summary.casesPartial}`,'','| Case | Status | Median wall ms | Median peak RSS MB |','|---|---:|---:|---:|']; for(const c of result.cases) lines.push(`| ${c.caseId} | ${c.status} | ${c.statistics.wallTimeMs?.median?.toFixed(2) ?? '-'} | ${c.statistics.peakRssBytes ? (c.statistics.peakRssBytes.median/1024/1024).toFixed(2) : '-'} |`); return `${lines.join('\n')}\n`; }
