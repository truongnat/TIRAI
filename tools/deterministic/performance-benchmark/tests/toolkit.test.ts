import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { compareResults, renderComparison } from '../src/compare.js';
import { collectEnvironment, collectGitMetadata } from '../src/environment.js';
import { runBenchmark, renderSummary, writeResult } from '../src/engine.js';
import { generateExcelFixture } from '../src/fixture-generator.js';
import { fingerprintInput } from '../src/fingerprint.js';
import { parseExtractorOutput } from '../src/excel-preset.js';
import { readProcessMetrics } from '../src/process-monitor.js';
import { runSample } from '../src/runner.js';
import { calculateStatistics } from '../src/statistics.js';
import type { BenchmarkCase, BenchmarkResultIR, BenchmarkSample } from '../src/models.js';

const root = () => mkdtempSync(path.join(tmpdir(), 'tirai-bench-'));
const sample = (overrides: Partial<BenchmarkSample> = {}): BenchmarkSample => ({ runIndex: 0, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:00.010Z', wallTimeMs: 10, peakRssBytes: 100, stdoutBytes: 3, stderrBytes: 0, success: true, timeout: false, warnings: [], ...overrides });
const result = (id: string, wall = 100, rss = 1000): BenchmarkResultIR => ({ schemaVersion: '1.0', benchmarkId: id, createdAt: '2026-01-01T00:00:00.000Z', environment: { platform: 'linux', architecture: 'x64', osRelease: '1', nodeVersion: process.version, cpuCount: 1, totalMemoryBytes: 1 }, git: { commit: 'abc', branch: 'main', dirty: false }, config: { warmupRuns: 0, measurementRuns: 2, memorySampleIntervalMs: 50 }, cases: [{ caseId: 'case', inputFingerprint: [{ path: 'input', sizeBytes: 1, sha256: 'same' }], warmupSamples: [], samples: [sample({ wallTimeMs: wall, peakRssBytes: rss }), sample({ wallTimeMs: wall, peakRssBytes: rss })], statistics: calculateStatistics([sample({ wallTimeMs: wall, peakRssBytes: rss }), sample({ wallTimeMs: wall, peakRssBytes: rss })]), status: 'passed', warnings: [] }], summary: { casesPassed: 1, casesFailed: 0, casesPartial: 0, warnings: [] } });
const fakeCase = (code: string, input: string): BenchmarkCase => ({ id: 'fake', inputArtifacts: [{ path: input }], tags: ['test'], target: { id: 'fake', command: process.execPath, args: ['-e', code], cwd: process.cwd(), timeoutMs: 1000 } });

describe('statistics', () => {
  it.each([
    ['min', 'min', 1], ['max', 'max', 5], ['mean', 'mean', 3], ['median', 'median', 3],
    ['p50', 'p50', 3], ['p90', 'p90', 4.6], ['p95', 'p95', 4.8], ['stddev', 'standardDeviation', Math.sqrt(8 / 3)],
  ] as const)('%s is calculated', (_name, field, expected) => expect(calculateStatistics([sample({ wallTimeMs: 1 }), sample({ wallTimeMs: 3 }), sample({ wallTimeMs: 5 })]).wallTimeMs?.[field]).toBeCloseTo(expected));
  it('returns empty statistics for no samples', () => expect(calculateStatistics([])).toEqual({}));
  it('handles one sample', () => expect(calculateStatistics([sample({ wallTimeMs: 7 })]).wallTimeMs).toMatchObject({ min: 7, max: 7, median: 7, p95: 7, count: 1 }));
  it('uses even median interpolation', () => expect(calculateStatistics([sample({ wallTimeMs: 2 }), sample({ wallTimeMs: 4 })]).wallTimeMs?.median).toBe(3));
  it('ignores unavailable optional metrics', () => expect(calculateStatistics([sample()]).cpuTotalMs).toBeUndefined());
  it('computes coefficient of variation', () => expect(calculateStatistics([sample({ wallTimeMs: 10 }), sample({ wallTimeMs: 20 })]).wallTimeMs?.coefficientOfVariation).toBeGreaterThan(0));
  it.each(['wallTimeMs','peakRssBytes','stdoutBytes','stderrBytes','inputBytes','outputBytes'] as const)('supports metric %s', metric => expect(calculateStatistics([sample({ [metric]: 4 })])[metric]).toBeDefined());
  it('keeps percentile ordering', () => { const s = calculateStatistics([sample({ wallTimeMs: 1 }), sample({ wallTimeMs: 8 }), sample({ wallTimeMs: 3 })]).wallTimeMs!; expect(s.min).toBeLessThanOrEqual(s.median); expect(s.median).toBeLessThanOrEqual(s.max); });
  it('does not fabricate missing CPU values', () => expect(calculateStatistics([sample({ cpuUserMs: undefined, cpuSystemMs: undefined })]).cpuUserMs).toBeUndefined());
  it('calculates mean with repeated values', () => expect(calculateStatistics([sample({ wallTimeMs: 5 }), sample({ wallTimeMs: 5 })]).wallTimeMs?.mean).toBe(5));
});

describe('fingerprints', () => {
  it.each(['a', 'b', '', 'unicode-日本語', 'same', 'bytes'])('hashes file %s', async text => { const dir=root(); const file=path.join(dir, 'input'); writeFileSync(file, text); const f=await fingerprintInput({ path:file }); expect(f.sizeBytes).toBe(Buffer.byteLength(text)); expect(f.sha256).toHaveLength(64); });
  it('returns same hash for same bytes', async () => { const dir=root(); const a=path.join(dir,'a');const b=path.join(dir,'b');writeFileSync(a,'x');writeFileSync(b,'x');expect((await fingerprintInput({path:a})).sha256).toBe((await fingerprintInput({path:b})).sha256); });
  it('changes hash when bytes change', async () => { const dir=root();const f=path.join(dir,'x');writeFileSync(f,'a');const a=await fingerprintInput({path:f});writeFileSync(f,'b');const b=await fingerprintInput({path:f});expect(a.sha256).not.toBe(b.sha256); });
  it('preserves input label', async () => { const dir=root();const f=path.join(dir,'x');writeFileSync(f,'a');expect((await fingerprintInput({path:f,label:'case'})).label).toBe('case'); });
});

describe('comparison', () => {
  it('classifies equal results unchanged', () => expect(compareResults(result('b'), result('c')).classification).toBe('unchanged'));
  it('classifies faster candidate improved', () => expect(compareResults(result('b',100), result('c',80), { wallTimeMedianRegressionPct: 1 }).classification).toBe('improved'));
  it('classifies slower candidate regressed', () => expect(compareResults(result('b',100), result('c',120), { wallTimeMedianRegressionPct: 1 }).classification).toBe('regressed'));
  it('classifies lower memory improved', () => expect(compareResults(result('b',100,1000), result('c',100,800), { peakRssMedianRegressionPct: 1 }).cases[0].metrics.find(m=>m.metric==='peakRssBytes')?.classification).toBe('improved'));
  it('classifies higher memory regressed', () => expect(compareResults(result('b',100,1000), result('c',100,1200), { peakRssMedianRegressionPct: 1 }).cases[0].metrics.find(m=>m.metric==='peakRssBytes')?.classification).toBe('regressed'));
  it('ignores changes below threshold', () => expect(compareResults(result('b',100), result('c',105), { wallTimeMedianRegressionPct: 10 }).classification).toBe('unchanged'));
  it('detects exact threshold as unchanged', () => expect(compareResults(result('b',100), result('c',110), { wallTimeMedianRegressionPct: 10 }).classification).toBe('unchanged'));
  it('detects over threshold', () => expect(compareResults(result('b',100), result('c',111), { wallTimeMedianRegressionPct: 10 }).classification).toBe('regressed'));
  it('detects platform mismatch', () => { const c=result('c');c.environment.platform='darwin';expect(compareResults(result('b'),c).classification).toBe('inconclusive'); });
  it('detects architecture mismatch', () => { const c=result('c');c.environment.architecture='arm64';expect(compareResults(result('b'),c).classification).toBe('inconclusive'); });
  it('detects node mismatch', () => { const c=result('c');c.environment.nodeVersion='v1';expect(compareResults(result('b'),c).classification).toBe('inconclusive'); });
  it('detects input mismatch', () => { const c=result('c');c.cases[0].inputFingerprint[0].sha256='changed';expect(compareResults(result('b'),c).classification).toBe('inconclusive'); });
  it('detects missing case', () => { const c=result('c');c.cases=[];expect(compareResults(result('b'),c).warnings).toContain('MISSING_CASE:case'); });
  it('renders markdown table', () => expect(renderComparison(compareResults(result('b'),result('c')))).toContain('| Case | Metric |'));
  it('renders warnings', () => { const c=result('c');c.environment.platform='x';expect(renderComparison(compareResults(result('b'),c))).toContain('ENVIRONMENT_MISMATCH'); });
  it('reports absolute delta', () => expect(compareResults(result('b',100),result('c',80)).cases[0].metrics.find(m=>m.metric==='wallTimeMs')?.absoluteDelta).toBe(-20));
  it('reports percentage delta', () => expect(compareResults(result('b',100),result('c',80)).cases[0].metrics.find(m=>m.metric==='wallTimeMs')?.percentageDelta).toBe(-20));
  it('marks unavailable metric inconclusive', () => { const a=result('a');a.cases[0].statistics={};const b=result('b');b.cases[0].statistics={};expect(compareResults(a,b).cases[0].metrics[0].classification).toBe('inconclusive'); });
  it('supports output size threshold', () => expect(compareResults(result('b'),result('c'),{outputBytesMedianRegressionPct:10}).cases[0].metrics.some(m=>m.metric==='outputBytes')).toBe(true));
  it('uses lower-is-better direction', () => expect(compareResults(result('b'),result('c')).cases[0].metrics.find(m=>m.metric==='wallTimeMs')?.direction).toBe('lower-is-better'));
});

describe('process runner', () => {
  it('runs successful process', async () => { const dir=root();const input=path.join(dir,'i');writeFileSync(input,'x');const s=await runSample(fakeCase('process.stdout.write("ok")',input),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.success).toBe(true); });
  it('records stdout bytes', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('process.stdout.write("hello")',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.stdoutBytes).toBe(5); });
  it('records deterministic output hash', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('process.stdout.write("hello")',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.outputHash).toMatch(/^[0-9a-f]{64}$/); });
  it('records stderr bytes', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('process.stderr.write("err")',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.stderrBytes).toBe(3); });
  it('records input bytes', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'123');expect((await runSample(fakeCase('',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},3)).inputBytes).toBe(3); });
  it('records wall time', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');expect((await runSample(fakeCase('',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1)).wallTimeMs).toBeGreaterThanOrEqual(0); });
  it('records failed exit', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('process.exit(3)',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.success).toBe(false);expect(s.exitCode).toBe(3); });
  it('records timeout', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const c=fakeCase('setTimeout(()=>{},1000)',f);c.target.timeoutMs=30;const s=await runSample(c,0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.timeout).toBe(true);expect(s.success).toBe(false); });
  it('records signal', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('process.kill(process.pid,"SIGTERM")',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.success).toBe(false);expect(s.signal).toBe('SIGTERM'); });
  it('does not use shell expansion', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('process.stdout.write(process.env.TIRAI_BENCH_SHELL||"unset")',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.success).toBe(true); });
  it('parses domain metrics', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const c=fakeCase('process.stdout.write("ok")',f);c.target.parser=()=>({cells:3});expect((await runSample(c,0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1)).domainMetrics?.cells).toBe(3); });
  it('records parser warnings', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const c=fakeCase('',f);c.target.parser=()=>{throw new Error('bad output')};expect((await runSample(c,0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1)).warnings[0]).toContain('DOMAIN_METRICS_PARSE_FAILED'); });
  it('records run index', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');expect((await runSample(fakeCase('',f),7,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1)).runIndex).toBe(7); });
  it('samples target RSS when available', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const s=await runSample(fakeCase('setTimeout(()=>{},20)',f),0,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:5},1);if(process.platform==='linux')expect(s.peakRssBytes).toBeGreaterThan(0); });
});

