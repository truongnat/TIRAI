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
  PerformanceProfile,
  SheetPerformanceProfile,
} from './models.js';
import { StyleRegistry } from './styles.js';
import { extractCells, type CellTraversalStats } from './cells.js';
import { extractMergedRanges, extractRows, extractColumns } from './layout.js';
import { extractValidations } from './validations.js';
import { extractTables } from './tables.js';
import { extractAnnotations } from './annotations.js';
import { extractObjects } from './objects.js';
import { extractConditionalFormatting } from './conditional-formatting.js';
import { extractPageSetup } from './page-setup.js';
import { columnToLetter } from './utils.js';
import { WarningCode, createWarning } from './warnings.js';
import { classifyCells, collectGarbage, createProfile, memorySnapshot, now, rssBytes } from './performance.js';
import { WorkbookOOXMLContext } from './ooxml-context.js';
import { loadExcelJsCompatibleBuffer } from './exceljs-compat.js';

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
  const profile = options.profilePerformance ? createProfile() : undefined;
  const extractionStart = profile ? now() : 0;

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
  let ooxmlContext: WorkbookOOXMLContext | undefined;
  try {
    const loadStart = profile ? now() : 0;
    const compatibleBuffer = await loadExcelJsCompatibleBuffer(resolvedPath);
    await workbook.xlsx.load(compatibleBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    if (profile) captureProfileMemory(profile, 'after-exceljs-load', options.profileForceGc);
    ooxmlContext = await WorkbookOOXMLContext.fromBuffer(compatibleBuffer);
    if (profile) {
      captureProfileMemory(profile, 'after-ooxml-context', options.profileForceGc);
      profile.workbookLoadMs = now() - loadStart;
      profile.rssAfterLoadBytes = rssBytes();
    }
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

    if (profile) captureProfileMemory(profile, `before-sheet:${idx}:${ws.name}`, options.profileForceGc);
    const sheet = await extractSheet(ws, idx, resolvedPath, options, profile, ooxmlContext);
    sheets.push(sheet);
    if (profile) captureProfileMemory(profile, `after-sheet:${idx}:${ws.name}`, options.profileForceGc);
  }

  const result: WorkbookLayoutMetadata = {
    schemaVersion: '1.0',
    file: fileMeta,
    sheets,
    warnings,
  };
  if (profile) {
    if (ooxmlContext) profile.ooxml = ooxmlContext.profile();
    profile.rssBeforeSerializationBytes = rssBytes();
    captureProfileMemory(profile, 'before-serialization', options.profileForceGc);
    profile.rssAfterSerializationBytes = rssBytes();
    profile.totalMs = now() - extractionStart;
    result.performanceProfile = profile;
  }
  return result;
}

// ---- Sheet extraction ----------------------------------------------------

