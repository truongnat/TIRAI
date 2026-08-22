// ---------------------------------------------------------------------------
// Page Setup / Print metadata extraction – raw OOXML parsing via JSZip
// ---------------------------------------------------------------------------

import JSZip from 'jszip';
import type {
  PageSetupRaw,
  PageMarginsRaw,
  PrintTitlesRaw,
  PageBreaksRaw,
  Warning,
} from './models.js';
import { WarningCode, createWarning } from './warnings.js';

/**
 * Extract page setup, print area, print titles, and page breaks from a
 * worksheet by parsing raw OOXML.
 *
 * Sheet-level data (pageSetup, margins, breaks) comes from sheet.xml.
 * Print area and print titles come from workbook-level defined names.
 */
export async function extractPageSetup(
  filePath: string,
  sheetIndex: number,
  sheetName: string,
  warnings: Warning[],
): Promise<PageSetupRaw | null> {
  try {
    const zip = await JSZip.loadAsync(
      (await import('node:fs')).readFileSync(filePath),
    );

    // 1. Sheet-level: pageSetup, pageMargins, printOptions, page breaks
    const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) return null;

    const sheetXml = await sheetFile.async('string');

    const orientation = parseOrientation(sheetXml);
    const paperSize = parseIntAttr(sheetXml, 'paperSize');
    const scale = parseIntAttr(sheetXml, 'scale');
    const fitToWidth = parseIntAttr(sheetXml, 'fitToWidth');
    const fitToHeight = parseIntAttr(sheetXml, 'fitToHeight');
    const margins = parseMargins(sheetXml);
    const pageBreaks = parsePageBreaks(sheetXml);

    // 2. Workbook-level: print area, print titles
    const { printArea, printTitles } = await parseWorkbookDefinedNames(
      zip,
      sheetName,
      sheetIndex,
      warnings,
    );

    // Only return if there's something meaningful
    const hasData =
      orientation !== null ||
      paperSize !== null ||
      scale !== null ||
      fitToWidth !== null ||
      fitToHeight !== null ||
      margins !== null ||
      printArea !== null ||
      printTitles !== null ||
      (pageBreaks && (pageBreaks.rowBreaks.length > 0 || pageBreaks.columnBreaks.length > 0));

    if (!hasData) return null;

    return {
      orientation,
      paperSize,
      scale,
      fitToWidth,
      fitToHeight,
      margins,
      printArea,
      printTitles,
      pageBreaks,
    };
  } catch (err) {
    warnings.push(
      createWarning(
        WarningCode.PAGE_SETUP_PARTIAL,
        `Failed to parse page setup: ${err instanceof Error ? err.message : String(err)}`,
        sheetName,
      ),
    );
    return null;
  }
}

// ---- Sheet-level parsing -------------------------------------------------

function parseOrientation(sheetXml: string): 'portrait' | 'landscape' | null {
  // <pageSetup orientation="landscape" .../>
  const match = /orientation="([^"]+)"/.exec(sheetXml);
  if (!match) return null;
  const val = match[1].toLowerCase();
  if (val === 'landscape') return 'landscape';
  if (val === 'portrait') return 'portrait';
  return null;
}

function parseIntAttr(sheetXml: string, attr: string): number | null {
  // Match within <pageSetup .../> or <printOptions .../>
  const regex = new RegExp(`${attr}="(\\d+)"`);
  const match = regex.exec(sheetXml);
  return match ? parseInt(match[1], 10) : null;
}

function parseMargins(sheetXml: string): PageMarginsRaw | null {
  const match = /<pageMargins\s+([^>]+)\/>/.exec(sheetXml);
  if (!match) return null;

  const attrs = match[1];
  const left = parseFloatAttr(attrs, 'left');
  const right = parseFloatAttr(attrs, 'right');
  const top = parseFloatAttr(attrs, 'top');
  const bottom = parseFloatAttr(attrs, 'bottom');
  const header = parseFloatAttr(attrs, 'header');
  const footer = parseFloatAttr(attrs, 'footer');

  if (left === null || right === null || top === null || bottom === null) return null;

  return { left, right, top, bottom, header: header ?? 0, footer: footer ?? 0 };
}

function parseFloatAttr(attrs: string, name: string): number | null {
  const match = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) ? null : val;
}

function parsePageBreaks(sheetXml: string): PageBreaksRaw | null {
  const rowBreaks = parseBreakList(sheetXml, 'rowBreaks');
  const colBreaks = parseBreakList(sheetXml, 'colBreaks');

  if (rowBreaks.length === 0 && colBreaks.length === 0) return null;

  return { rowBreaks, columnBreaks: colBreaks };
}

function parseBreakList(sheetXml: string, tag: string): number[] {
  // <rowBreaks count="1"><brk id="5" .../></rowBreaks>
  const blockRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const blockMatch = blockRegex.exec(sheetXml);
  if (!blockMatch) {
    // Also try self-closing tag
    const _selfClose = new RegExp(`<${tag}[^>]*count="(\\d+)"[^>]*\\/>`).exec(sheetXml);
    return [];
  }

  const content = blockMatch[1];
  const breaks: number[] = [];
  const brkRegex = /<brk\s+[^>]*id="(\d+)"/g;
  let brkMatch;
  while ((brkMatch = brkRegex.exec(content)) !== null) {
    breaks.push(parseInt(brkMatch[1], 10));
  }

  breaks.sort((a, b) => a - b);
  return breaks;
}

