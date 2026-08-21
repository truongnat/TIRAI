// ---------------------------------------------------------------------------
// Cell + Layout Extractor – main orchestrator
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import ExcelJS from 'exceljs';

import type {
  WorkbookLayoutMetadata,
  FileMetadata,
  SheetLayoutData,
  Warning,
  ExtractOptions,
} from './models.js';
import { StyleRegistry } from './styles.js';
import { extractCells } from './cells.js';
import { extractMergedRanges, extractRows, extractColumns } from './layout.js';
import { extractValidations } from './validations.js';
import { extractTables } from './tables.js';
import { extractAnnotations } from './annotations.js';
import { extractObjects } from './objects.js';
import { columnToLetter } from './utils.js';

// ---- Public API -----------------------------------------------------------

/**
 * Extract cell + layout metadata from an Excel workbook.
 *
 * Deterministic, read-only, no AI.  Returns a structured JSON representation
 * of all cell content, styles, merged ranges, row/column dimensions, and
 * layout context.
 *
 * @throws {ExtractorError} on fatal errors.
 */
export async function extractWorkbook(
  filePath: string,
  options: ExtractOptions = {},
): Promise<WorkbookLayoutMetadata> {
  const resolvedPath = path.resolve(filePath);
  const warnings: Warning[] = [];

  // -- 1. Validate ---------------------------------------------------------
  if (!fs.existsSync(resolvedPath)) {
    throw new ExtractorError('FILE_NOT_FOUND', resolvedPath);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new ExtractorError('FILE_NOT_READABLE', resolvedPath);
  }

  const ext = path.extname(resolvedPath).toLowerCase();

  if (ext === '.xls') {
    throw new ExtractorError(
      'UNSUPPORTED_FILE_FORMAT',
      'Legacy .xls format is not supported.',
    );
  }

  if (ext !== '.xlsx' && ext !== '.xlsm') {
    throw new ExtractorError(
      'UNSUPPORTED_FILE_FORMAT',
      `Extension "${ext}" is not supported. Supported: .xlsx, .xlsm`,
    );
  }

  // -- 2. File metadata ----------------------------------------------------
  const fileMeta: FileMetadata = {
    path: resolvedPath,
    name: path.basename(resolvedPath),
    extension: ext,
    sizeBytes: stat.size,
  };

  // -- 3. Open workbook ----------------------------------------------------
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(resolvedPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt|password|protected/i.test(msg)) {
      throw new ExtractorError('ENCRYPTED_FILE', resolvedPath);
    }
    throw new ExtractorError('CORRUPTED_WORKBOOK', resolvedPath, msg);
  }

  // -- 4. XLSM warning ----------------------------------------------------
  if (ext === '.xlsm') {
    warnings.push({
      code: 'MACRO_CONTENT_NOT_INSPECTED',
      message:
        'The workbook contains or may contain VBA content, but VBA is outside the scope of Cell + Layout Extractor.',
    });
  }

  // -- 5. Extract sheets ---------------------------------------------------
  const sheets: SheetLayoutData[] = [];

  for (let idx = 0; idx < workbook.worksheets.length; idx++) {
    const ws = workbook.worksheets[idx];

    // Filter by options if specified.
    if (options.sheets && options.sheets.length > 0) {
      const matchByName = options.sheets.some(
        (s) => typeof s === 'string' && s === ws.name,
      );
      const matchByIndex = options.sheets.some(
        (s) => typeof s === 'number' && s === idx,
      );
      if (!matchByName && !matchByIndex) continue;
    }

    sheets.push(await extractSheet(ws, idx, resolvedPath, options));
  }

  return {
    schemaVersion: '1.0',
    file: fileMeta,
    sheets,
    warnings,
  };
}

// ---- Sheet extraction ----------------------------------------------------

async function extractSheet(
  ws: ExcelJS.Worksheet,
  index: number,
  filePath: string,
  options: ExtractOptions,
): Promise<SheetLayoutData> {
  const sheetName = ws.name;
  const sheetWarnings: Warning[] = [];
  const styleRegistry = new StyleRegistry();

  // Dimension
  const dim = ws.dimensions;
  let dimension: string | null = null;
  let rowCount: number | null = null;
  let columnCount: number | null = null;

  if (dim && !dim.isEmpty && !(dim.top === 0 && dim.left === 0 && dim.bottom === 0 && dim.right === 0)) {
    dimension = `${columnToLetter(dim.left)}${dim.top}:${columnToLetter(dim.right)}${dim.bottom}`;
    rowCount = dim.bottom;
    columnCount = dim.right;
  } else {
    sheetWarnings.push({
      code: 'SHEET_DIMENSION_UNRELIABLE',
      message: 'Worksheet dimension could not be determined.',
      sheet: sheetName,
    });
  }

  // Cells
  const cells = extractCells(
    ws,
    sheetName,
    styleRegistry,
    sheetWarnings,
    options.includeEmptyAll ?? false,
  );

  // Layout
  const mergedRanges = extractMergedRanges(ws);
  const rows = extractRows(ws);
  const columns = extractColumns(ws);

  // Phase 3: Validations, Tables, Annotations
  const validations = extractValidations(ws, sheetName, sheetWarnings);
  const tables = extractTables(ws, sheetName, sheetWarnings);
  const annotations = extractAnnotations(ws, sheetName, sheetWarnings);

  // Phase 4: Drawing Objects (images, shapes, charts)
  const objects = await extractObjects(filePath, index, sheetName, sheetWarnings, options);

  // Styles
  const styles = styleRegistry.toMap();

  return {
    index,
    name: sheetName,
    dimension,
    rowCount,
    columnCount,
    rows,
    columns,
    mergedRanges,
    cells,
    styles,
    validations,
    tables,
    annotations,
    objects,
    warnings: sheetWarnings,
  };
}

// ---- Error ---------------------------------------------------------------

export class ExtractorError extends Error {
  readonly code: string;

  constructor(code: string, detail: string, extra?: string) {
    const message = extra ? `${code}: ${detail} (${extra})` : `${code}: ${detail}`;
    super(message);
    this.code = code;
    this.name = 'ExtractorError';
  }
}
