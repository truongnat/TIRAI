// ---------------------------------------------------------------------------
// Excel AI Context Builder – logical chunker
// ---------------------------------------------------------------------------
// Splits large sheets into semantic chunks without losing table structure.

import type {
  CellInput,
  SheetLayoutInput,
  ContextBuilderOptions,
  ContextWarning,
  ContextChunk,
  LayoutHints,
} from './models.js';
import { WarningCode } from './warnings.js';
import { formatTabular, formatTabularRows } from './table-view.js';
import { buildProvenance } from './provenance.js';

const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_MAX_CELLS = 500;

export interface ChunkPlan {
  sheetIndex: number;
  sheetName: string;
  dimension: string | null;
  cells: CellInput[];
  headerCells: CellInput[];
  rowRange: { startRow: number; endRow: number };
  headerRowRange: string | null;
  dataRange: string;
  layoutHints: LayoutHints | null;
}

/**
 * Build chunk plans for a single sheet.
 * If the sheet fits within limits → single chunk.
 * Otherwise → split by row boundaries, repeating headers.
 */
export function planChunks(
  sheet: SheetLayoutInput,
  options: ContextBuilderOptions,
): { plans: ChunkPlan[]; warnings: ContextWarning[] } {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
  const warnings: ContextWarning[] = [];

  const cells = sheet.cells;
  if (cells.length === 0) {
    return { plans: [], warnings };
  }

  // Detect header row (first row with content across multiple columns)
  const headerRowNum = detectHeaderRow(cells);
  const headerCells = cells.filter((c) => c.row === headerRowNum);

  // Group cells by row
  const rowGroups = groupByRow(cells);
  const rowNumbers = [...rowGroups.keys()].sort((a, b) => a - b);

  // Estimate content size for the whole sheet
  const fullContent = formatTabular(sheet, cells);
  const fullCharCount = fullContent.length;

  // If fits in one chunk → single plan
  if (fullCharCount <= maxChars && cells.length <= maxCells) {
    const plan: ChunkPlan = {
      sheetIndex: sheet.index,
      sheetName: sheet.name,
      dimension: sheet.dimension,
      cells,
      headerCells,
      rowRange: { startRow: rowNumbers[0], endRow: rowNumbers[rowNumbers.length - 1] },
      headerRowRange: headerRowNum ? `${headerRowNum}:${headerRowNum}` : null,
      dataRange: sheet.dimension || `${rowNumbers[0]}:${rowNumbers[rowNumbers.length - 1]}`,
      layoutHints: buildLayoutHints(sheet),
    };
    return { plans: [plan], warnings };
  }

  // Need to split – determine data rows (excluding header)
  const dataRows = rowNumbers.filter((r) => r !== headerRowNum);
  const plans: ChunkPlan[] = [];

  let currentRows: number[] = [];
  let currentCharEstimate = 0;

  // Estimate chars per row for splitting
  const headerCharEstimate = estimateCharsForRows(headerCells, sheet);

  for (const rowNum of dataRows) {
    const rowCells = rowGroups.get(rowNum) || [];
    const rowCharEstimate = estimateCharsForRows(rowCells, sheet);

    // Would adding this row exceed limits?
    const withHeader = currentRows.length === 0
      ? rowCharEstimate + headerCharEstimate
      : rowCharEstimate + headerCharEstimate + currentCharEstimate;

    const wouldExceedChars = withHeader > maxChars;
    const wouldExceedCells = (currentRows.length + 1) * (sheet.columnCount || 1) > maxCells;

    // Check merged range protection
    const crossesMerge = mergedRangeCrossed(sheet, currentRows, rowNum);

    if (currentRows.length > 0 && (wouldExceedChars || wouldExceedCells || crossesMerge)) {
      if (crossesMerge) {
        warnings.push({
          code: WarningCode.CHUNK_SPLIT_COMPLEX_RANGE,
          message: `Chunk boundary may split merged range near row ${rowNum} in sheet "${sheet.name}".`,
          sheet: sheet.name,
        });
      }

      // Flush current chunk
      plans.push(makePlan(sheet, headerCells, currentRows, rowGroups));

      // Start new chunk
      currentRows = [rowNum];
      currentCharEstimate = rowCharEstimate;
    } else {
      currentRows.push(rowNum);
      currentCharEstimate += rowCharEstimate;
    }
  }

  // Flush remaining
  if (currentRows.length > 0) {
    plans.push(makePlan(sheet, headerCells, currentRows, rowGroups));
  }

  // If no plans were created (edge case), create one with all cells
  if (plans.length === 0) {
    plans.push({
      sheetIndex: sheet.index,
      sheetName: sheet.name,
      dimension: sheet.dimension,
      cells,
      headerCells,
      rowRange: { startRow: rowNumbers[0], endRow: rowNumbers[rowNumbers.length - 1] },
      headerRowRange: null,
      dataRange: sheet.dimension || '',
      layoutHints: buildLayoutHints(sheet),
    });
  }

  return { plans, warnings };
}

