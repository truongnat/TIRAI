// ---------------------------------------------------------------------------
// Cell + Layout Extractor – output contract (Phase 1 + 2)
// ---------------------------------------------------------------------------

// ---- Top-level -----------------------------------------------------------

export interface WorkbookLayoutMetadata {
  schemaVersion: '1.0';
  file: FileMetadata;
  sheets: SheetLayoutData[];
  warnings: Warning[];
  performanceProfile?: PerformanceProfile;
}

export interface PerformanceProfile {
  enabled: true;
  totalMs: number;
  workbookLoadMs: number;
  rssBeforeLoadBytes: number;
  rssAfterLoadBytes: number;
  rssBeforeSerializationBytes: number;
  rssAfterSerializationBytes: number;
  memory: MemorySnapshot[];
  ooxml?: OOXMLProfile;
  sheets: SheetPerformanceProfile[];
}

export interface MemorySnapshot {
  label: string;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

export interface OOXMLProfile {
  cachedEntries: number;
  cachedCharacters: number;
  largestEntries: Array<{ path: string; characters: number }>;
}

export interface SheetPerformanceProfile {
  index: number;
  name: string;
  runtimeMs: number;
  cellsMs: number;
  layoutMs: number;
  validationsMs: number;
  tablesMs: number;
  annotationsMs: number;
  objectsMs: number;
  conditionalFormattingMs: number;
  pageSetupMs: number;
  arrayFormulasMs: number;
  cellsEmitted: number;
  nonEmptyCells: number;
  styledEmptyCells: number;
  mergedEmptyCells: number;
  formulaCells: number;
  declaredRows: number;
  declaredColumns: number;
  instantiatedCells: number;
  mergedRanges: number;
  styles: number;
  validations: number;
  tables: number;
  annotations: number;
  objects: number;
  conditionalFormatting: number;
  outputBytes: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
  memory: MemorySnapshot[];
  rssDeltaBytes: number;
  heapDeltaBytes: number;
  estimatedSheetObjectBytes: number;
  instantiatedCellsBefore: number;
  instantiatedCellsAfter: number;
  gridCoordinatesVisited: number;
  visitToEmissionRatio: number;
}

export interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
}

// ---- Sheet ---------------------------------------------------------------

export interface SheetLayoutData {
  index: number;
  name: string;
  dimension: string | null;
  rowCount: number | null;
  columnCount: number | null;
  rows: RowRaw[];
  columns: ColumnRaw[];
  mergedRanges: MergeRangeRaw[];
  cells: CellRaw[];
  styles: Record<string, StyleRaw>;
  validations: DataValidationRaw[];
  tables: TableRaw[];
  annotations: AnnotationRaw[];
  objects: ObjectRaw[];
  conditionalFormatting: ConditionalFormattingRaw[];
  pageSetup: PageSetupRaw | null;
  arrayFormulas: ArrayFormulaRaw[];
  warnings: Warning[];
}

// ---- Cell ----------------------------------------------------------------

export interface CellRaw {
  address: string;
  row: number;
  column: number;
  rawValue: unknown;
  displayValue: string | null;
  type: CellType | null;
  formula: string | null;
  cachedResult: unknown;
  numFmt: string | null;
  styleId: string | null;
  hyperlink: string | null;
  comment: string | null;
  isRichText: boolean;
  source: SourceReference;
}

export type CellType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'date'
  | 'error'
  | 'richtext'
  | 'formula';

// ---- Source provenance ---------------------------------------------------

export interface SourceReference {
  sheet: string;
  cell: string;
}

// ---- Row / Column --------------------------------------------------------

export interface RowRaw {
  row: number;
  height: number | null;
  hidden: boolean;
  outlineLevel: number;
}

export interface ColumnRaw {
  column: number;
  width: number | null;
  hidden: boolean;
  outlineLevel: number;
}

// ---- Merged cells --------------------------------------------------------

export interface MergeRangeRaw {
  range: string;
  masterCell: string;
  topRow: number;
  leftColumn: number;
  bottomRow: number;
  rightColumn: number;
}

// ---- Style ---------------------------------------------------------------

export interface StyleRaw {
  font: FontRaw | null;
  fill: FillRaw | null;
  border: BorderRaw | null;
  alignment: AlignmentRaw | null;
  numFmt: string | null;
  protection: ProtectionRaw | null;
}

export interface FontRaw {
  name: string | null;
  size: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean | string;
  strike: boolean;
  color: string | null;
  family: number | null;
  charset: number | null;
}

export interface FillRaw {
  type: string | null;
  pattern: string | null;
  fgColor: string | null;
  bgColor: string | null;
}

