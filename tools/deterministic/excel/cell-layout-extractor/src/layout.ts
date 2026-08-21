// ---------------------------------------------------------------------------
// Layout extraction – merged cells, row/column dimensions, hidden, outline
// ---------------------------------------------------------------------------

import type ExcelJS from 'exceljs';
import type {
  RowRaw,
  ColumnRaw,
  MergeRangeRaw,
  Warning,
} from './models.js';
import { WarningCode, createWarning } from './warnings.js';
import { columnToLetter } from './utils.js';

// ---- Merged cells --------------------------------------------------------

/**
 * Extract merged cell ranges from a worksheet.
 * Uses the worksheet model's merges array.
 */
export function extractMergedRanges(ws: ExcelJS.Worksheet): MergeRangeRaw[] {
  const merges: string[] = (ws.model as { merges?: string[] })?.merges ?? [];
  const result: MergeRangeRaw[] = [];

  for (const merge of merges) {
    const parsed = parseRange(merge);
    if (!parsed) continue;

    result.push({
      range: merge,
      masterCell: `${columnToLetter(parsed.leftColumn)}${parsed.topRow}`,
      topRow: parsed.topRow,
      leftColumn: parsed.leftColumn,
      bottomRow: parsed.bottomRow,
      rightColumn: parsed.rightColumn,
    });
  }

  // Sort deterministically: by topRow, then leftColumn.
  result.sort((a, b) => a.topRow - b.topRow || a.leftColumn - b.leftColumn);

  return result;
}

// ---- Row metadata --------------------------------------------------------

/**
 * Extract row metadata (height, hidden, outline level) for all rows
 * that have non-default properties.
 */
export function extractRows(ws: ExcelJS.Worksheet): RowRaw[] {
  const rows: RowRaw[] = [];

  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const height = row.height ?? null;
    const hidden = row.hidden ?? false;
    const outlineLevel = row.outlineLevel ?? 0;

    // Include row if it has any non-default property.
    if (height !== null || hidden || outlineLevel > 0) {
      rows.push({ row: rowNumber, height, hidden, outlineLevel });
    }
  });

  return rows;
}

// ---- Column metadata -----------------------------------------------------

/**
 * Extract column metadata (width, hidden, outline level) for all columns
 * that have non-default properties.
 */
export function extractColumns(ws: ExcelJS.Worksheet): ColumnRaw[] {
  const columns: ColumnRaw[] = [];

  // ws.columns returns column objects for columns that have been defined.
  const wsColumns = ws.columns;
  if (wsColumns && typeof wsColumns[Symbol.iterator] === 'function') {
    for (const col of wsColumns) {
      const colNumber = col.number;
      const width = col.width ?? null;
      const hidden = col.hidden ?? false;
      const outlineLevel = (col as unknown as { outlineLevel?: number }).outlineLevel ?? 0;

      if (width !== null || hidden || outlineLevel > 0) {
        columns.push({ column: colNumber, width, hidden, outlineLevel });
      }
    }
  }

  // Also check the model for columns not exposed via ws.columns.
  const modelColumns = (ws.model as { cols?: Array<{ min: number; max: number; width?: number; hidden?: boolean; outlineLevel?: number }> })?.cols;
  if (modelColumns) {
    for (const mc of modelColumns) {
      for (let c = mc.min; c <= mc.max; c++) {
        // Skip if already added via ws.columns.
        if (columns.some((col) => col.column === c)) continue;

        const width = mc.width ?? null;
        const hidden = mc.hidden ?? false;
        const outlineLevel = mc.outlineLevel ?? 0;

        if (width !== null || hidden || outlineLevel > 0) {
          columns.push({ column: c, width, hidden, outlineLevel });
        }
      }
    }
  }

  columns.sort((a, b) => a.column - b.column);
  return columns;
}

// ---- Helpers -------------------------------------------------------------

/** Parse "A1:C3" into { topRow, leftColumn, bottomRow, rightColumn }. */
function parseRange(
  range: string,
): { topRow: number; leftColumn: number; bottomRow: number; rightColumn: number } | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!match) return null;

  return {
    topRow: parseInt(match[2], 10),
    leftColumn: letterToColumn(match[1]),
    bottomRow: parseInt(match[4], 10),
    rightColumn: letterToColumn(match[3]),
  };
}

/** Convert column letter(s) to 1-based column number. A=1, B=2, …, Z=26, AA=27. */
function letterToColumn(letters: string): number {
  let result = 0;
  for (const ch of letters) {
    result = result * 26 + (ch.charCodeAt(0) - 64);
  }
  return result;
}