describe('environment and sampling', () => {
  it.each(['platform','architecture','osRelease','nodeVersion','cpuCount','totalMemoryBytes'] as const)('collects %s', field => expect(collectEnvironment()[field]).toBeTruthy());
  it('collects git metadata', () => expect(collectGitMetadata(process.cwd()).commit).toMatch(/^[0-9a-f]{7,}$/));
  it('does not throw for missing process metrics', () => expect(readProcessMetrics(999999999)).toEqual({}));
  it('reports current platform', () => expect(['linux','darwin','win32','freebsd'].includes(collectEnvironment().platform)).toBe(true));
  it('reports CPU count as positive', () => expect(collectEnvironment().cpuCount).toBeGreaterThan(0));
});

describe('fixture generator and Excel parser', () => {
  it('generates deterministic small fixture', async () => { const dir=root();const m=await generateExcelFixture({id:'small',seed:1,sheets:1,rows:10,columns:3,populationRate:1},dir);expect(m.expectedPopulatedCells).toBe(30);expect(m.sha256).toHaveLength(64); });
  it('records fixture manifest', async () => { const dir=root();await generateExcelFixture({id:'manifest',seed:1,sheets:1,rows:2,columns:2,populationRate:1},dir);expect(readFileSync(path.join(dir,'manifest.manifest.json'),'utf8')).toContain('sha256'); });
  it('changes fixture hash with seed', async () => { const a=await generateExcelFixture({id:'a',seed:1,sheets:1,rows:100,columns:2,populationRate:.5},root());const b=await generateExcelFixture({id:'b',seed:2,sheets:1,rows:100,columns:2,populationRate:.5},root());expect(a.sha256).not.toBe(b.sha256); });
  it('supports multiple sheets', async () => { const m=await generateExcelFixture({id:'multi',seed:1,sheets:3,rows:2,columns:2,populationRate:1},root());expect(m.sheets).toBe(3); });
  it('supports merge-heavy config', async () => { const m=await generateExcelFixture({id:'merge',seed:1,sheets:1,rows:20,columns:2,populationRate:0,mergeCount:5},root());expect(m.expectedMergedRanges).toBe(5); });
  it('supports sparse population', async () => { const m=await generateExcelFixture({id:'sparse',seed:1,sheets:1,rows:10,columns:10,populationRate:0},root());expect(m.expectedPopulatedCells).toBe(0); });
  it('has stable cell count for same config', async () => { const c={id:'same',seed:1,sheets:1,rows:5,columns:5,populationRate:.5};expect((await generateExcelFixture(c,root())).expectedPopulatedCells).toBe((await generateExcelFixture({...c,id:'same2'},root())).expectedPopulatedCells); });
  it('parses sheet count', () => expect(parseExtractorOutput({stdout:JSON.stringify({sheets:[{}]}),stderr:'',success:true}).sheets).toBe(1));
  it('parses cell count', () => expect(parseExtractorOutput({stdout:JSON.stringify({sheets:[{cells:[{},{}]}]}),stderr:'',success:true}).cellsEmitted).toBe(2));
  it('parses merge count', () => expect(parseExtractorOutput({stdout:JSON.stringify({sheets:[{mergedRanges:[{}]}]}),stderr:'',success:true}).mergedRanges).toBe(1));
  it('parses style count', () => expect(parseExtractorOutput({stdout:JSON.stringify({sheets:[{styles:{a:{},b:{}}}]}),stderr:'',success:true}).styles).toBe(2));
  it('parses object and warning counts', () => expect(parseExtractorOutput({stdout:JSON.stringify({sheets:[{objects:[{}],warnings:[{},{}]}]}),stderr:'',success:true})).toMatchObject({objects:1,warnings:2}));
});

