import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './process.js';
import type { OfficeCliCell, OfficeCliCommandResult, OfficeCliSheet, OfficeCliWorkbookSnapshot, CapabilityStatus } from './models.js';

export interface InspectOptions {
  binary?: string;
  expectedVersion?: string;
  timeoutMs?: number;
  sheets?: string[];
  rawParts?: string[];
}

export interface CellProbe {
  sheet: string;
  address: string;
  text: string;
  format: Record<string, string | boolean | number>;
  source: { backend: 'officecli'; sheet: string; address: string };
}

export async function inspectWorkbook(filePath: string, options: InspectOptions = {}): Promise<OfficeCliWorkbookSnapshot> {
  const resolved = path.resolve(filePath);
  const binary = options.binary ?? process.env.OFFICECLI_BIN ?? 'officecli';
  try {
    return await inspectWorkbookInternal(resolved, { ...options, binary });
  } finally {
    await closeResident(binary, resolved);
  }
}

async function inspectWorkbookInternal(resolved: string, options: InspectOptions): Promise<OfficeCliWorkbookSnapshot> {
  const before = await fileHash(resolved);
  const binary = options.binary ?? process.env.OFFICECLI_BIN ?? 'officecli';
  const versionResult = await invoke(binary, ['--version'], options);
  ensureSuccess(versionResult, 'version');
  const version = versionResult.stdout.trim() || versionResult.stderr.trim();
  if (options.expectedVersion && version !== options.expectedVersion) throw new Error(`OFFICECLI_VERSION_MISMATCH: expected ${options.expectedVersion}, got ${version}`);
  const outline = await invoke(binary, ['view', resolved, 'outline', '--json'], options);
  ensureSuccess(outline, 'outline');
  const outlineData = parseJson(outline.stdout, 'outline')?.data as { sheets?: Array<{ name: string; rows?: number; cols?: number }> } | undefined;
  const sheetEntries = outlineData?.sheets ?? [];
  const selected = options.sheets?.length ? sheetEntries.filter((sheet) => options.sheets!.includes(sheet.name)) : sheetEntries;
  const sheets: OfficeCliSheet[] = [];
  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    const result = await invoke(binary, ['get', resolved, `/${entry.name}`, '--depth', '2', '--json'], options);
    ensureSuccess(result, `sheet ${entry.name}`);
    const sheet = parseSheet(result.stdout, resolved, entry.name, entry.rows ?? null, entry.cols ?? null);
    const rawSheet = await invoke(binary, ['raw', resolved, `/xl/worksheets/sheet${sheetEntries.indexOf(entry) + 1}.xml`, '--json'], options);
    if (rawSheet.exitCode === 0) {
      const rawData = parseJson(rawSheet.stdout, `raw sheet ${entry.name}`).data;
      const xml = typeof rawData === 'string' ? rawData : '';
      sheet.mergedRanges = [...new Set([...sheet.mergedRanges, ...extractMergeRanges(xml)])];
    }
    sheets.push(sheet);
  }
  const rawOoxml: Record<string, string> = {};
  for (const part of options.rawParts ?? []) {
    const result = await invoke(binary, ['raw', resolved, part, '--json'], options);
    ensureSuccess(result, `raw ${part}`);
    const parsed = parseJson(result.stdout, `raw ${part}`);
    const data = parsed?.data;
    rawOoxml[part] = typeof data === 'string' ? data : JSON.stringify(data);
  }
  const after = await fileHash(resolved);
  const sizeBytes = (await stat(resolved)).size;
  return {
    schemaVersion: 'officecli-evaluation-1.0', backend: 'officecli', officeCliVersion: version,
    file: { path: resolved, name: path.basename(resolved), sizeBytes, sha256Before: before, sha256After: after, unchanged: before === after },
    sheets, capabilities: inferCapabilities(sheets, rawOoxml), rawOoxml: Object.keys(rawOoxml).length ? rawOoxml : undefined,
    warnings: after === before ? [] : ['SOURCE_WORKBOOK_MUTATED'],
  };
}

export async function probeCell(filePath: string, sheet: string, address: string, options: InspectOptions = {}): Promise<CellProbe> {
  const resolved = path.resolve(filePath);
  const binary = options.binary ?? process.env.OFFICECLI_BIN ?? 'officecli';
  try {
    const result = await invoke(binary, ['get', resolved, `/${sheet}/${address}`, '--json'], options);
    ensureSuccess(result, `cell ${sheet}!${address}`);
    const parsed = parseJson(result.stdout, `cell ${sheet}!${address}`);
    const node = ((((parsed.data as Record<string, unknown> | undefined)?.results as unknown[]) ?? [])[0] ?? {}) as Record<string, unknown>;
    return { sheet, address, text: typeof node.text === 'string' ? node.text : '', format: ((node.format as Record<string, string | boolean | number> | undefined) ?? {}), source: { backend: 'officecli', sheet, address } };
  } finally {
    await closeResident(binary, resolved);
  }
}

