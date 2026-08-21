// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------

import type ExcelJS from 'exceljs';
import type { TableRaw, TableColumnRaw, TableStyleRaw, Warning } from './models.js';
import { WarningCode, createWarning } from './warnings.js';

/**
 * Extract Excel tables from a worksheet.
 * Tables are structured ranges with headers, columns, and styles.
 */
export function extractTables(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
): TableRaw[] {
  const result: TableRaw[] = [];

  // ExcelJS stores tables in ws.tables (Map-like structure)
  // Access via the model for more reliable data
  const model = ws.model as {
    tables?: Array<{
      name?: string;
      displayName?: string;
      tableRef?: string;
      ref?: string;
      headerRow?: boolean;
      totalsRow?: boolean;
      columns?: Array<{ name?: string; totalsRowLabel?: string }>;
      style?: {
        theme?: string;
        name?: string;
        showRowStripes?: boolean;
        showColumnStripes?: boolean;
      } | string;
    }>;
  };

  if (!model.tables) return result;

  for (const t of model.tables) {
    try {
      const columns: TableColumnRaw[] = [];
      if (t.columns) {
        for (const col of t.columns) {
          columns.push({ name: col.name ?? '' });
        }
      }

      let style: TableStyleRaw | null = null;
      if (t.style) {
        const styleObj = typeof t.style === 'string' ? { theme: t.style } : t.style;
        style = {
          name: styleObj.theme ?? styleObj.name ?? null,
          showRowStripes: styleObj.showRowStripes ?? true,
          showColumnStripes: styleObj.showColumnStripes ?? false,
        };
      }

      result.push({
        name: t.name ?? '',
        displayName: t.displayName ?? t.name ?? '',
        range: t.tableRef ?? t.ref ?? '',
        headerRow: t.headerRow ?? true,
        totalsRow: t.totalsRow ?? false,
        columns,
        style,
      });
    } catch (err) {
      warnings.push(
        createWarning(
          WarningCode.TABLE_PARSE_PARTIAL,
          `Failed to parse table: ${err instanceof Error ? err.message : String(err)}`,
          sheetName,
        ),
      );
    }
  }

  // Sort deterministically by name
  result.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}
