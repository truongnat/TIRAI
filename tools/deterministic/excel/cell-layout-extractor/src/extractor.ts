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
  ArrayFormulaRaw,
  SourceReference,
} from './models.js';
import { StyleRegistry } from './styles.js';
import { extractCells } from './cells.js';
import { extractMergedRanges, extractRows, extractColumns } from './layout.js';
import { extractValidations } from './validations.js';
import { extractTables } from './tables.js';
import { extractAnnotations } from './annotations.js';
import { extractObjects } from './objects.js';
import { extractConditionalFormatting } from './conditional-formatting.js';
import { extractPageSetup } from './page-setup.js';
import { columnToLetter } from './utils.js';
import { WarningCode, createWarning } from './warnings.js';

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

  if (dim && !(dim.top === 0 && dim.left === 0 && dim.bottom === 0 && dim.right === 0)) {
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

  // Phase 5: Conditional Formatting, Page Setup, Array Formulas
  const conditionalFormatting = await extractConditionalFormatting(
    filePath, index, sheetName, sheetWarnings,
  );
  const pageSetup = await extractPageSetup(filePath, index, sheetName, sheetWarnings);
  const arrayFormulasFromModel = extractArrayFormulas(ws, sheetName, sheetWarnings);
  const arrayFormulasFromXml = await extractArrayFormulasFromXml(filePath, index, sheetName, sheetWarnings);
  // Merge: prefer XML results, add any from model that aren't in XML
  const arrayFormulas = mergeArrayFormulas(arrayFormulasFromXml, arrayFormulasFromModel);

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
    conditionalFormatting,
    pageSetup,
    arrayFormulas,
    warnings: sheetWarnings,
  }
}

// ---- Array Formulas (Phase 5) -------------------------------------------

function extractArrayFormulas(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
): ArrayFormulaRaw[] {
  const result: ArrayFormulaRaw[] = [];

  // Try ExcelJS cell model first (for workbooks written by ExcelJS)
  ws.eachRow({ includeEmpty: true }, (_row, _rowNumber) => {
    _row.eachCell({ includeEmpty: false }, (cell, _colNumber) => {
      const model = cell.model as { formulaType?: number; formula?: string; ref?: string; result?: unknown } | undefined;
      if (!model || model.formulaType !== 2) return;

      const formula = model.formula ?? null;
      const ref = model.ref ?? null;

      if (!formula || !ref) {
        warnings.push(
          createWarning(
            WarningCode.ARRAY_FORMULA_PARTIAL,
            `Array formula at ${cell.address} is missing formula or range.`,
            sheetName,
            cell.address,
          ),
        );
        return;
      }

      const source: SourceReference = { sheet: sheetName, cell: cell.address };
      const cachedResult = model.result ?? null;

      result.push({
        masterCell: cell.address,
        range: ref,
        formula,
        cachedResult: cachedResult !== undefined ? cachedResult : null,
        source,
      });
    });
  });

  // Sort deterministically by master cell position
  result.sort((a, b) => a.masterCell.localeCompare(b.masterCell));

  return result;
}

/**
 * Extract array formulas from raw OOXML sheet XML via JSZip.
 * This catches array formulas that ExcelJS doesn't expose via its cell model.
 */
async function extractArrayFormulasFromXml(
  filePath: string,
  sheetIndex: number,
  sheetName: string,
  warnings: Warning[],
): Promise<ArrayFormulaRaw[]> {
  const result: ArrayFormulaRaw[] = [];

  try {
    const JSZip = (await import('jszip')).default;
    const fs = await import('node:fs');
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));

    const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) return result;

    const sheetXml = await sheetFile.async('string');

    // Match cells with array formulas: <f t="array" ref="C2:C10">FORMULA</f>
    // The cell is: <c r="C2" ...><f t="array" ref="C2:C10">...</f><v>...</v></c>
    const cellRegex = /<c\s+r="([^"]+)"[^>]*>([\s\S]*?)<\/c>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(sheetXml)) !== null) {
      const cellRef = cellMatch[1];
      const cellContent = cellMatch[2];

      // Check for array formula
      const arrayMatch = /<f\s+t="array"\s+ref="([^"]+)">([\s\S]*?)<\/f>/.exec(cellContent);
      if (!arrayMatch) continue;

      const range = arrayMatch[1];
      const formula = arrayMatch[2];

      // Extract cached value
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cellContent);
      const cachedResult = valueMatch ? parseXmlValue(valueMatch[1]) : null;

      const source: SourceReference = { sheet: sheetName, cell: cellRef };

      result.push({
        masterCell: cellRef,
        range,
        formula,
        cachedResult,
        source,
      });
    }
  } catch (err) {
    warnings.push(
      createWarning(
        WarningCode.ARRAY_FORMULA_PARTIAL,
        `Failed to parse array formulas from XML: ${err instanceof Error ? err.message : String(err)}`,
        sheetName,
      ),
    );
  }

  result.sort((a, b) => a.masterCell.localeCompare(b.masterCell));
  return result;
}

function parseXmlValue(val: string): unknown {
  if (val === '' || val === '#N/A') return null;
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== '') return num;
  if (val === 'TRUE') return true;
  if (val === 'FALSE') return false;
  return val;
}

function mergeArrayFormulas(
  fromXml: ArrayFormulaRaw[],
  fromModel: ArrayFormulaRaw[],
): ArrayFormulaRaw[] {
  const seen = new Set(fromXml.map((af) => af.masterCell));
  const merged = [...fromXml];
  for (const af of fromModel) {
    if (!seen.has(af.masterCell)) {
      merged.push(af);
    }
  }
  merged.sort((a, b) => a.masterCell.localeCompare(b.masterCell));
  return merged;
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
