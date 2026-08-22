// ---------------------------------------------------------------------------
// Style registry – deduplication of cell styles
// ---------------------------------------------------------------------------

import type ExcelJS from 'exceljs';
import type {
  StyleRaw,
  FontRaw,
  FillRaw,
  BorderRaw,
  BorderEdgeRaw,
  AlignmentRaw,
  ProtectionRaw,
} from './models.js';

/**
 * Accumulates unique styles and assigns deterministic sequential IDs.
 * Same input order → same IDs → deterministic output.
 */
export class StyleRegistry {
  private readonly keyToId = new Map<string, string>();
  private readonly idToStyle = new Map<string, StyleRaw>();
  private counter = 0;

  /** Register a style and return its deduplicated ID. */
  register(style: StyleRaw): string {
    const key = this.makeKey(style);
    const existing = this.keyToId.get(key);
    if (existing) return existing;

    const id = `s${this.counter++}`;
    this.keyToId.set(key, id);
    this.idToStyle.set(id, style);
    return id;
  }

  /** Return the full style map (id → style). */
  toMap(): Record<string, StyleRaw> {
    const result: Record<string, StyleRaw> = {};
    for (const [id, style] of this.idToStyle) {
      result[id] = style;
    }
    return result;
  }

  // ---- Key generation ----------------------------------------------------

  private makeKey(style: StyleRaw): string {
    return JSON.stringify({
      f: style.font ? this.fontKey(style.font) : null,
      fi: style.fill ? this.fillKey(style.fill) : null,
      b: style.border ? this.borderKey(style.border) : null,
      a: style.alignment ? this.alignmentKey(style.alignment) : null,
      n: style.numFmt ?? null,
      p: style.protection ? this.protectionKey(style.protection) : null,
    });
  }

  private fontKey(f: FontRaw): unknown {
    return [f.name, f.size, f.bold, f.italic, f.underline, f.strike, f.color, f.family, f.charset];
  }

  private fillKey(fi: FillRaw): unknown {
    return [fi.type, fi.pattern, fi.fgColor, fi.bgColor];
  }

  private borderKey(b: BorderRaw): unknown {
    return [
      this.edgeKey(b.top),
      this.edgeKey(b.bottom),
      this.edgeKey(b.left),
      this.edgeKey(b.right),
      this.edgeKey(b.diagonal),
    ];
  }

  private edgeKey(e: BorderEdgeRaw | null): unknown {
    return e ? [e.style, e.color] : null;
  }

  private alignmentKey(a: AlignmentRaw): unknown {
    return [a.horizontal, a.vertical, a.wrapText, a.textRotation, a.indent, a.shrinkToFit];
  }

  private protectionKey(p: ProtectionRaw): unknown {
    return [p.locked, p.hidden];
  }
}

// ---- Extract style from ExcelJS cell ------------------------------------

/**
 * Extract a StyleRaw from an ExcelJS cell's style properties.
 * Returns a normalised structure; null fields mean "not set / default".
 */
export function extractStyleFromCell(cell: ExcelJS.Cell): StyleRaw {
  return {
    font: extractFont(cell.font),
    fill: extractFill(cell.fill),
    border: extractBorder(cell.border),
    alignment: extractAlignment(cell.alignment),
    numFmt: cell.numFmt || null,
    protection: extractProtection(cell.protection),
  };
}

function extractFont(f: Partial<ExcelJS.Font> | undefined): FontRaw | null {
  if (!f) return null;
  const hasAny =
    f.name || f.size || f.bold || f.italic || f.underline || f.strike || f.color || f.family || f.charset;
  if (!hasAny) return null;

  return {
    name: f.name ?? null,
    size: f.size ?? null,
    bold: f.bold ?? false,
    italic: f.italic ?? false,
    underline: f.underline ?? false,
    strike: f.strike ?? false,
    color: f.color?.argb ?? f.color?.theme?.toString() ?? null,
    family: f.family ?? null,
    charset: f.charset ?? null,
  };
}

function extractFill(f: Partial<ExcelJS.Fill> | undefined): FillRaw | null {
  if (!f || !f.type) return null;

  const patternFill = f.type === 'pattern' ? (f as ExcelJS.FillPattern) : null;
  if (patternFill) {
    return {
      type: 'pattern',
      pattern: patternFill.pattern ?? null,
      fgColor: patternFill.fgColor?.argb ?? null,
      bgColor: patternFill.bgColor?.argb ?? null,
    };
  }

  const gradientFill = f.type === 'gradient' ? (f as ExcelJS.FillGradientAngle) : null;
  if (gradientFill) {
    return {
      type: 'gradient',
      pattern: null,
      fgColor: null,
      bgColor: null,
    };
  }

  return { type: String(f.type), pattern: null, fgColor: null, bgColor: null };
}

function extractBorder(b: Partial<ExcelJS.Borders> | undefined): BorderRaw | null {
  if (!b) return null;
  const top = extractEdge(b.top);
  const bottom = extractEdge(b.bottom);
  const left = extractEdge(b.left);
  const right = extractEdge(b.right);
  const diagonal = extractEdge(b.diagonal);
  if (!top && !bottom && !left && !right && !diagonal) return null;
  return { top, bottom, left, right, diagonal };
}

function extractEdge(e: Partial<ExcelJS.Border> | undefined): BorderEdgeRaw | null {
  if (!e || !e.style) return null;
  return {
    style: e.style,
    color: e.color?.argb ?? null,
  };
}

function extractAlignment(a: Partial<ExcelJS.Alignment> | undefined): AlignmentRaw | null {
  if (!a) return null;
  const hasAny =
    a.horizontal || a.vertical || a.wrapText || a.textRotation || a.indent || a.shrinkToFit;
  if (!hasAny) return null;
  return {
    horizontal: a.horizontal ?? null,
    vertical: a.vertical ?? null,
    wrapText: a.wrapText ?? false,
    textRotation: typeof a.textRotation === 'number' ? a.textRotation : (a.textRotation === 'vertical' ? 255 : null),
    indent: a.indent ?? null,
    shrinkToFit: a.shrinkToFit ?? false,
  };
}

function extractProtection(
  p: Partial<ExcelJS.Protection> | undefined,
): ProtectionRaw | null {
  if (!p) return null;
  if (p.locked === undefined && p.hidden === undefined) return null;
  return {
    locked: p.locked ?? true,
    hidden: p.hidden ?? false,
  };
}

/** Check whether a style is effectively "default" (no meaningful formatting). */
export function isDefaultStyle(style: StyleRaw): boolean {
  return (
    style.font === null &&
    style.fill === null &&
    style.border === null &&
    style.alignment === null &&
    style.numFmt === null &&
    style.protection === null
  );
}
