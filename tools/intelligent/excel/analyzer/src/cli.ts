#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Excel AI Analyzer – CLI
// ---------------------------------------------------------------------------

import { analyzeExcelContext, writeSemanticIR } from './analyzer.js';
import type { AnalyzerOptions } from './models.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const contextDir = extractFlagValue(args, '--input') || extractPositional(args, 0);
  const outputDir = extractFlagValue(args, '--output') || './output/excel/semantic';
  const model = extractFlagValue(args, '--model');
  const apiKey = extractFlagValue(args, '--api-key') || process.env.GEMINI_API_KEY;
  const maxTokens = parseNumber(extractFlagValue(args, '--max-tokens'));
  const sheetFilter = extractFlagValues(args, '--sheet');

  if (!contextDir) {
    process.stderr.write('ERROR: No input directory specified. Use --input <dir>.\n');
    process.exit(1);
  }

  if (!apiKey) {
    process.stderr.write('ERROR: Gemini API key required. Set GEMINI_API_KEY or use --api-key.\n');
    process.exit(1);
  }

  const options: AnalyzerOptions = {
    provider: 'gemini',
    apiKey,
  };
  if (model) options.model = model;
  if (maxTokens) options.maxOutputTokens = maxTokens;
  if (sheetFilter.length > 0) options.sheets = sheetFilter;

  try {
    process.stdout.write('Excel AI Analyzer v1\n');
    process.stdout.write(`Input:  ${contextDir}\n`);
    process.stdout.write(`Model:  ${model || 'gemini-2.5-flash'}\n`);
    process.stdout.write('Analyzing...\n\n');

    const ir = await analyzeExcelContext(contextDir, options);
    writeSemanticIR(ir, outputDir);

    // Summary
    process.stdout.write(`Status: PASS\n\n`);
    process.stdout.write(`Source:       ${ir.source.file}\n`);
    process.stdout.write(`Provider:     ${ir.source.provider}\n`);
    process.stdout.write(`Entities:     ${ir.entities.length}\n`);
    process.stdout.write(`Sections:     ${ir.sections.length}\n`);
    process.stdout.write(`Flows:        ${ir.flows.length}\n`);
    process.stdout.write(`Fields:       ${ir.fields.length}\n`);
    process.stdout.write(`Rules:        ${ir.rules.length}\n`);
    process.stdout.write(`Relationships: ${ir.relationships.length}\n`);
    process.stdout.write(`Provenance:   ${ir.provenance.length}\n`);
    process.stdout.write(`Warnings:     ${ir.warnings.length}\n`);
    process.stdout.write(`\nOutput: ${outputDir}/semantic-ir.json\n`);

    if (ir.warnings.length > 0) {
      process.stdout.write('\nWarnings:\n');
      for (const w of ir.warnings) {
        process.stderr.write(`  [${w.code}] ${w.message}\n`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ERROR: ${msg}\n`);
    process.exit(1);
  }
}

function extractFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function extractFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) values.push(args[++i]);
  }
  return values;
}

function extractPositional(args: string[], index: number): string | undefined {
  return args.filter((a) => !a.startsWith('--'))[index];
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function printUsage(): void {
  process.stdout.write(`Usage: excel-analyzer --input <context-dir> [options]

Analyze Excel context package with AI → Semantic IR.

Arguments:
  --input <dir>       Context package directory (from context-builder)
  --output <dir>      Output directory (default: ./output/excel/semantic)

Options:
  --model <name>      Gemini model (default: gemini-2.5-flash)
  --api-key <key>     Gemini API key (or set GEMINI_API_KEY env)
  --max-tokens <n>    Max output tokens (default: 16000)
  --sheet <name>      Only analyze specific sheet(s). Repeatable.
  --help, -h          Show this help message.

Output:
  <output>/semantic-ir.json
`);
}

main();
