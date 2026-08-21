// ---------------------------------------------------------------------------
// Warning codes & helpers
// ---------------------------------------------------------------------------

import type { Warning } from './models.js';

export const WarningCode = {
  SHEET_DIMENSION_UNRELIABLE: 'SHEET_DIMENSION_UNRELIABLE',
  STYLE_PARSE_PARTIAL: 'STYLE_PARSE_PARTIAL',
  FORMULA_CACHED_VALUE_MISSING: 'FORMULA_CACHED_VALUE_MISSING',
  UNSUPPORTED_DRAWING_TYPE: 'UNSUPPORTED_DRAWING_TYPE',
  CONDITIONAL_FORMATTING_PARTIAL: 'CONDITIONAL_FORMATTING_PARTIAL',
  DATA_VALIDATION_PARTIAL: 'DATA_VALIDATION_PARTIAL',
  CHART_CONTENT_NOT_EXTRACTED: 'CHART_CONTENT_NOT_EXTRACTED',
  SHAPE_TEXT_NOT_SUPPORTED: 'SHAPE_TEXT_NOT_SUPPORTED',
  MACRO_CONTENT_NOT_INSPECTED: 'MACRO_CONTENT_NOT_INSPECTED',
  EXTERNAL_LINKS_NOT_FULLY_SUPPORTED: 'EXTERNAL_LINKS_NOT_FULLY_SUPPORTED',
} as const;

export type WarningCodeValue = (typeof WarningCode)[keyof typeof WarningCode];

export function createWarning(
  code: WarningCodeValue,
  message: string,
  sheet?: string,
  cell?: string,
): Warning {
  const w: Warning = { code, message };
  if (sheet !== undefined) w.sheet = sheet;
  if (cell !== undefined) w.cell = cell;
  return w;
}
