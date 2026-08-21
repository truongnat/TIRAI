// ---------------------------------------------------------------------------
// Warning codes & helpers
// ---------------------------------------------------------------------------

import type { Warning } from './models.js';

/** All recognised warning codes. */
export const WarningCode = {
  UNSUPPORTED_FILE_EXTENSION: 'UNSUPPORTED_FILE_EXTENSION',
  CORRUPTED_WORKBOOK_METADATA: 'CORRUPTED_WORKBOOK_METADATA',
  SHEET_DIMENSION_UNRELIABLE: 'SHEET_DIMENSION_UNRELIABLE',
  UNKNOWN_SHEET_STATE: 'UNKNOWN_SHEET_STATE',
  EXTERNAL_LINKS_NOT_FULLY_SUPPORTED: 'EXTERNAL_LINKS_NOT_FULLY_SUPPORTED',
  CALCULATION_PROPERTIES_NOT_SUPPORTED: 'CALCULATION_PROPERTIES_NOT_SUPPORTED',
  MACRO_CONTENT_NOT_INSPECTED: 'MACRO_CONTENT_NOT_INSPECTED',
} as const;

export type WarningCodeValue = (typeof WarningCode)[keyof typeof WarningCode];

/** Create a warning object. `sheet` is optional. */
export function createWarning(
  code: WarningCodeValue,
  message: string,
  sheet?: string,
): Warning {
  const w: Warning = { code, message };
  if (sheet !== undefined) {
    w.sheet = sheet;
  }
  return w;
}
