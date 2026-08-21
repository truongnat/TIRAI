// ---------------------------------------------------------------------------
// Annotations – hyperlinks + comments/notes extraction
// ---------------------------------------------------------------------------

import type ExcelJS from 'exceljs';
import type { AnnotationRaw, SourceReference, Warning } from './models.js';
import { WarningCode, createWarning } from './warnings.js';

/**
 * Extract all hyperlinks and comments from a worksheet.
 * Returns a flat list of annotations with source provenance.
 */
export function extractAnnotations(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
): AnnotationRaw[] {
  const annotations: AnnotationRaw[] = [];

  // ---- Hyperlinks --------------------------------------------------------
  extractHyperlinks(ws, sheetName, warnings, annotations);

  // ---- Comments / Notes --------------------------------------------------
  extractComments(ws, sheetName, warnings, annotations);

  // Sort deterministically: by type, then row, then column
  annotations.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (a.source.cell !== b.source.cell) {
      return parseCellAddress(a.source.cell).row - parseCellAddress(b.source.cell).row ||
             parseCellAddress(a.source.cell).col - parseCellAddress(b.source.cell).col;
    }
    return 0;
  });

  return annotations;
}

// ---- Hyperlinks ----------------------------------------------------------

function extractHyperlinks(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
  annotations: AnnotationRaw[],
): void {
  // Hyperlinks are stored in cell values, not in the model
  // Iterate all cells and extract hyperlinks
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      // Check if cell has hyperlink
      if (!cell.hyperlink) return;
      
      // Check if it's a hyperlink type cell
      const isHyperlinkType = cell.type === 5; // ExcelJS.ValueType.Hyperlink = 5
      const hasHyperlinkValue = cell.value && typeof cell.value === 'object' && 'hyperlink' in cell.value;
      
      if (!isHyperlinkType && !hasHyperlinkValue) return;

      const address = cell.address;
      const source: SourceReference = {
        sheet: sheetName,
        cell: address,
      };

      try {
        let target: string | null = null;
        let text: string | null = null;
        let tooltip: string | null = null;

        // Extract from cell value object
        if (cell.value && typeof cell.value === 'object') {
          const hv = cell.value as { text?: string; hyperlink?: string; tooltip?: string };
          target = hv.hyperlink ?? null;
          text = hv.text ?? null;
          tooltip = hv.tooltip ?? null;
        } else if (typeof cell.hyperlink === 'string') {
          target = cell.hyperlink;
          text = cell.text ?? null;
        }

        annotations.push({
          type: 'hyperlink',
          source,
          target,
          text,
          tooltip,
        });
      } catch (err) {
        warnings.push(
          createWarning(
            WarningCode.HYPERLINK_RELATIONSHIP_UNRESOLVED,
            `Failed to parse hyperlink: ${err instanceof Error ? err.message : String(err)}`,
            sheetName,
            address,
          ),
        );
      }
    });
  });
}

// ---- Comments / Notes ----------------------------------------------------

function extractComments(
  ws: ExcelJS.Worksheet,
  sheetName: string,
  warnings: Warning[],
  annotations: AnnotationRaw[],
): void {
  // Iterate all cells to find those with notes/comments
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (!cell.note) return;

      const address = cell.address;
      const source: SourceReference = {
        sheet: sheetName,
        cell: address,
      };

      try {
        const { text, author } = parseComment(cell.note);

        annotations.push({
          type: 'comment',
          source,
          author,
          comment: text,
        });
      } catch (err) {
        warnings.push(
          createWarning(
            WarningCode.COMMENT_FORMAT_PARTIAL,
            `Failed to parse comment: ${err instanceof Error ? err.message : String(err)}`,
            sheetName,
            address,
          ),
        );
      }
    });
  });

  // Check for threaded comments (not supported)
  const model = ws.model as { threadedComments?: unknown };
  if (model.threadedComments) {
    warnings.push(
      createWarning(
        WarningCode.THREADED_COMMENT_NOT_SUPPORTED,
        'Threaded comments detected but are not supported. Only legacy comments are extracted.',
        sheetName,
      ),
    );
  }
}

/**
 * Parse a cell note into text + author.
 * Handles string notes, Comment objects, and rich text.
 */
function parseComment(note: string | ExcelJS.Comment | unknown): { text: string; author: string | null } {
  if (typeof note === 'string') {
    return { text: note, author: null };
  }

  if (typeof note === 'object' && note !== null) {
    const comment = note as ExcelJS.Comment;

    // Rich text format
    if (comment.texts && Array.isArray(comment.texts)) {
      const text = comment.texts.map((t) => t.text ?? '').join('');
      const author = comment.author ?? (comment as { editAs?: string }).editAs ?? null;
      return { text, author };
    }

    // Simple text format
    if (comment.text) {
      return { text: comment.text, author: comment.author ?? null };
    }
  }

  return { text: '', author: null };
}

// ---- Helpers -------------------------------------------------------------

/** Parse cell address like "B5" into { row, col }. */
function parseCellAddress(address: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) return { row: 0, col: 0 };

  const letters = match[1];
  const row = parseInt(match[2], 10);

  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }

  return { row, col };
}