export interface BorderRaw {
  top: BorderEdgeRaw | null;
  bottom: BorderEdgeRaw | null;
  left: BorderEdgeRaw | null;
  right: BorderEdgeRaw | null;
  diagonal: BorderEdgeRaw | null;
}

export interface BorderEdgeRaw {
  style: string | null;
  color: string | null;
}

export interface AlignmentRaw {
  horizontal: string | null;
  vertical: string | null;
  wrapText: boolean;
  textRotation: number | null;
  indent: number | null;
  shrinkToFit: boolean;
}

export interface ProtectionRaw {
  locked: boolean;
  hidden: boolean;
}

// ---- Warning -------------------------------------------------------------

export interface Warning {
  code: string;
  message: string;
  sheet?: string;
  cell?: string;
}

// ---- Data Validation -----------------------------------------------------

export interface DataValidationRaw {
  ranges: string[];
  type: string | null;
  operator: string | null;
  formula1: string | null;
  formula2: string | null;
  allowBlank: boolean;
  showInputMessage: boolean;
  showErrorMessage: boolean;
  promptTitle: string | null;
  prompt: string | null;
  errorTitle: string | null;
  error: string | null;
}

// ---- Table ---------------------------------------------------------------

export interface TableRaw {
  name: string;
  displayName: string;
  range: string;
  headerRow: boolean;
  totalsRow: boolean;
  columns: TableColumnRaw[];
  style: TableStyleRaw | null;
}

export interface TableColumnRaw {
  name: string;
}

export interface TableStyleRaw {
  name: string | null;
  showRowStripes: boolean;
  showColumnStripes: boolean;
}

// ---- Annotation (Hyperlink + Comment) ------------------------------------

export interface AnnotationRaw {
  type: 'hyperlink' | 'comment';
  source: SourceReference;
  // Hyperlink fields
  target?: string | null;
  text?: string | null;
  tooltip?: string | null;
  // Comment fields
  author?: string | null;
  comment?: string | null;
}

// ---- Drawing Objects (Phase 4) -------------------------------------------

export type ObjectType = 'image' | 'shape' | 'chart' | 'unknown';

export type AnchorType = 'oneCellAnchor' | 'twoCellAnchor' | 'absoluteAnchor' | 'unknown';

export interface ObjectRaw {
  type: ObjectType;
  relationshipId: string | null;
  anchor: AnchorRaw | null;
  asset: AssetReference | null;
  text: string | null;
  source: SheetSourceReference;
}

export interface AnchorRaw {
  type: AnchorType;
  from: AnchorPosition | null;
  to: AnchorPosition | null;
}

export interface AnchorPosition {
  row: number;
  column: number;
  rowOffset: number;
  columnOffset: number;
}

export interface AssetReference {
  target: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  extractedPath: string | null;
}

export interface SheetSourceReference {
  sheet: string;
}

// ---- Conditional Formatting (Phase 5) ------------------------------------

export interface ConditionalFormattingRaw {
  ranges: string[];
  rules: ConditionalFormattingRuleRaw[];
}

export interface ConditionalFormattingRuleRaw {
  type: string;
  operator: string | null;
  formula: string[];
  priority: number;
  stopIfTrue: boolean;
  dxfId: number | null;
}

// ---- Page Setup / Print (Phase 5) ----------------------------------------

export interface PageSetupRaw {
  orientation: 'portrait' | 'landscape' | null;
  paperSize: number | null;
  scale: number | null;
  fitToWidth: number | null;
  fitToHeight: number | null;
  margins: PageMarginsRaw | null;
  printArea: string | null;
  printTitles: PrintTitlesRaw | null;
  pageBreaks: PageBreaksRaw | null;
}

export interface PageMarginsRaw {
  left: number;
  right: number;
  top: number;
  bottom: number;
  header: number;
  footer: number;
}

export interface PrintTitlesRaw {
  rows: string | null;
  columns: string | null;
}

export interface PageBreaksRaw {
  rowBreaks: number[];
  columnBreaks: number[];
}

// ---- Array Formula (Phase 5) ---------------------------------------------

export interface ArrayFormulaRaw {
  masterCell: string;
  range: string;
  formula: string;
  cachedResult: unknown;
  source: SourceReference;
}

// ---- Extraction options --------------------------------------------------

export interface ExtractOptions {
  /** Only extract specific sheets (by name or 0-based index). */
  sheets?: (string | number)[];
  /** Extract binary assets (images). Default: false. */
  assets?: boolean;
  /** Include all empty cells in used range. Default: false (only styled). */
  includeEmptyAll?: boolean;
  /** Enable opt-in timing and memory diagnostics. Never included in normal output. */
  profilePerformance?: boolean;
  /** Diagnostic only: request global.gc() at profile checkpoints. */
  profileForceGc?: boolean;
}
