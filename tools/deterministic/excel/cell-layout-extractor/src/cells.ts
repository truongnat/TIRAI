// ---------------------------------------------------------------------------
// Cell extraction – values, formulas, types, hyperlinks, comments
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import type {
  CellRaw,
  CellType,
  SourceReference,
  Warning,
} from './models.js';
import { StyleRegistry, extractStyleFromCell, isDefaultStyle } from './styles.js';
import { WarningCode, createWarning } from './warnings.js';

/**
 * Extract all meaningful cells from a worksheet.
 *
 * "Meaningful" = has value, formula, hyperlink, comment, or non-default style.
 * Empty cells with style/layout significance are included.
 */
export function extractCells(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  styleRegistry: StyleRegistry,
  warnings: Warning[],
  includeEmptyAll: boolean,
): CellRaw[] {
  const cells: CellRaw[] = [];

  // Always iterate with includeEmpty: true so we can detect empty cells
  // that have style significance (borders, fills, etc.).
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const maxCol = ws.columnCount ?? row.cellCount ?? 0;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      // Guard against iterating beyond actual column range.
      if (colNumber > maxCol && maxCol > 0) return;

      const source: SourceReference = {
        sheet: sheetName,
        cell: cell.address,
      };

      const style = extractStyleFromCell(cell);
      const hasStyle = !isDefaultStyle(style);
      const styleId = hasStyle ? styleRegistry.register(style) : null;

      const hasValue = cell.value !== null && cell.value !== undefined;
      const hasFormula = cell.type === ExcelJS.ValueType.Formula;
      const hasHyperlink = !!cell.hyperlink;
      const hasComment = !!cell.note;

      // Skip truly empty cells with no style/hyperlink/comment.
      if (!hasValue && !hasStyle && !hasHyperlink && !hasComment) return;

      const { rawValue, displayValue, type, formula, cachedResult, numFmt, isRichText } =
        extractCellValue(cell, hasFormula, warnings, sheetName, cell.address);

      cells.push({
        address: cell.address,
        row: cell.row,
        column: cell.col,
        rawValue,
        displayValue,
        type,
        formula,
        cachedResult,
        numFmt,
        styleId,
        hyperlink: extractHyperlink(cell),
        comment: extractComment(cell),
        isRichText,
        source,
      });
    });
  });

  // Sort row-major: by row, then by column.
  cells.sort((a, b) => a.row - b.row || a.column - b.column);

  return cells;
}

// ---- Value extraction ----------------------------------------------------

interface CellValueResult {
  rawValue: unknown;
  displayValue: string | null;
  type: CellType | null;
  formula: string | null;
  cachedResult: unknown;
  numFmt: string | null;
  isRichText: boolean;
}

function extractCellValue(
  cell: ExcelJS.Cell,
  hasFormula: boolean,
  warnings: Warning[],
  sheetName: string,
  address: string,
): CellValueResult {
  const numFmt = cell.numFmt || null;

  // Formula cell
  if (hasFormula) {
    const formulaStr =
      (cell.value as ExcelJS.FormulaCellValue).formula ??
      (cell.value as ExcelJS.SharedFormulaCellValue).sharedFormula ??
      null;
    const result = (cell.value as ExcelJS.FormulaCellValue).result ?? null;

    if (result === null && formulaStr !== null) {
      warnings.push(
        createWarning(
          WarningCode.FORMULA_CACHED_VALUE_MISSING,
          'Formula has no cached result value.',
          sheetName,
          address,
        ),
      );
    }

    return {
      rawValue: result,
      displayValue: cell.text || null,
      type: 'formula',
      formula: formulaStr,
      cachedResult: serializeValue(result),
      numFmt,
      isRichText: false,
    };
  }

  // Rich text
  if (cell.type === ExcelJS.ValueType.RichText) {
    const rt = cell.value as ExcelJS.CellRichTextValue;
    const plainText = rt.richText
      .map((seg) => (typeof seg === 'string' ? seg : seg.text ?? ''))
      .join('');
    return {
      rawValue: serializeRichText(rt),
      displayValue: cell.text || plainText || null,
      type: 'richtext',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: true,
    };
  }

  // Hyperlink (cell with hyperlink but no formula)
  if (cell.type === ExcelJS.ValueType.Hyperlink) {
    const hv = cell.value as ExcelJS.HyperlinkValue;
    return {
      rawValue: hv.text ?? null,
      displayValue: cell.text || hv.text || null,
      type: 'string',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  // Primitive types
  const val = cell.value;

  if (val === null || val === undefined) {
    return {
      rawValue: null,
      displayValue: cell.text || null,
      type: null,
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  if (typeof val === 'number') {
    return {
      rawValue: val,
      displayValue: cell.text || String(val),
      type: 'number',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  if (typeof val === 'string') {
    return {
      rawValue: val,
      displayValue: cell.text || val,
      type: 'string',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  if (typeof val === 'boolean') {
    return {
      rawValue: val,
      displayValue: cell.text || String(val),
      type: 'boolean',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  if (val instanceof Date) {
    return {
      rawValue: val.toISOString(),
      displayValue: cell.text || val.toISOString(),
      type: 'date',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  // Error type
  if (cell.type === ExcelJS.ValueType.Error) {
    const errVal = val as ExcelJS.CellErrorValue;
    return {
      rawValue: errVal.error,
      displayValue: cell.text || String(errVal.error),
      type: 'error',
      formula: null,
      cachedResult: null,
      numFmt,
      isRichText: false,
    };
  }

  // Fallback – stringify unknown types
  return {
    rawValue: String(val),
    displayValue: cell.text || String(val),
    type: 'string',
    formula: null,
    cachedResult: null,
    numFmt,
    isRichText: false,
  };
}

// ---- Helpers -------------------------------------------------------------

function extractHyperlink(cell: ExcelJS.Cell): string | null {
  if (!cell.hyperlink) return null;
  if (typeof cell.hyperlink === 'string') return cell.hyperlink;
  return (cell.hyperlink as ExcelJS.Hyperlink).hyperlink ?? null;
}

function extractComment(cell: ExcelJS.Cell): string | null {
  if (!cell.note) return null;
  if (typeof cell.note === 'string') return cell.note;
  // Comment object
  const note = cell.note as ExcelJS.Comment;
  if (note.texts) {
    return note.texts.map((t) => t.text ?? '').join('');
  }
  return note.text ?? null;
}

function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.parse(JSON.stringify(val));
  return val;
}

function serializeRichText(rt: ExcelJS.CellRichTextValue): unknown {
  return {
    richText: rt.richText.map((seg) => {
      if (typeof seg === 'string') return { text: seg };
      return {
        text: seg.text ?? '',
        font: seg.font
          ? {
              name: seg.font.name ?? null,
              size: seg.font.size ?? null,
              bold: seg.font.bold ?? false,
              italic: seg.font.italic ?? false,
              color: seg.font.color?.argb ?? null,
            }
          : null,
      };
    }),
  };
}
