// ---------------------------------------------------------------------------
// Excel AI Context Builder – tabular formatter
// ---------------------------------------------------------------------------
// Converts raw cell data into AI-friendly textual representation.

import type { CellInput, SheetLayoutInput } from './models.js';

/**
 * Format a sheet's cells as a readable tabular text representation.
 *
 * Output format:
 *   Sheet: <name>
 *   Range: <dimension>
 *
 *   Columns:
 *   A: <header>
 *   B: <header>
 *   ...
 *
 *   Rows:
 *   <row#> | <val> | <val> | ...
 */
export function formatTabular(
  sheet: SheetLayoutInput,
  cells: CellInput[],
): string {
  if (cells.length === 0) {
    return `Sheet: ${sheet.name}\n(empty sheet)`;
  }

  const lines: string[] = [];
  lines.push(`Sheet: ${sheet.name}`);
  if (sheet.dimension) {
    lines.push(`Range: ${sheet.dimension}`);
  }
  lines.push('');

  // Build a cell lookup by address
  const cellMap = new Map<string, CellInput>();
  for (const c of cells) {
    cellMap.set(c.address, c);
  }

  // Determine column range
  const minCol = Math.min(...cells.map((c) => c.column));
  const maxCol = Math.max(...cells.map((c) => c.column));
  const minRow = Math.min(...cells.map((c) => c.row));
  const maxRow = Math.max(...cells.map((c) => c.row));

  // Column headers
  const colLetters: string[] = [];
  for (let col = minCol; col <= maxCol; col++) {
    colLetters.push(columnToLetter(col));
  }

  // Header row (first row)
  const headerRow = minRow;
  const headers: string[] = [];
  for (let col = minCol; col <= maxCol; col++) {
    const addr = `${columnToLetter(col)}${headerRow}`;
    const cell = cellMap.get(addr);
    headers.push(cell ? getDisplayValue(cell) : '');
  }

  lines.push('Columns:');
  for (let i = 0; i < colLetters.length; i++) {
    lines.push(`${colLetters[i]}: ${headers[i]}`);
  }
  lines.push('');

  // Data rows (skip header)
  lines.push('Rows:');
  for (let row = headerRow + 1; row <= maxRow; row++) {
    const vals: string[] = [];
    for (let col = minCol; col <= maxCol; col++) {
      const addr = `${columnToLetter(col)}${row}`;
      const cell = cellMap.get(addr);
      vals.push(cell ? formatCellValue(cell) : '');
    }
    lines.push(`${row} | ${vals.join(' | ')}`);
  }

  return lines.join('\n');
}

/**
 * Format a subset of rows (for chunking).
 * If `headerRows` is provided, they are prepended as column headers.
 */
export function formatTabularRows(
  sheetName: string,
  dimension: string | null,
  cells: CellInput[],
  rowRange: { startRow: number; endRow: number },
  headerRows?: CellInput[],
): string {
  const lines: string[] = [];
  lines.push(`Sheet: ${sheetName}`);
  if (dimension) {
    lines.push(`Range: ${dimension}`);
  }
  lines.push('');

  // Build cell lookup
  const cellMap = new Map<string, CellInput>();
  for (const c of cells) {
    cellMap.set(c.address, c);
  }

  // Determine column range from all cells
  const allCells = [...cells, ...(headerRows || [])];
  const minCol = Math.min(...allCells.map((c) => c.column));
  const maxCol = Math.max(...allCells.map((c) => c.column));

  // Column headers from header rows
  if (headerRows && headerRows.length > 0) {
    const headerMap = new Map<string, CellInput>();
    for (const c of headerRows) {
      headerMap.set(c.address, c);
    }
    lines.push('Columns:');
    for (let col = minCol; col <= maxCol; col++) {
      const letter = columnToLetter(col);
      // Use first header row
      const hCell = headerMap.get(`${letter}${headerRows[0].row}`);
      lines.push(`${letter}: ${hCell ? getDisplayValue(hCell) : ''}`);
    }
    lines.push('');
  }

  // Data rows
  lines.push('Rows:');
  for (let row = rowRange.startRow; row <= rowRange.endRow; row++) {
    const vals: string[] = [];
    for (let col = minCol; col <= maxCol; col++) {
      const addr = `${columnToLetter(col)}${row}`;
      const cell = cellMap.get(addr);
      vals.push(cell ? formatCellValue(cell) : '');
    }
    lines.push(`${row} | ${vals.join(' | ')}`);
  }

  return lines.join('\n');
}

/** Format a single cell value for display. */
function formatCellValue(cell: CellInput): string {
  let result = getDisplayValue(cell);

  // Append formula info if present
  if (cell.formula) {
    result += ` [=${cell.formula}]`;
  }

  // Append comment if present
  if (cell.comment) {
    result += ` {/* ${cell.comment} */}`;
  }

  // Append hyperlink if present
  if (cell.hyperlink) {
    result += ` [→ ${cell.hyperlink}]`;
  }

  return result;
}

function getDisplayValue(cell: CellInput): string {
  if (cell.displayValue !== null && cell.displayValue !== undefined) {
    return cell.displayValue;
  }
  if (cell.rawValue !== null && cell.rawValue !== undefined) {
    return String(cell.rawValue);
  }
  return '';
}

/** Convert 1-based column number to letter(s). */
export function columnToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