async function extractSheet(
  ws: ExcelJS.Worksheet,
  index: number,
  filePath: string,
  options: ExtractOptions,
  profile?: PerformanceProfile,
  ooxmlContext?: WorkbookOOXMLContext,
): Promise<SheetLayoutData> {
  const sheetStart = profile ? now() : 0;
  const rssBeforeBytes = profile ? rssBytes() : 0;
  const profileMemoryStart = profile?.memory.length ?? 0;
  const sheetName = ws.name;
  const sheetWarnings: Warning[] = [];
  const styleRegistry = new StyleRegistry();
  const traversalStats: CellTraversalStats | undefined = profile
    ? { gridCoordinatesVisited: 0 }
    : undefined;
  const instantiatedCellsBefore = profile ? countInstantiatedCells(ws) : 0;

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
  const cellsStart = profile ? now() : 0;
  const cells = extractCells(
    ws,
    sheetName,
    styleRegistry,
    sheetWarnings,
    options.includeEmptyAll ?? false,
    traversalStats,
  );
  const cellsMs = profile ? now() - cellsStart : 0;
  if (profile) profile.memory.push(memorySnapshot(`after-cells:${index}:${sheetName}`));

  // Layout
  const layoutStart = profile ? now() : 0;
  const mergedRanges = extractMergedRanges(ws);
  const rows = extractRows(ws);
  const columns = extractColumns(ws);
  const layoutMs = profile ? now() - layoutStart : 0;

  // Phase 3: Validations, Tables, Annotations
  const validationsStart = profile ? now() : 0;
  const validations = extractValidations(ws, sheetName, sheetWarnings);
  const validationsMs = profile ? now() - validationsStart : 0;
  const tablesStart = profile ? now() : 0;
  const tables = extractTables(ws, sheetName, sheetWarnings);
  const tablesMs = profile ? now() - tablesStart : 0;
  const annotationsStart = profile ? now() : 0;
  const annotations = extractAnnotations(ws, sheetName, sheetWarnings);
  const annotationsMs = profile ? now() - annotationsStart : 0;

  // Phase 4: Drawing Objects (images, shapes, charts)
  const objectsStart = profile ? now() : 0;
  const objects = await extractObjects(filePath, index, sheetName, sheetWarnings, options, ooxmlContext);
  const objectsMs = profile ? now() - objectsStart : 0;

  // Phase 5: Conditional Formatting, Page Setup, Array Formulas
  const conditionalFormattingStart = profile ? now() : 0;
  const conditionalFormatting = await extractConditionalFormatting(
    filePath, index, sheetName, sheetWarnings, ooxmlContext,
  );
  const conditionalFormattingMs = profile ? now() - conditionalFormattingStart : 0;
  const pageSetupStart = profile ? now() : 0;
  const pageSetup = await extractPageSetup(filePath, index, sheetName, sheetWarnings, ooxmlContext);
  const pageSetupMs = profile ? now() - pageSetupStart : 0;
  const arrayFormulasStart = profile ? now() : 0;
  const arrayFormulasFromModel = extractArrayFormulas(ws, sheetName, sheetWarnings);
  const arrayFormulasFromXml = await extractArrayFormulasFromXml(filePath, index, sheetName, sheetWarnings, ooxmlContext);
  // Merge: prefer XML results, add any from model that aren't in XML
  const arrayFormulas = mergeArrayFormulas(arrayFormulasFromXml, arrayFormulasFromModel);
  const arrayFormulasMs = profile ? now() - arrayFormulasStart : 0;
  if (profile) profile.memory.push(memorySnapshot(`after-features:${index}:${sheetName}`));

  // Styles
  const styles = styleRegistry.toMap();

  const result: SheetLayoutData = {
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
  if (profile) {
    const classification = classifyCells(cells, (address) => ws.getCell(address).isMerged);
    const sheetForSize = JSON.stringify(result);
    const instantiatedCellsAfter = countInstantiatedCells(ws);
    const instantiatedCells = instantiatedCellsAfter;
    captureProfileMemory(profile, `after-sheet-result:${index}:${sheetName}`, options.profileForceGc);
    const sheetMemory = profile.memory.slice(profileMemoryStart);
    const sheetProfile: SheetPerformanceProfile = {
      index,
      name: sheetName,
      runtimeMs: now() - sheetStart,
      cellsMs,
      layoutMs,
      validationsMs,
      tablesMs,
      annotationsMs,
      objectsMs,
      conditionalFormattingMs,
      pageSetupMs,
      arrayFormulasMs,
      cellsEmitted: cells.length,
      ...classification,
      declaredRows: rowCount ?? 0,
      declaredColumns: columnCount ?? 0,
      instantiatedCells,
      mergedRanges: mergedRanges.length,
      styles: Object.keys(styles).length,
      validations: validations.length,
      tables: tables.length,
      annotations: annotations.length,
      objects: objects.length,
      conditionalFormatting: conditionalFormatting.length,
      outputBytes: Buffer.byteLength(sheetForSize),
      rssBeforeBytes,
      rssAfterBytes: rssBytes(),
      memory: sheetMemory,
      rssDeltaBytes: rssBytes() - rssBeforeBytes,
      heapDeltaBytes: process.memoryUsage().heapUsed,
      estimatedSheetObjectBytes: Buffer.byteLength(sheetForSize),
      instantiatedCellsBefore,
      instantiatedCellsAfter,
      gridCoordinatesVisited: traversalStats?.gridCoordinatesVisited ?? 0,
      visitToEmissionRatio: cells.length === 0 ? 0 : (traversalStats?.gridCoordinatesVisited ?? 0) / cells.length,
    };
    const before = sheetProfile.memory.find((snapshot) => snapshot.label === `before-sheet:${index}:${sheetName}`);
    if (before) sheetProfile.heapDeltaBytes -= before.heapUsedBytes;
    profile.sheets.push(sheetProfile);
    profile.memory.push(memorySnapshot(`after-sheet-result:${index}:${sheetName}`));
  }
  return result;
}

function countInstantiatedCells(ws: ExcelJS.Worksheet): number {
  const rows = (ws as unknown as { _rows?: unknown[] })._rows ?? [];
  return rows.reduce<number>((count, row) => {
    const cells = (row as { _cells?: unknown[] })._cells;
    return count + (cells?.length ?? 0);
  }, 0);
}

function captureProfileMemory(
  profile: PerformanceProfile,
  label: string,
  forceGc = false,
): void {
  profile.memory.push(memorySnapshot(label));
  if (forceGc && collectGarbage()) profile.memory.push(memorySnapshot(`${label}:after-gc`));
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
  ooxmlContext?: WorkbookOOXMLContext,
): Promise<ArrayFormulaRaw[]> {
  const result: ArrayFormulaRaw[] = [];

  try {
    const context = ooxmlContext ?? await WorkbookOOXMLContext.fromFile(filePath);

    const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const sheetXml = await context.text(sheetPath);
    if (sheetXml === null) return result;

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