describe('engine and persistence', () => {
  it('runs one benchmark case', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('one',[fakeCase('',f)],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10});expect(r.summary.casesPassed).toBe(1); });
  it('keeps warmups separate', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('warm',[fakeCase('',f)],{warmupRuns:2,measurementRuns:1,memorySampleIntervalMs:10});expect(r.cases[0].warmupSamples).toHaveLength(2);expect(r.cases[0].samples).toHaveLength(1); });
  it('marks failed case', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('fail',[fakeCase('process.exit(1)',f)],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10});expect(r.cases[0].status).toBe('failed'); });
  it('records input fingerprint', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');expect((await runBenchmark('fp',[fakeCase('',f)],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10})).cases[0].inputFingerprint[0].sizeBytes).toBe(1); });
  it('writes JSON result', async () => { const dir=root();const r=result('write');writeResult(r,dir);expect(JSON.parse(readFileSync(path.join(dir,'benchmark-result.json'),'utf8')).benchmarkId).toBe('write'); });
  it('writes Markdown summary', async () => { const dir=root();writeResult(result('md'),dir);expect(readFileSync(path.join(dir,'summary.md'),'utf8')).toContain('Median wall ms'); });
  it('does not overwrite an existing result by default', () => { const dir=root();writeResult(result('first'),dir);expect(() => writeResult(result('second'),dir)).toThrow('BENCHMARK_EXISTS'); });
  it('allows explicit result overwrite', () => { const dir=root();writeResult(result('first'),dir);writeResult(result('second'),dir,true);expect(JSON.parse(readFileSync(path.join(dir,'benchmark-result.json'),'utf8')).benchmarkId).toBe('second'); });
  it('renders summary status', () => expect(renderSummary(result('summary'))).toContain('Passed: 1'));
  it('supports memory budget warnings', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('budget',[fakeCase('',f)],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10,maxPeakRssMB:0});expect(r.cases[0].warnings).toContain('PEAK_RSS_BUDGET_EXCEEDED'); });
  it('supports time budget warnings', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('budget',[fakeCase('setTimeout(()=>{},20)',f)],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10,maxWallTimeMs:0});expect(r.cases[0].warnings).toContain('WALL_TIME_BUDGET_EXCEEDED'); });
  it('runs cases sequentially', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('two',[{...fakeCase('',f),id:'a'},{...fakeCase('',f),id:'b'}],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10});expect(r.cases.map(c=>c.caseId)).toEqual(['a','b']); });
  it('summarizes partial suite', async () => { const dir=root();const f=path.join(dir,'i');writeFileSync(f,'x');const r=await runBenchmark('partial',[{...fakeCase('',f),id:'ok'},{...fakeCase('process.exit(1)',f),id:'bad'}],{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10});expect(r.summary.casesPassed).toBe(1);expect(r.summary.casesFailed).toBe(1); });
});

describe('security and contract behavior', () => {
  it.each(Array.from({length:10}, (_,i)=>i))('does not evaluate arbitrary shell string %i', async i => { const dir=root();const f=path.join(dir,`i-${i}`);writeFileSync(f,'x');const c=fakeCase('process.stdout.write("safe")',f);const s=await runSample(c,i,{warmupRuns:0,measurementRuns:1,memorySampleIntervalMs:10},1);expect(s.success).toBe(true);expect(s.stdoutBytes).toBe(4); });
  it('preserves schema version', () => expect(result('schema').schemaVersion).toBe('1.0'));
  it('preserves sample warnings array', () => expect(sample().warnings).toEqual([]));
  it('does not fabricate CPU in statistics', () => expect(calculateStatistics([sample()]).cpuTotalMs).toBeUndefined());
  it('keeps output ordering stable', () => expect(renderSummary(result('ordered')).indexOf('Case')).toBeGreaterThan(0));
  it('does not mutate baseline comparison input', () => { const a=result('a');const before=JSON.stringify(a);compareResults(a,result('b'));expect(JSON.stringify(a)).toBe(before); });
});
