// ---------------------------------------------------------------------------
// Data Validation extraction
// ---------------------------------------------------------------------------

import type ExcelJS from 'exceljs';
import type { DataValidationRaw, Warning } from './models.js';
import { WarningCode, createWarning } from './warnings.js';

/**
 * Extract data validations from a worksheet.
 * Preserves raw rules without semantic interpretation.
 * 
 * ExcelJS stores validations per-cell in model.dataValidations as a map
 * of cell address -> validation rule. We group cells with identical rules
 * into ranges.
 */
export function extractValidations(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
): DataValidationRaw[] {
  const result: DataValidationRaw[] = [];

  // ExcelJS stores validations in ws.model.dataValidations as a map
  const model = ws.model as {
    dataValidations?: Record<string, {
      type?: string;
      operator?: string;
      formulae?: (string | number)[];
      allowBlank?: boolean;
      showInputMessage?: boolean;
      showErrorMessage?: boolean;
      promptTitle?: string;
      prompt?: string;
      errorTitle?: string;
      error?: string;
    }>;
  };

  const dv = model.dataValidations;
  if (!dv) return result;

  // Group cells by identical validation rules
  const ruleToCells = new Map<string, string[]>();
  const ruleToData = new Map<string, typeof dv[string]>();

  for (const [cellAddr, rule] of Object.entries(dv)) {
    // Create a unique key for this rule
    const key = JSON.stringify(rule);
    
    if (!ruleToCells.has(key)) {
      ruleToCells.set(key, []);
      ruleToData.set(key, rule);
    }
    ruleToCells.get(key)!.push(cellAddr);
  }

  // Convert grouped cells to ranges
  for (const [key, cells] of ruleToCells) {
    const rule = ruleToData.get(key)!;
    
    try {
      // Parse formulae
      const formulae = rule.formulae ?? [];
      const formula1 = formulae[0] !== null && formulae[0] !== undefined ? String(formulae[0]) : null;
      const formula2 = formulae[1] !== null && formulae[1] !== undefined ? String(formulae[1]) : null;

      // Convert cell list to range(s)
      const ranges = cellsToRanges(cells);

      result.push({
        ranges,
        type: rule.type ?? null,
        operator: rule.operator ?? null,
        formula1,
        formula2,
        allowBlank: rule.allowBlank ?? false,
        showInputMessage: rule.showInputMessage ?? false,
        showErrorMessage: rule.showErrorMessage ?? false,
        promptTitle: rule.promptTitle ?? null,
        prompt: rule.prompt ?? null,
        errorTitle: rule.errorTitle ?? null,
        error: rule.error ?? null,
      });
    } catch (err) {
      warnings.push(
        createWarning(
          WarningCode.DATA_VALIDATION_PARTIAL,
          `Failed to parse data validation: ${err instanceof Error ? err.message : String(err)}`,
          sheetName,
        ),
      );
    }
  }

  // Sort deterministically by first range
  result.sort((a, b) => {
    const ra = a.ranges[0] ?? '';
    const rb = b.ranges[0] ?? '';
    return ra.localeCompare(rb);
  });

  return result;
}

/**
 * Convert a list of cell addresses to compact range(s).
 * Groups consecutive cells in the same column into ranges like "A2:A100".
 */
function cellsToRanges(cells: string[]): string[] {
  if (cells.length === 0) return [];
  
  // Parse and sort cells
  const parsed = cells.map(parseCell).sort((a, b) => a.col - b.col || a.row - b.row);
  
  const ranges: string[] = [];
  let currentGroup: typeof parsed = [];
  let currentCol = -1;
  
  for (const cell of parsed) {
    if (cell.col !== currentCol) {
      // New column - flush previous group
      if (currentGroup.length > 0) {
        ranges.push(groupToRange(currentGroup));
      }
      currentGroup = [cell];
      currentCol = cell.col;
    } else {
      // Same column - check if consecutive
      const lastRow = currentGroup[currentGroup.length - 1].row;
      if (cell.row === lastRow + 1) {
        currentGroup.push(cell);
      } else {
        // Gap - flush and start new group
        ranges.push(groupToRange(currentGroup));
        currentGroup = [cell];
      }
    }
  }
  
  if (currentGroup.length > 0) {
    ranges.push(groupToRange(currentGroup));
  }
  
  return ranges;
}

function groupToRange(group: Array<{ col: number; row: number }>): string {
  if (group.length === 0) return '';
  const first = group[0];
  const last = group[group.length - 1];
  const colLetter = columnToLetter(first.col);
  
  if (first.row === last.row) {
    return `${colLetter}${first.row}`;
  }
  return `${colLetter}${first.row}:${colLetter}${last.row}`;
}

function parseCell(addr: string): { col: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!match) return { col: 0, row: 0 };
  
  const letters = match[1];
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  
  return { col, row: parseInt(match[2], 10) };
}

function columnToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