/**
 * Generate the content string for a chunk plan.
 */
export function generateChunkContent(plan: ChunkPlan, isFirstChunk: boolean): string {
  if (isFirstChunk) {
    // First chunk includes everything
    return formatTabular(
      { name: plan.sheetName, dimension: plan.dimension } as SheetLayoutInput,
      plan.cells,
    );
  }
  // Subsequent chunks repeat header
  return formatTabularRows(
    plan.sheetName,
    plan.dimension,
    plan.cells,
    plan.rowRange,
    plan.headerCells.length > 0 ? plan.headerCells : undefined,
  );
}

// ---- Helpers --------------------------------------------------------------

function makePlan(
  sheet: SheetLayoutInput,
  headerCells: CellInput[],
  rowNumbers: number[],
  rowGroups: Map<number, CellInput[]>,
): ChunkPlan {
  const startRow = Math.min(...rowNumbers);
  const endRow = Math.max(...rowNumbers);
  const dataCells: CellInput[] = [];
  for (const r of rowNumbers) {
    dataCells.push(...(rowGroups.get(r) || []));
  }

  return {
    sheetIndex: sheet.index,
    sheetName: sheet.name,
    dimension: sheet.dimension,
    cells: dataCells,
    headerCells,
    rowRange: { startRow, endRow },
    headerRowRange: headerCells.length > 0 ? `${headerCells[0].row}:${headerCells[0].row}` : null,
    dataRange: `${startRow}:${endRow}`,
    layoutHints: buildLayoutHints(sheet, startRow, endRow),
  };
}

function detectHeaderRow(cells: CellInput[]): number {
  if (cells.length === 0) return 1;
  const minRow = Math.min(...cells.map((c) => c.row));
  return minRow;
}

function groupByRow(cells: CellInput[]): Map<number, CellInput[]> {
  const map = new Map<number, CellInput[]>();
  for (const c of cells) {
    if (!map.has(c.row)) map.set(c.row, []);
    map.get(c.row)!.push(c);
  }
  return map;
}

function estimateCharsForRows(cells: CellInput[], _sheet: SheetLayoutInput): number {
  let total = 0;
  for (const c of cells) {
    const val = c.displayValue || String(c.rawValue ?? '');
    total += val.length + 3; // separator overhead
  }
  return total + 20; // row overhead
}

function mergedRangeCrossed(
  sheet: SheetLayoutInput,
  currentRows: number[],
  nextRow: number,
): boolean {
  if (currentRows.length === 0) return false;
  const lastCurrentRow = Math.max(...currentRows);
  const boundary = lastCurrentRow;

  for (const merge of sheet.mergedRanges) {
    // If a merged range spans the boundary between current chunk and next
    if (merge.topRow <= boundary && merge.bottomRow > boundary && merge.bottomRow >= nextRow) {
      return true;
    }
  }
  return false;
}

function buildLayoutHints(
  sheet: SheetLayoutInput,
  startRow?: number,
  endRow?: number,
): LayoutHints | null {
  const hints: LayoutHints = {};
  let hasContent = false;

  // Header rows
  if (sheet.cells.length > 0) {
    const minRow = Math.min(...sheet.cells.map((c) => c.row));
    hints.headerRows = [minRow];
    hasContent = true;
  }

  // Merged ranges (filtered to row scope if specified)
  if (sheet.mergedRanges.length > 0) {
    const filtered = startRow !== undefined && endRow !== undefined
      ? sheet.mergedRanges.filter((m) => m.topRow >= startRow && m.bottomRow <= endRow)
      : sheet.mergedRanges;
    if (filtered.length > 0) {
      hints.mergedRanges = filtered.map((m) => m.range);
      hasContent = true;
    }
  }

  // Hidden rows
  const hiddenRows = sheet.rows.filter((r) => r.hidden);
  if (hiddenRows.length > 0) {
    const filtered = startRow !== undefined && endRow !== undefined
      ? hiddenRows.filter((r) => r.row >= startRow && r.row <= endRow)
      : hiddenRows;
    if (filtered.length > 0) {
      hints.hiddenRows = filtered.map((r) => r.row);
      hasContent = true;
    }
  }

  // Hidden columns
  const hiddenCols = sheet.columns.filter((c) => c.hidden);
  if (hiddenCols.length > 0) {
    hints.hiddenColumns = hiddenCols.map((c) => c.column);
    hasContent = true;
  }

  return hasContent ? hints : null;
}
