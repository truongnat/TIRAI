// ---------------------------------------------------------------------------
// Excel AI Context Builder – input loader + validation
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ContextBuilderError, FatalCode, WarningCode } from './warnings.js';
import type {
  WorkbookMetadataInput,
  WorkbookLayoutInput,
  ContextWarning,
} from './models.js';

export interface LoadedInputs {
  workbook: WorkbookMetadataInput;
  layout: WorkbookLayoutInput;
  inputDir: string;
  warnings: ContextWarning[];
}

/**
 * Load and validate deterministic Excel outputs from the given directory.
 *
 * Expected structure:
 *   <inputDir>/workbook.json
 *   <inputDir>/layout/full-extract.json   (or layout/sheets/sheet-NNN.json)
 */
export function loadInputs(inputDir: string): LoadedInputs {
  const absDir = resolve(inputDir);

  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
    throw new ContextBuilderError(
      FatalCode.INVALID_INPUT_DIRECTORY,
      `Input directory does not exist: ${absDir}`,
    );
  }

  const warnings: ContextWarning[] = [];

  // -- workbook.json --------------------------------------------------------
  const workbookPath = join(absDir, 'workbook.json');
  if (!existsSync(workbookPath)) {
    throw new ContextBuilderError(
      FatalCode.WORKBOOK_METADATA_MISSING,
      `workbook.json not found in ${absDir}`,
    );
  }
  const workbook = readJsonFile<WorkbookMetadataInput>(workbookPath);
  validateSchemaVersion(workbook.schemaVersion, workbookPath);

  // -- layout data ----------------------------------------------------------
  const layoutPath = join(absDir, 'layout', 'full-extract.json');
  if (!existsSync(layoutPath)) {
    throw new ContextBuilderError(
      FatalCode.LAYOUT_DATA_MISSING,
      `layout/full-extract.json not found in ${absDir}`,
    );
  }
  const layout = readJsonFile<WorkbookLayoutInput>(layoutPath);
  validateSchemaVersion(layout.schemaVersion, layoutPath);

  // -- cross-validate sheet counts -----------------------------------------
  const wbSheetCount = workbook.workbook.sheets.length;
  const layoutSheetCount = layout.sheets.length;
  if (wbSheetCount !== layoutSheetCount) {
    warnings.push({
      code: WarningCode.SOURCE_SHEET_MISSING,
      message: `Workbook reports ${wbSheetCount} sheets but layout has ${layoutSheetCount}.`,
    });
  }

  // -- check source file exists ---------------------------------------------
  const sourceFile = workbook.file.path;
  if (sourceFile && !existsSync(sourceFile)) {
    warnings.push({
      code: WarningCode.SOURCE_FILE_MISSING,
      message: `Original Excel file not found: ${sourceFile}`,
    });
  }

  return { workbook, layout, inputDir: absDir, warnings };
}

// ---- Helpers --------------------------------------------------------------

function readJsonFile<T>(filePath: string): T {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    throw new ContextBuilderError(FatalCode.INPUT_NOT_FOUND, `Cannot read file: ${filePath}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new ContextBuilderError(
      FatalCode.INVALID_JSON,
      `Invalid JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateSchemaVersion(version: string, filePath: string): void {
  if (version !== '1.0') {
    throw new ContextBuilderError(
      FatalCode.UNSUPPORTED_SCHEMA_VERSION,
      `Unsupported schema version "${version}" in ${filePath}. Expected "1.0".`,
    );
  }
}
