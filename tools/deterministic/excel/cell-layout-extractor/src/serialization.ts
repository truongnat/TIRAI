import type { SheetLayoutData, WorkbookLayoutMetadata } from './models.js';

export type JsonChunkWriter = (chunk: string) => void | Promise<void>;

/**
 * Write the canonical workbook JSON in bounded top-level chunks. The extractor
 * API still returns the complete object; this adapter avoids creating a second
 * workbook-sized JSON string in CLI callers.
 */
export async function writeWorkbookJson(
  metadata: Omit<WorkbookLayoutMetadata, 'performanceProfile'>,
  write: JsonChunkWriter,
  onSheet?: (sheet: SheetLayoutData, index: number) => void | Promise<void>,
): Promise<void> {
  await write('{"schemaVersion":');
  await write(JSON.stringify(metadata.schemaVersion));
  await write(',"file":');
  await write(JSON.stringify(metadata.file));
  await write(',"sheets":[');

  for (let index = 0; index < metadata.sheets.length; index++) {
    if (index > 0) await write(',');
    await write(JSON.stringify(metadata.sheets[index]));
    await onSheet?.(metadata.sheets[index], index);
  }

  await write('],"warnings":');
  await write(JSON.stringify(metadata.warnings));
  await write('}');
}
