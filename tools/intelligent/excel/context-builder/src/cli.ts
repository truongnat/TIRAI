#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Excel AI Context Builder – CLI
// ---------------------------------------------------------------------------

import { buildExcelContext, writeContextPackage } from './builder.js';
import { ContextBuilderError } from './warnings.js';
import type { ContextBuilderOptions } from './models.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const pretty = args.includes('--pretty');
  const inputDir = extractFlagValue(args, '--input') || extractPositional(args, 0);
  const outputDir = extractFlagValue(args, '--output') || './output/excel/context';
  const maxChars = parseNumber(extractFlagValue(args, '--max-chars'));
  const maxCells = parseNumber(extractFlagValue(args, '--max-cells'));
  const sheetFilter = extractFlagValues(args, '--sheet');

  if (!inputDir) {
    process.stderr.write('ERROR [INVALID_ARGUMENT]: No input directory specified.\n');
    process.exit(1);
  }

  const options: ContextBuilderOptions = {};
  if (maxChars !== undefined) options.maxChars = maxChars;
  if (maxCells !== undefined) options.maxCells = maxCells;
  if (sheetFilter.length > 0) options.sheets = sheetFilter;

  try {
    const pkg = await buildExcelContext(inputDir, options);
    writeContextPackage(pkg, outputDir, pretty);

    // Summary to stdout
    process.stdout.write(`Excel AI Context Builder v1\n`);
    process.stdout.write(`\n`);
    process.stdout.write(`Source:    ${pkg.source.file}\n`);
    process.stdout.write(`Sheets:    ${pkg.stats.sheets}\n`);
    process.stdout.write(`Chunks:    ${pkg.stats.chunks}\n`);
    process.stdout.write(`Characters: ${pkg.stats.characters}\n`);
    process.stdout.write(`Est. tokens: ${pkg.stats.estimatedTokens}\n`);
    process.stdout.write(`Output:    ${outputDir}\n`);
    if (pkg.warnings.length > 0) {
      process.stdout.write(`Warnings:  ${pkg.warnings.length}\n`);
      for (const w of pkg.warnings) {
        process.stderr.write(`  [${w.code}] ${w.message}\n`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof ContextBuilderError) {
      process.stderr.write(`ERROR [${err.code}]: ${err.message}\n`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ERROR [UNKNOWN]: ${msg}\n`);
    }
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
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[++i]);
    }
  }
  return values;
}

function extractPositional(args: string[], index: number): string | undefined {
  const positional = args.filter((a) => !a.startsWith('--'));
  return positional[index];
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function printUsage(): void {
  process.stdout.write(`Usage: excel-context-builder --input <dir> --output <dir> [options]

Build AI-friendly context package from deterministic Excel outputs.

Arguments:
  --input <dir>       Input directory containing workbook.json + layout/
  --output <dir>      Output directory for context package (default: ./output/excel/context)

Options:
  --max-chars <n>     Maximum characters per chunk (default: 50000)
  --max-cells <n>     Maximum cells per chunk (default: 500)
  --sheet <name>      Only process specific sheet(s). Repeatable.
  --pretty            Format JSON output for readability.
  --help, -h          Show this help message.

Output:
  <output>/
  ├── manifest.json
  ├── workbook-context.json
  └── chunks/
      ├── ctx-s000-c000.json
      └── ...
`);
}

main();