// ---- Workbook-level defined names ----------------------------------------

async function parseWorkbookDefinedNames(
  zip: JSZip,
  sheetName: string,
  sheetIndex: number,
  _warnings: Warning[],
): Promise<{ printArea: string | null; printTitles: PrintTitlesRaw | null }> {
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) return { printArea: null, printTitles: null };

  const wbXml = await wbFile.async('string');

  // Find <definedNames> section
  const dnBlockMatch = /<definedNames>([\s\S]*?)<\/definedNames>/.exec(wbXml);
  if (!dnBlockMatch) return { printArea: null, printTitles: null };

  const dnBlock = dnBlockMatch[1];

  // Match individual <definedName> elements
  const dnRegex = /<definedName\s+([^>]*)>([\s\S]*?)<\/definedName>/g;
  let dnMatch;

  let printArea: string | null = null;
  let printTitles: PrintTitlesRaw | null = null;

  while ((dnMatch = dnRegex.exec(dnBlock)) !== null) {
    const attrs = dnMatch[1];
    const value = dnMatch[2].trim();
    const nameMatch = /name="([^"]+)"/.exec(attrs);
    if (!nameMatch) continue;

    const name = nameMatch[1];

    if (name === '_xlnm.Print_Area') {
      // Value format: 'SheetName'!$A$1:$Z$120 or SheetName!$A$1:$Z$120
      const resolved = resolveDefinedNameForSheet(value, sheetName, sheetIndex);
      if (resolved) {
        printArea = resolved;
      }
    } else if (name === '_xlnm.Print_Titles') {
      // Value format: 'SheetName'!$1:$3,'SheetName'!$A:$B
      const titles = resolvePrintTitlesForSheet(value, sheetName, sheetIndex);
      if (titles) {
        printTitles = titles;
      }
    }
  }

  return { printArea, printTitles };
}

/**
 * Resolve a defined name value for a specific sheet.
 * Value format: 'SheetName'!$A$1:$Z$120 or SheetName!$A$1:$Z$120
 * May also be a comma-separated list of ranges for the same sheet.
 */
function resolveDefinedNameForSheet(
  value: string,
  sheetName: string,
  _sheetIndex: number,
): string | null {
  // Split by comma, but be careful of sheet names with commas in quotes
  const parts = splitDefinedNameValue(value);
  const ranges: string[] = [];

  for (const part of parts) {
    const { sheet, range } = parseDefinedNameRef(part.trim());
    if (sheet === sheetName) {
      ranges.push(range);
    }
  }

  return ranges.length > 0 ? ranges.join(',') : null;
}

/**
 * Resolve print titles (repeat rows/columns) for a specific sheet.
 * Value format: 'SheetName'!$1:$3,'SheetName'!$A:$B
 */
function resolvePrintTitlesForSheet(
  value: string,
  sheetName: string,
  _sheetIndex: number,
): PrintTitlesRaw | null {
  const parts = splitDefinedNameValue(value);
  let rows: string | null = null;
  let columns: string | null = null;

  for (const part of parts) {
    const { sheet, range } = parseDefinedNameRef(part.trim());
    if (sheet !== sheetName) continue;

    // Row range: $1:$3 → "1:3"
    const rowMatch = /^\$?(\d+):\$?(\d+)$/.exec(range);
    if (rowMatch) {
      rows = `${rowMatch[1]}:${rowMatch[2]}`;
      continue;
    }

    // Column range: $A:$B → "A:B"
    const colMatch = /^\$?([A-Z]+):\$?([A-Z]+)$/i.exec(range);
    if (colMatch) {
      columns = `${colMatch[1].toUpperCase()}:${colMatch[2].toUpperCase()}`;
      continue;
    }
  }

  if (rows === null && columns === null) return null;
  return { rows, columns };
}

/**
 * Split a defined name value by commas, respecting single-quoted sheet names.
 */
function splitDefinedNameValue(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;

  for (const ch of value) {
    if (ch === "'") {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === ',' && !inQuote) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Parse a single defined name reference like 'SheetName'!$A$1:$Z$120
 * Returns { sheet, range } where range has $ removed.
 */
function parseDefinedNameRef(ref: string): { sheet: string; range: string } {
  // Quoted sheet name: 'Sheet Name'!range
  const quotedMatch = /^'([^']+)'!(.+)$/.exec(ref);
  if (quotedMatch) {
    return { sheet: quotedMatch[1], range: quotedMatch[2].replace(/\$/g, '') };
  }

  // Unquoted sheet name: SheetName!range
  const unquotedMatch = /^([^!]+)!(.+)$/.exec(ref);
  if (unquotedMatch) {
    return { sheet: unquotedMatch[1], range: unquotedMatch[2].replace(/\$/g, '') };
  }

  return { sheet: '', range: ref.replace(/\$/g, '') };
}
