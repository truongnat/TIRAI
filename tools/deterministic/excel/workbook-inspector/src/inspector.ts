// ---------------------------------------------------------------------------
// Workbook Inspector – core logic
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import type {
  WorkbookMetadata,
  FileMetadata,
  WorkbookInfo,
  WorkbookProperties,
  SheetInfo,
  SheetState,
  DefinedNameInfo,
  ExternalLinkInfo,
  CalculationInfo,
  Warning,
} from './models.js';
import { WarningCode, createWarning } from './warnings.js';

// ---- Public API -----------------------------------------------------------

/**
 * Inspect an Excel workbook file and return deterministic metadata.
 *
 * This function is pure with respect to the file content – it does not depend
 * on stdout/stderr, timestamps, or any external state.  It never modifies the
 * source file.
 *
 * @throws {InspectorError} on fatal errors (missing file, bad format, …).
 */
export async function inspectWorkbook(filePath: string): Promise<WorkbookMetadata> {
  const resolvedPath = path.resolve(filePath);
  const warnings: Warning[] = [];

  // -- 1. Validate file existence & extension ------------------------------
  if (!fs.existsSync(resolvedPath)) {
    throw new InspectorError('FILE_NOT_FOUND', resolvedPath);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new InspectorError('FILE_NOT_READABLE', resolvedPath);
  }

  const ext = path.extname(resolvedPath).toLowerCase();

  if (ext === '.xls') {
    throw new InspectorError(
      'UNSUPPORTED_FILE_FORMAT',
      'Legacy .xls format is not supported.',
    );
  }

  if (ext !== '.xlsx' && ext !== '.xlsm') {
    throw new InspectorError(
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

  // -- 3. Open workbook & load zip -----------------------------------------
  const workbook = new ExcelJS.Workbook();
  let zip: JSZip | null = null;
  let workbookXml: string | null = null;

  try {
    await workbook.xlsx.readFile(resolvedPath);
    const buf = fs.readFileSync(resolvedPath);
    zip = await JSZip.loadAsync(buf);
    // Pre-read the workbook XML for raw parsing.
    if (zip) {
      const wbXmlFile = zip.file('xl/workbook.xml');
      if (wbXmlFile) {
        workbookXml = await wbXmlFile.async('string');
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt|password|protected/i.test(msg)) {
      throw new InspectorError('ENCRYPTED_FILE', resolvedPath);
    }
    throw new InspectorError('CORRUPTED_WORKBOOK', resolvedPath, msg);
  }

  // -- 4. XLSM → macro warning --------------------------------------------
  if (ext === '.xlsm') {
    warnings.push(
      createWarning(
        WarningCode.MACRO_CONTENT_NOT_INSPECTED,
        'The workbook contains or may contain VBA content, but VBA is outside the scope of Workbook Inspector.',
      ),
    );
  }

  // -- 5. Workbook properties ----------------------------------------------
  const properties = extractProperties(workbook);

  // -- 6. Sheet inventory --------------------------------------------------
  const sheets = extractSheets(workbook, warnings);

  // -- 7. Defined names ----------------------------------------------------
  const definedNames = extractDefinedNames(workbook, workbookXml);

  // -- 8. External links ---------------------------------------------------
  const externalLinks = extractExternalLinks(zip, warnings);

  // -- 9. Calculation properties -------------------------------------------
  const calculation = extractCalculation(workbook, workbookXml, warnings);

  // -- 10. Assemble output -------------------------------------------------
  const workbookInfo: WorkbookInfo = {
    properties,
    sheets,
    definedNames,
    externalLinks,
    calculation,
  };

  return {
    schemaVersion: '1.0',
    file: fileMeta,
    workbook: workbookInfo,
    warnings,
  };
}

// ---- Fatal error ----------------------------------------------------------

export class InspectorError extends Error {
  readonly code: string;

  constructor(code: string, detail: string, extra?: string) {
    const message = extra ? `${code}: ${detail} (${extra})` : `${code}: ${detail}`;
    super(message);
    this.code = code;
    this.name = 'InspectorError';
  }
}

// ---- Property extraction --------------------------------------------------

function extractProperties(wb: ExcelJS.Workbook): WorkbookProperties {
  // ExcelJS exposes core properties directly on the workbook object.
  return {
    title: nullify(wb.title),
    subject: nullify(wb.subject),
    creator: nullify(wb.creator),
    keywords: nullify(wb.keywords),
    description: nullify(wb.description),
    lastModifiedBy: nullify(wb.lastModifiedBy),
    created: dateToString(wb.created),
    modified: dateToString(wb.modified),
    category: nullify(wb.category),
  };
}

// ---- Sheet extraction -----------------------------------------------------

function extractSheets(wb: ExcelJS.Workbook, warnings: Warning[]): SheetInfo[] {
  const sheets: SheetInfo[] = [];

  wb.worksheets.forEach((ws, idx) => {
    const sheetName = ws.name;

    // State
    const state = mapSheetState(ws.state, sheetName, warnings);

    // Dimension
    const { dimension, minRow, maxRow, minColumn, maxColumn } =
      extractDimension(ws, sheetName, warnings);

    // Freeze pane
    const freezePane = extractFreezePane(ws);

    // Auto filter
    const autoFilter = extractAutoFilter(ws);

    sheets.push({
      index: idx,
      name: sheetName,
      state,
      dimension,
      minRow,
      maxRow,
      minColumn,
      maxColumn,
      freezePane,
      autoFilter,
    });
  });

  return sheets;
}

function mapSheetState(
  rawState: string | undefined,
  sheetName: string,
  warnings: Warning[],
): SheetState {
  if (rawState === undefined || rawState === null) {
    return 'visible';
  }
  switch (rawState) {
    case 'visible':
    case '0':
      return 'visible';
    case 'hidden':
    case '1':
      return 'hidden';
    case 'veryHidden':
    case '2':
      return 'veryHidden';
    default: {
      warnings.push(
        createWarning(
          WarningCode.UNKNOWN_SHEET_STATE,
          `Sheet state "${rawState}" is not recognised; defaulting to "unknown".`,
          sheetName,
        ),
      );
      return 'unknown';
    }
  }
}

function extractDimension(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
): {
  dimension: string | null;
  minRow: number | null;
  maxRow: number | null;
  minColumn: number | null;
  maxColumn: number | null;
} {
  const dim = ws.dimensions;

  // If the dimension object has no meaningful data, treat as unknown.
  if (
    !dim ||
    dim.isEmpty ||
    (dim.top === 0 && dim.left === 0 && dim.bottom === 0 && dim.right === 0)
  ) {
    warnings.push(
      createWarning(
        WarningCode.SHEET_DIMENSION_UNRELIABLE,
        'Worksheet dimension could not be determined.',
        sheetName,
      ),
    );
    return {
      dimension: null,
      minRow: null,
      maxRow: null,
      minColumn: null,
      maxColumn: null,
    };
  }

  const minRow = dim.top;
  const maxRow = dim.bottom;
  const minCol = dim.left;
  const maxCol = dim.right;

  // Detect trivial A1:A1 dimension on a sheet that likely has no real data.
  // ExcelJS may report A1:A1 for sheets with no content.
  if (minRow === 1 && maxRow === 1 && minCol === 1 && maxCol === 1) {
    // Check if the sheet actually has any cell content.
    let hasContent = false;
    ws.eachRow({ includeEmpty: false }, () => {
      hasContent = true;
    });
    if (!hasContent) {
      warnings.push(
        createWarning(
          WarningCode.SHEET_DIMENSION_UNRELIABLE,
          'Worksheet dimension could not be determined.',
          sheetName,
        ),
      );
      return {
        dimension: null,
        minRow: null,
        maxRow: null,
        minColumn: null,
        maxColumn: null,
      };
    }
  }

  const dimensionStr =
    `${columnToLetter(minCol)}${minRow}:${columnToLetter(maxCol)}${maxRow}`;

  return {
    dimension: dimensionStr,
    minRow,
    maxRow,
    minColumn: minCol,
    maxColumn: maxCol,
  };
}

function extractFreezePane(ws: ExcelJS.Worksheet): string | null {
  const view = ws.views?.[0];
  if (!view || (!view.xSplit && !view.ySplit)) {
    return null;
  }
  // The freeze pane cell is (xSplit+1, ySplit+1) in 1-based.
  const col = (view.xSplit ?? 0) + 1;
  const row = (view.ySplit ?? 0) + 1;
  return `${columnToLetter(col)}${row}`;
}

function extractAutoFilter(ws: ExcelJS.Worksheet): string | null {
  const af = ws.autoFilter;
  if (!af) return null;

  // autoFilter can be a string like "A1:H10" or an object { from, to }.
  if (typeof af === 'string') {
    return af;
  }

  // Object form: { from: { row, column }, to: { row, column } }
  if (typeof af === 'object' && af !== null) {
    const from = (af as { from?: { row: number; column: number } }).from;
    const to = (af as { to?: { row: number; column: number } }).to;
    if (from && to) {
      return `${columnToLetter(from.column)}${from.row}:${columnToLetter(to.column)}${to.row}`;
    }
  }

  return null;
}

// ---- Defined Names --------------------------------------------------------

/**
 * Extract defined names.  We first try raw XML parsing from the workbook XML
 * (to capture `localSheetId` and `hidden`), then fall back to the ExcelJS
 * model which may not expose those attributes.
 */
function extractDefinedNames(
  wb: ExcelJS.Workbook,
  workbookXml: string | null,
): DefinedNameInfo[] {
  // Prefer raw XML parsing for complete information.
  if (workbookXml) {
    const parsed = parseDefinedNamesFromXml(workbookXml);
    if (parsed.length > 0) return parsed;
  }

  // Fallback: use the model.
  const result: DefinedNameInfo[] = [];
  const rawNames = wb.model.definedNames ?? [];

  for (const dn of rawNames) {
    if (!dn.name) continue;

    // After reading, ExcelJS stores ranges as an array of strings.
    const value =
      (dn as unknown as { formula?: string }).formula ??
      ((dn as unknown as { ranges?: string[] }).ranges ?? []).join(',');

    if (!value) continue;

    result.push({
      name: dn.name,
      value,
      scope: 'workbook',
      sheetIndex: null,
      hidden: false,
    });
  }

  return result;
}

/**
 * Parse <definedName> elements from the workbook XML.
 */
function parseDefinedNamesFromXml(xml: string): DefinedNameInfo[] {
  const result: DefinedNameInfo[] = [];
  const regex = /<definedName\s+([^>]*)>([\s\S]*?)<\/definedName>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1];
    const value = match[2].trim();

    const nameMatch = /name="([^"]*)"/.exec(attrs);
    const localSheetIdMatch = /localSheetId="([^"]*)"/.exec(attrs);
    const hiddenMatch = /hidden="([^"]*)"/.exec(attrs);

    if (!nameMatch) continue;

    const name = nameMatch[1];
    const scope: 'workbook' | 'sheet' = localSheetIdMatch ? 'sheet' : 'workbook';
    const sheetIndex = localSheetIdMatch ? parseInt(localSheetIdMatch[1], 10) : null;
    const hidden = hiddenMatch
      ? hiddenMatch[1] === '1' || hiddenMatch[1] === 'true'
      : false;

    result.push({ name, value, scope, sheetIndex, hidden });
  }

  return result;
}

