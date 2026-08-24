#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { compareResults, renderComparison } from './compare.js';
import { runBenchmark, renderSummary, writeResult } from './engine.js';
import { createExcelExtractorCase } from './excel-preset.js';
import { defaultFixtureConfigs, generateExcelFixture } from './fixture-generator.js';
import type { BenchmarkRunConfig } from './models.js';

function values(args:string[], flag:string):string[]{const out:string[]=[];for(let i=0;i<args.length;i++)if(args[i]===flag&&args[i+1])out.push(args[++i]);return out;}
function value(args:string[],flag:string, fallback?:string):string|undefined{return values(args,flag)[0]??fallback;}
function numberValue(args:string[],flag:string,fallback:number):number{const n=Number(value(args,flag));return Number.isFinite(n)?n:fallback;}
function usage():void{process.stdout.write(`Usage:\n  tirai-bench run --id <id> --input <xlsx>... --output <dir> [options]\n  tirai-bench baseline --name <name> --input <xlsx>... --output <dir> [options]\n  tirai-bench compare --baseline <json> --candidate <json> --output <dir>\n  tirai-bench generate-fixture --output <dir> [--fixture <id>]\n\nOptions: --warmup-runs N --measurement-runs N --interval-ms N --timeout-ms N\n`);}
async function main():Promise<void>{const args=process.argv.slice(2);const command=args[0];if(!command||args.includes('--help')||args.includes('-h')){usage();return;}
 if(command==='compare'){const baseline=JSON.parse(readFileSync(value(args,'--baseline')!,'utf8'));const candidate=JSON.parse(readFileSync(value(args,'--candidate')!,'utf8'));const comparison=compareResults(baseline,candidate);const out=value(args,'--output','output/performance/comparisons/comparison')!;mkdirSync(out,{recursive:true});writeFileSync(`${out}/comparison.json`,`${JSON.stringify(comparison,null,2)}\n`);writeFileSync(`${out}/comparison.md`,renderComparison(comparison));process.stdout.write(renderComparison(comparison));return;}
 if(command==='generate-fixture'){const out=value(args,'--output','output/performance/fixtures')!;const requested=value(args,'--fixture');const configs=defaultFixtureConfigs.filter(c=>!requested||c.id===requested);for(const config of configs)await generateExcelFixture(config,out);process.stdout.write(`Generated ${configs.length} fixture(s) in ${out}\n`);return;}
 if(command==='run'||command==='baseline'){const inputs=values(args,'--input');if(!inputs.length)throw new Error('--input is required');const id=value(args,command==='baseline'?'--name':'--id',command==='baseline'?'excel-extractor-pre-optimization':'excel-run')!;const config:BenchmarkRunConfig={warmupRuns:numberValue(args,'--warmup-runs',command==='baseline'?0:1),measurementRuns:numberValue(args,'--measurement-runs',command==='baseline'?1:5),memorySampleIntervalMs:numberValue(args,'--interval-ms',75),timeoutMs:numberValue(args,'--timeout-ms',30*60*1000),note:value(args,'--note')};const sheet=value(args,'--sheet');const cases=inputs.map((input,i)=>createExcelExtractorCase(pathCase(input,i),input,undefined,sheet));const result=await runBenchmark(id,cases,config);const out=value(args,'--output',command==='baseline'?`output/performance/baselines/${id}`:`output/performance/runs/${id}`)!;writeResult(result,out,command==='run'||args.includes('--force'));process.stdout.write(renderSummary(result));return;}
 usage();
}
function pathCase(input:string,index:number):string{return input.split('/').pop()?.replace(/\.xlsx?$/i,'')||`case-${index+1}`;}
main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
