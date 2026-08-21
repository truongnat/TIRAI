// ---------------------------------------------------------------------------
// Excel AI Context Builder – provenance tracking
// ---------------------------------------------------------------------------

import type { CellInput, ChunkProvenance } from './models.js';
import { columnToLetter } from './table-view.js';

/**
 * Build provenance for a chunk from its cells.
 */
export function buildProvenance(
  sheetIndex: number,
  sheetName: string,
  cells: CellInput[],
  headerCells?: CellInput[],
): ChunkProvenance {
  const ranges = computeRanges(cells);
  const provenance: ChunkProvenance = {
    sheetIndex,
    sheetName,
    ranges,
  };

  // If header cells are from a different range than data, note them as repeated
  if (headerCells && headerCells.length > 0 && cells.length > 0) {
    const headerRange = computeRangeFromCells(headerCells);
    const dataRange = computeRangeFromCells(cells);
    // If header is outside data range, it's a repeated header
    if (headerRange !== dataRange && !dataRange.startsWith(headerRange.split(':')[0])) {
      provenance.repeatedHeaders = [headerRange];
    }
  }

  return provenance;
}

/**
 * Compute the minimal set of ranges covering all cells.
 */
function computeRanges(cells: CellInput[]): string[] {
  if (cells.length === 0) return [];
  return [computeRangeFromCells(cells)];
}

/**
 * Compute a single range string from a set of cells.
 */
function computeRangeFromCells(cells: CellInput[]): string {
  if (cells.length === 0) return '';
  const minRow = Math.min(...cells.map((c) => c.row));
  const maxRow = Math.max(...cells.map((c) => c.row));
  const minCol = Math.min(...cells.map((c) => c.column));
  const maxCol = Math.max(...cells.map((c) => c.column));

  const startAddr = `${columnToLetter(minCol)}${minRow}`;
  const endAddr = `${columnToLetter(maxCol)}${maxRow}`;

  if (startAddr === endAddr) return startAddr;
  return `${startAddr}:${endAddr}`;
}

/**
 * Generate a deterministic chunk ID.
 * Format: ctx-s{sheetIndex}-c{chunkIndex}
 */
export function generateChunkId(sheetIndex: number, chunkIndex: number): string {
  return `ctx-s${String(sheetIndex).padStart(3, '0')}-c${String(chunkIndex).padStart(3, '0')}`;
}
