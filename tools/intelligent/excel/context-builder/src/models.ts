// ---------------------------------------------------------------------------
// Excel AI Context Builder – output contract
// ---------------------------------------------------------------------------

// ---- Top-level package ---------------------------------------------------

export interface ExcelContextPackage {
  schemaVersion: '1.0';
  source: SourceInfo;
  stats: PackageStats;
  sheets: SheetChunkIndex[];
  chunks: ContextChunk[];
  warnings: ContextWarning[];
}

export interface SourceInfo {
  file: string;
  sizeBytes: number;
}

export interface PackageStats {
  sheets: number;
  chunks: number;
  characters: number;
  estimatedTokens: number;
}

export interface SheetChunkIndex {
  index: number;
  name: string;
  dimension: string | null;
  chunks: string[];
}

// ---- Context Chunk -------------------------------------------------------

export type ContextType = 'tabular' | 'cell-block' | 'annotations' | 'objects' | 'metadata';

export interface ContextChunk {
  schemaVersion: '1.0';
  id: string;
  type: ContextType;
  sheet: SheetReference;
  range: string | null;
  content: string;
  provenance: ChunkProvenance;
  relations: ChunkRelations;
  layoutHints: LayoutHints | null;
  stats: ChunkStats;
  warnings: ContextWarning[];
}

export interface SheetReference {
  index: number;
  name: string;
}

export interface ChunkProvenance {
  sheetIndex: number;
  sheetName: string;
  ranges: string[];
  /** Ranges that are repeated headers (not source data). */
  repeatedHeaders?: string[];
}

export interface ChunkRelations {
  previous: string | null;
  next: string | null;
  references: CrossReference[];
}

export interface CrossReference {
  type: 'sheet-reference' | 'continuation' | 'related-object';
  from: string;
  to: string;
  detail?: string;
}

export interface LayoutHints {
  headerRows?: number[];
  borderedRanges?: string[];
  mergedRanges?: string[];
  hiddenRows?: number[];
  hiddenColumns?: number[];
}

export interface ChunkStats {
  cells: number;
  characters: number;
  estimatedTokens: number;
}

// ---- Warnings ------------------------------------------------------------

export interface ContextWarning {
  code: string;
  message: string;
  sheet?: string;
  chunk?: string;
}

// ---- Builder options -----------------------------------------------------

export interface ContextBuilderOptions {
  /** Maximum characters per chunk (default: 50000). */
  maxChars?: number;
  /** Maximum cells per chunk (default: 500). */
  maxCells?: number;
  /** Only build context for specific sheets. */
  sheets?: string[];
}

// ---- Input types (from deterministic extractors) -------------------------

export interface WorkbookMetadataInput {
  schemaVersion: string;
  file: { path: string; name: string; extension: string; sizeBytes: number };
  workbook: {
    properties: Record<string, unknown>;
    sheets: Array<{
      index: number;
      name: string;
      state: string;
      dimension: string | null;
      minRow: number | null;
      maxRow: number | null;
      minColumn: number | null;
      maxColumn: number | null;
      freezePane: string | null;
      autoFilter: string | null;
    }>;
    definedNames: Array<{ name: string; value: string; scope: string; sheetIndex: number | null; hidden: boolean }>;
    externalLinks: Array<{ target: string; type: string }>;
    calculation: Record<string, unknown> | null;
  };
  warnings: Array<{ code: string; message: string; sheet?: string }>;
}

export interface WorkbookLayoutInput {
  schemaVersion: string;
  file: { path: string; name: string; extension: string; sizeBytes: number };
  sheets: SheetLayoutInput[];
  warnings: Array<{ code: string; message: string; sheet?: string; cell?: string }>;
}

export interface SheetLayoutInput {
  index: number;
  name: string;
  dimension: string | null;
  rowCount: number | null;
  columnCount: number | null;
  rows: Array<{ row: number; height: number | null; hidden: boolean; outlineLevel: number }>;
  columns: Array<{ column: number; width: number | null; hidden: boolean; outlineLevel: number }>;
  mergedRanges: Array<{
    range: string; masterCell: string;
    topRow: number; leftColumn: number; bottomRow: number; rightColumn: number;
  }>;
  cells: CellInput[];
  styles: Record<string, unknown>;
  validations: Array<{
    ranges: string[]; type: string | null; operator: string | null;
    formula1: string | null; formula2: string | null;
    allowBlank: boolean; showInputMessage: boolean; showErrorMessage: boolean;
    promptTitle: string | null; prompt: string | null;
    errorTitle: string | null; error: string | null;
  }>;
  tables: Array<{
    name: string; displayName: string; range: string;
    headerRow: boolean; totalsRow: boolean;
    columns: Array<{ name: string }>;
    style: { name: string | null; showRowStripes: boolean; showColumnStripes: boolean } | null;
  }>;
  annotations: Array<{
    type: 'hyperlink' | 'comment';
    source: { sheet: string; cell: string };
    target?: string | null; text?: string | null; tooltip?: string | null;
    author?: string | null; comment?: string | null;
  }>;
  objects: Array<{
    type: string; relationshipId: string | null;
    anchor: { type: string; from: { row: number; column: number; rowOffset: number; columnOffset: number } | null;
              to: { row: number; column: number; rowOffset: number; columnOffset: number } | null } | null;
    asset: { target: string | null; mimeType: string | null; sizeBytes: number | null; extractedPath: string | null } | null;
    text: string | null;
    source: { sheet: string };
  }>;
  conditionalFormatting: Array<{ ranges: string[]; rules: Array<Record<string, unknown>> }>;
  pageSetup: {
    orientation: string | null; paperSize: number | null; scale: number | null;
    fitToWidth: number | null; fitToHeight: number | null;
    margins: { left: number; right: number; top: number; bottom: number; header: number; footer: number } | null;
    printArea: string | null; printTitles: { rows: string | null; columns: string | null } | null;
    pageBreaks: { rowBreaks: number[]; columnBreaks: number[] } | null;
  } | null;
  arrayFormulas: Array<{ masterCell: string; range: string; formula: string; cachedResult: unknown; source: { sheet: string; cell: string } }>;
  warnings: Array<{ code: string; message: string; sheet?: string; cell?: string }>;
}

export interface CellInput {
  address: string;
  row: number;
  column: number;
  rawValue: unknown;
  displayValue: string | null;
  type: string | null;
  formula: string | null;
  cachedResult: unknown;
  numFmt: string | null;
  styleId: string | null;
  hyperlink: string | null;
  comment: string | null;
  isRichText: boolean;
  source: { sheet: string; cell: string };
}