async function closeResident(binary: string, filePath: string): Promise<void> {
  try { await runCommand({ command: binary, args: ['close', filePath], timeoutMs: 5_000 }); } catch { /* cleanup must not hide the primary result */ }
}

async function invoke(binary: string, args: string[], options: InspectOptions): Promise<OfficeCliCommandResult> {
  return runCommand({ command: binary, args, timeoutMs: options.timeoutMs });
}

function ensureSuccess(result: OfficeCliCommandResult, operation: string): void {
  if (result.timedOut) throw new Error(`OFFICECLI_TIMEOUT: ${operation}`);
  if (result.exitCode !== 0) throw new Error(`OFFICECLI_FAILED: ${operation}: ${result.stderr.trim()}`);
}

function parseJson(stdout: string, operation: string): Record<string, unknown> {
  try { return JSON.parse(stdout) as Record<string, unknown>; } catch (error) { throw new Error(`OFFICECLI_INVALID_JSON: ${operation}: ${error instanceof Error ? error.message : String(error)}`); }
}

function parseSheet(stdout: string, filePath: string, sheetName: string, rowCount: number | null, columnCount: number | null): OfficeCliSheet {
  const parsed = parseJson(stdout, `sheet ${sheetName}`);
  const result = (((parsed.data as Record<string, unknown> | undefined)?.results as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  const metadata = (result?.format as Record<string, unknown> | undefined) ?? {};
  const cells: OfficeCliCell[] = [];
  collectCells(result?.children, filePath, sheetName, cells);
  const mergedRanges = [...new Set(cells.map((cell) => cell.merge).filter((range): range is string => !!range))];
  return { name: sheetName, rowCount, columnCount, visibility: typeof metadata.visibility === 'string' ? metadata.visibility : null, cells, mergedRanges, metadata, warnings: [] };
}

function collectCells(value: unknown, filePath: string, sheetName: string, cells: OfficeCliCell[]): void {
  if (!Array.isArray(value)) return;
  for (const child of value) {
    if (!child || typeof child !== 'object') continue;
    const node = child as Record<string, unknown>;
    if (node.type === 'cell' && typeof node.path === 'string') {
      const address = node.path.split('/').pop() ?? '';
      const format = (node.format as Record<string, string | boolean | number> | undefined) ?? {};
      const text = typeof node.text === 'string' ? node.text : '';
      cells.push({ address, text, type: typeof format.type === 'string' ? format.type : null, empty: format.empty === true || text === '', formula: typeof format.formula === 'string' ? format.formula : null, merge: typeof format.merge === 'string' ? format.merge : null, mergeAnchor: format.mergeAnchor === true, format, source: { backend: 'officecli', workbook: filePath, sheet: sheetName, address } });
    }
    collectCells(node.children, filePath, sheetName, cells);
  }
}

async function fileHash(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function inferCapabilities(sheets: OfficeCliSheet[], raw: Record<string, string>): Record<string, CapabilityStatus> {
  const cells = sheets.flatMap((sheet) => sheet.cells);
  return {
    workbookMetadata: 'SUPPORTED', sheets: 'SUPPORTED', cells: cells.length ? 'SUPPORTED' : 'UNKNOWN', formulas: cells.some((cell) => cell.formula) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE',
    mergedRanges: sheets.some((sheet) => sheet.mergedRanges.length) ? 'SUPPORTED' : 'NOT_PRESENT_IN_FIXTURE', styledEmptyCells: cells.some((cell) => cell.empty && Object.keys(cell.format).length > 1) ? 'PARTIAL' : 'UNSUPPORTED',
    rawOoxml: Object.keys(raw).length ? 'SUPPORTED' : 'UNKNOWN', comments: 'UNKNOWN', validations: 'UNKNOWN', namedRanges: 'UNKNOWN', tables: 'UNKNOWN', conditionalFormatting: 'UNKNOWN', pageSetup: 'PARTIAL', pictures: 'UNKNOWN', shapes: 'UNKNOWN', charts: 'UNKNOWN', pivots: 'UNKNOWN', slicers: 'UNKNOWN', oleObjects: 'UNKNOWN', hyperlinks: 'UNKNOWN',
  };
}

function extractMergeRanges(xml: string): string[] {
  return [...xml.matchAll(/<x:mergeCell\s+ref="([^"]+)"/g)].map((match) => match[1]!);
}
