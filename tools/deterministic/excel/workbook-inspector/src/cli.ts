#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Workbook Inspector – CLI
// ---------------------------------------------------------------------------

import { inspectWorkbook, InspectorError } from './inspector.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const pretty = args.includes('--pretty');
  const inputFile = args.filter((a) => !a.startsWith('--'))[0];

  if (!inputFile) {
    process.stderr.write('ERROR [INVALID_ARGUMENT]: No input file specified.\n');
    process.exit(1);
  }

  try {
    const metadata = await inspectWorkbook(inputFile);
    const json = pretty
      ? JSON.stringify(metadata, null, 2)
      : JSON.stringify(metadata);
    process.stdout.write(json + '\n');
  } catch (err: unknown) {
    if (err instanceof InspectorError) {
      process.stderr.write(`ERROR [${err.code}]: ${err.message}\n`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ERROR [UNKNOWN]: ${msg}\n`);
    }
    process.exit(1);
  }
}

function printUsage(): void {
  process.stdout.write(`Usage: workbook-inspector <input-file> [--pretty]

Read metadata from an Excel .xlsx or .xlsm workbook.

Arguments:
  <input-file>  Path to the workbook file.
  --pretty      Format JSON output for readability.

Output:
  JSON is written to stdout.  Errors and warnings go to stderr.
`);
}

main();
