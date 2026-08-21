// ---------------------------------------------------------------------------
// WorkbookMetadata – deterministic output contract for Workbook Inspector
// ---------------------------------------------------------------------------

/** Top-level output produced by `inspectWorkbook()`. */
export interface WorkbookMetadata {
  schemaVersion: '1.0';
  file: FileMetadata;
  workbook: WorkbookInfo;
  warnings: Warning[];
}

// ---- File ----------------------------------------------------------------

export interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
}

// ---- Workbook -------------------------------------------------------------

export interface WorkbookInfo {
  properties: WorkbookProperties;
  sheets: SheetInfo[];
  definedNames: DefinedNameInfo[];
  externalLinks: ExternalLinkInfo[];
  calculation: CalculationInfo | null;
}

export interface WorkbookProperties {
  title: string | null;
  subject: string | null;
  creator: string | null;
  keywords: string | null;
  description: string | null;
  lastModifiedBy: string | null;
  created: string | null;
  modified: string | null;
  category: string | null;
}

// ---- Sheet ----------------------------------------------------------------

export interface SheetInfo {
  index: number;
  name: string;
  state: SheetState;
  dimension: string | null;
  minRow: number | null;
  maxRow: number | null;
  minColumn: number | null;
  maxColumn: number | null;
  freezePane: string | null;
  autoFilter: string | null;
}

export type SheetState = 'visible' | 'hidden' | 'veryHidden' | 'unknown';

// ---- Defined Names --------------------------------------------------------

export interface DefinedNameInfo {
  name: string;
  value: string;
  scope: 'workbook' | 'sheet';
  sheetIndex: number | null;
  hidden: boolean;
}

// ---- External Links -------------------------------------------------------

export interface ExternalLinkInfo {
  target: string;
  type: string;
}

// ---- Calculation ----------------------------------------------------------

export interface CalculationInfo {
  mode: string | null;
  fullCalcOnLoad: boolean | null;
  forceFullCalc: boolean | null;
  calcId: string | null;
}

// ---- Warning --------------------------------------------------------------

export interface Warning {
  code: string;
  message: string;
  sheet?: string;
}
