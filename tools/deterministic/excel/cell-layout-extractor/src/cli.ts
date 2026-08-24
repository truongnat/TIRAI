#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Cell + Layout Extractor – CLI
// ---------------------------------------------------------------------------

import { extractWorkbook, ExtractorError } from './extractor.js';
import type { ExtractOptions } from './models.js';
import { memorySnapshot } from './performance.js';
import { writeWorkbookJson } from './serialization.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const pretty = args.includes('--pretty');
  const sheetArgs = extractFlagValues(args, '--sheet');
  const includeEmptyAll = args.includes('--include-empty-all');
  const assets = args.includes('--assets');
  const profilePerformance = args.includes('--profile-performance');
  const profileOutput = extractFlagValues(args, '--profile-output')[0];

  const inputFile = args.filter(
    (a) => !a.startsWith('--') && !sheetArgs.includes(a),
  )[0];

  if (!inputFile) {
    process.stderr.write('ERROR [INVALID_ARGUMENT]: No input file specified.\n');
    process.exit(1);
  }

  const options: ExtractOptions = {};
  if (sheetArgs.length > 0) {
    options.sheets = sheetArgs.map((s) => {
      const num = Number(s);
      return Number.isFinite(num) && Number.isInteger(num) ? num : s;
    });
  }
  if (includeEmptyAll) {
    options.includeEmptyAll = true;
  }
  if (assets) {
    options.assets = true;
  }
  if (profilePerformance) {
    options.profilePerformance = true;
  }

  try {
    const metadata = await extractWorkbook(inputFile, options);
    if (profilePerformance && profileOutput && metadata.performanceProfile) {
      const { performanceProfile, ...output } = metadata;
      performanceProfile.rssBeforeSerializationBytes = process.memoryUsage().rss;
      performanceProfile.memory.push(memorySnapshot('before-serialization-cli'));
      if (pretty) {
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      } else {
        await writeWorkbookJson(output, (chunk) => writeStdout(chunk), (sheet, index) => {
          performanceProfile.memory.push(memorySnapshot(`after-serialization-sheet:${index}:${sheet.name}`));
        });
        process.stdout.write('\n');
      }
      performanceProfile.rssAfterSerializationBytes = process.memoryUsage().rss;
      performanceProfile.memory.push(memorySnapshot('after-serialization-cli'));
      await import('node:fs/promises').then((fs) => fs.writeFile(profileOutput, JSON.stringify(performanceProfile, null, 2)));
      performanceProfile.memory.push(memorySnapshot('after-profile-write'));
      return;
    }
    if (metadata.performanceProfile) delete metadata.performanceProfile;
    if (pretty) {
      process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
    } else {
      await writeWorkbookJson(metadata, (chunk) => writeStdout(chunk));
      process.stdout.write('\n');
    }
  } catch (err: unknown) {
    if (err instanceof ExtractorError) {
      process.stderr.write(`ERROR [${err.code}]: ${err.message}\n`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ERROR [UNKNOWN]: ${msg}\n`);
    }
    process.exit(1);
  }
}

function writeStdout(chunk: string): Promise<void> {
  if (process.stdout.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => process.stdout.once('drain', resolve));
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

function printUsage(): void {
  process.stdout.write(`Usage: cell-layout-extractor <input-file> [options]

Extract cell content + layout context from Excel .xlsx/.xlsm workbooks.

Arguments:
  <input-file>           Path to the workbook file.

Options:
  --pretty               Format JSON output for readability.
  --sheet <name|index>   Extract only specific sheet(s). Repeatable.
  --include-empty-all    Include all empty cells in used range.
  --assets               Extract binary assets (images) metadata.
  --profile-performance  Collect opt-in phase, sheet, and memory diagnostics.
  --profile-output <file> Write diagnostics separately from extraction JSON.
  --help, -h             Show this help message.

Output:
  JSON is written to stdout.  Errors go to stderr.
`);
}

main();