// ---- External Links -------------------------------------------------------

function extractExternalLinks(
  zip: JSZip | null,
  warnings: Warning[],
): ExternalLinkInfo[] {
  const links: ExternalLinkInfo[] = [];

  if (zip) {
    try {
      const extFiles = zip.file(/^xl\/externalLinks\/externalLink\d+\.xml$/);
      if (extFiles && extFiles.length > 0) {
        for (const f of extFiles) {
          links.push({
            target: f.name,
            type: 'workbook',
          });
        }
      }
    } catch {
      // Silently ignore.
    }
  }

  // Always warn that external link detection is best-effort.
  warnings.push(
    createWarning(
      WarningCode.EXTERNAL_LINKS_NOT_FULLY_SUPPORTED,
      'External workbook links may not be fully detectable by the current parser.',
    ),
  );

  return links;
}

// ---- Calculation Properties -----------------------------------------------

function extractCalculation(
  wb: ExcelJS.Workbook,
  workbookXml: string | null,
  warnings: Warning[],
): CalculationInfo | null {
  // Try the high-level property first.
  try {
    const calc = (wb as unknown as { calcProperties?: Record<string, unknown> })
      .calcProperties;
    if (calc && Object.keys(calc).length > 0) {
      return {
        mode: (calc.calcMode as string) ?? 'auto',
        fullCalcOnLoad: toBoolOrNull(calc.fullCalcOnLoad),
        forceFullCalc: toBoolOrNull(calc.forceFullCalc),
        calcId: calc.calcId != null ? String(calc.calcId) : null,
      };
    }
  } catch {
    // Fall through.
  }

  // Try raw XML from the workbook.
  if (workbookXml) {
    try {
      const calcMatch =
        /<calcPr\s+([^/]*?)\/>/s.exec(workbookXml) ??
        /<calcPr\s+([^>]*)>/s.exec(workbookXml);
      if (calcMatch) {
        const attrs = calcMatch[1];
        const calcMode = /calcMode="([^"]*)"/.exec(attrs);
        const fullCalcOnLoad = /fullCalcOnLoad="([^"]*)"/.exec(attrs);
        const forceFullCalc = /forceFullCalc="([^"]*)"/.exec(attrs);
        const calcId = /calcId="([^"]*)"/.exec(attrs);

        return {
          mode: calcMode ? calcMode[1] : 'auto',
          fullCalcOnLoad: fullCalcOnLoad ? toBoolOrNull(fullCalcOnLoad[1]) : null,
          forceFullCalc: forceFullCalc ? toBoolOrNull(forceFullCalc[1]) : null,
          calcId: calcId ? calcId[1] : null,
        };
      }
    } catch {
      // Fall through to warning.
    }
  }

  warnings.push(
    createWarning(
      WarningCode.CALCULATION_PROPERTIES_NOT_SUPPORTED,
      'Calculation properties could not be read by the current parser.',
    ),
  );
  return null;
}

// ---- Helpers --------------------------------------------------------------

function nullify(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function dateToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const ts = v.getTime();
    if (Number.isNaN(ts)) return null;
    return v.toISOString();
  }
  return String(v);
}

function toBoolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * Convert a 1-based column number to an Excel column letter (A, B, …, Z, AA, …).
 */
export function columnToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
