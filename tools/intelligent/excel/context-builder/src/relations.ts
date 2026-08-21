// ---------------------------------------------------------------------------
// Excel AI Context Builder – cross-reference / relation builder
// ---------------------------------------------------------------------------

import type { CellInput, CrossReference, SheetLayoutInput } from './models.js';

/**
 * Detect cross-sheet formula references in cells.
 *
 * Pattern: ='SheetName'!CellRef  or  =SheetName!CellRef
 */
export function detectCrossSheetReferences(
  sheet: SheetLayoutInput,
  allSheetNames: string[],
): CrossReference[] {
  const refs: CrossReference[] = [];
  const crossSheetPattern = /='?([^'!]+)'?!([A-Z]+\d+)/g;

  for (const cell of sheet.cells) {
    if (!cell.formula) continue;

    let match;
    const regex = new RegExp(crossSheetPattern.source, 'g');
    while ((match = regex.exec(cell.formula)) !== null) {
      const targetSheet = match[1];
      const targetCell = match[2];

      // Verify target sheet exists
      if (allSheetNames.includes(targetSheet)) {
        refs.push({
          type: 'sheet-reference',
          from: `${sheet.name}!${cell.address}`,
          to: `${targetSheet}!${targetCell}`,
          detail: cell.formula,
        });
      }
    }
  }

  return refs;
}

/**
 * Build continuation relations between split chunks of the same sheet.
 */
export function buildContinuationRelations(
  chunkIds: string[],
): Array<{ previous: string | null; next: string | null }> {
  return chunkIds.map((id, i) => ({
    previous: i > 0 ? chunkIds[i - 1] : null,
    next: i < chunkIds.length - 1 ? chunkIds[i + 1] : null,
  }));
}
