// ---------------------------------------------------------------------------
// Excel AI Context Builder – warning & error codes
// ---------------------------------------------------------------------------

// ---- Warning codes (non-fatal) -------------------------------------------

export const WarningCode = {
  INPUT_SCHEMA_UNSUPPORTED: 'INPUT_SCHEMA_UNSUPPORTED',
  SOURCE_FILE_MISSING: 'SOURCE_FILE_MISSING',
  SOURCE_SHEET_MISSING: 'SOURCE_SHEET_MISSING',
  CONTEXT_SIZE_EXCEEDED: 'CONTEXT_SIZE_EXCEEDED',
  CHUNK_SPLIT_COMPLEX_RANGE: 'CHUNK_SPLIT_COMPLEX_RANGE',
  HEADER_DETECTION_UNCERTAIN: 'HEADER_DETECTION_UNCERTAIN',
  CROSS_SHEET_REFERENCE_UNRESOLVED: 'CROSS_SHEET_REFERENCE_UNRESOLVED',
  OBJECT_ANCHOR_UNRESOLVED: 'OBJECT_ANCHOR_UNRESOLVED',
  UNSUPPORTED_CONTEXT_FEATURE: 'UNSUPPORTED_CONTEXT_FEATURE',
} as const;

export type WarningCodeKey = typeof WarningCode[keyof typeof WarningCode];

// ---- Fatal error codes ---------------------------------------------------

export const FatalCode = {
  INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
  INVALID_INPUT_DIRECTORY: 'INVALID_INPUT_DIRECTORY',
  WORKBOOK_METADATA_MISSING: 'WORKBOOK_METADATA_MISSING',
  LAYOUT_DATA_MISSING: 'LAYOUT_DATA_MISSING',
  INVALID_JSON: 'INVALID_JSON',
  UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
} as const;

export type FatalCodeKey = typeof FatalCode[keyof typeof FatalCode];

// ---- Builder error class -------------------------------------------------

export class ContextBuilderError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ContextBuilderError';
    this.code = code;
  }
}
