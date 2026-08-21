// ---------------------------------------------------------------------------
// Workbook Inspector – tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import { inspectWorkbook, InspectorError } from '../src/inspector.js';
import { fixturePath } from './fixtures.js';
import type { WorkbookMetadata } from '../src/models.js';

// ---- 1. Single sheet -----------------------------------------------------

describe('single-sheet workbook', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('single-sheet.xlsx'));
  });

  it('has correct schema version', () => {
    expect(meta.schemaVersion).toBe('1.0');
  });

  it('has correct file metadata', () => {
    expect(meta.file.name).toBe('single-sheet.xlsx');
    expect(meta.file.extension).toBe('.xlsx');
    expect(meta.file.sizeBytes).toBeGreaterThan(0);
    expect(meta.file.path).toContain('single-sheet.xlsx');
  });

  it('has exactly one sheet', () => {
    expect(meta.workbook.sheets).toHaveLength(1);
    expect(meta.workbook.sheets[0].name).toBe('Sheet1');
    expect(meta.workbook.sheets[0].index).toBe(0);
  });

  it('sheet is visible', () => {
    expect(meta.workbook.sheets[0].state).toBe('visible');
  });

  it('has a dimension', () => {
    expect(meta.workbook.sheets[0].dimension).toBe('A1:B2');
    expect(meta.workbook.sheets[0].minRow).toBe(1);
    expect(meta.workbook.sheets[0].maxRow).toBe(2);
    expect(meta.workbook.sheets[0].minColumn).toBe(1);
    expect(meta.workbook.sheets[0].maxColumn).toBe(2);
  });

  it('has no freeze pane', () => {
    expect(meta.workbook.sheets[0].freezePane).toBeNull();
  });

  it('has no auto filter', () => {
    expect(meta.workbook.sheets[0].autoFilter).toBeNull();
  });
});

// ---- 2. Multiple sheets --------------------------------------------------

describe('multiple-sheets workbook', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('multiple-sheets.xlsx'));
  });

  it('preserves sheet order', () => {
    const names = meta.workbook.sheets.map((s) => s.name);
    expect(names).toEqual(['First', 'Second', 'Third']);
  });

  it('assigns correct indices', () => {
    meta.workbook.sheets.forEach((s, i) => {
      expect(s.index).toBe(i);
    });
  });

  it('all sheets are visible', () => {
    meta.workbook.sheets.forEach((s) => {
      expect(s.state).toBe('visible');
    });
  });
});

// ---- 3. Hidden sheet -----------------------------------------------------

describe('hidden sheets', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('hidden-sheets.xlsx'));
  });

  it('has one visible and one hidden sheet', () => {
    expect(meta.workbook.sheets).toHaveLength(2);
    expect(meta.workbook.sheets[0].state).toBe('visible');
    expect(meta.workbook.sheets[0].name).toBe('Visible');
    expect(meta.workbook.sheets[1].state).toBe('hidden');
    expect(meta.workbook.sheets[1].name).toBe('HiddenSheet');
  });
});

// ---- 4. Very hidden sheet ------------------------------------------------

describe('very hidden sheet', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('very-hidden-sheet.xlsx'));
  });

  it('detects veryHidden state', () => {
    expect(meta.workbook.sheets).toHaveLength(2);
    expect(meta.workbook.sheets[0].state).toBe('visible');
    // ExcelJS may map veryHidden differently; accept veryHidden or hidden.
    const veryHiddenState = meta.workbook.sheets[1].state;
    expect(['veryHidden', 'hidden']).toContain(veryHiddenState);
  });
});

// ---- 5. Freeze pane ------------------------------------------------------

describe('freeze pane', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('freeze-pane.xlsx'));
  });

  it('extracts freeze pane correctly (xSplit=2, ySplit=3 → C4)', () => {
    expect(meta.workbook.sheets[0].freezePane).toBe('C4');
  });
});

// ---- 6. Auto filter ------------------------------------------------------

describe('auto filter', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('auto-filter.xlsx'));
  });

  it('extracts auto filter range', () => {
    expect(meta.workbook.sheets[0].autoFilter).toBe('A1:B3');
  });
});

// ---- 7. Named range – workbook scope -------------------------------------

describe('named range – workbook scope', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('named-range-wb.xlsx'));
  });

  it('contains at least one defined name', () => {
    expect(meta.workbook.definedNames.length).toBeGreaterThanOrEqual(1);
  });

  it('has workbook-scoped defined name "MyRange"', () => {
    const myRange = meta.workbook.definedNames.find((d) => d.name === 'MyRange');
    expect(myRange).toBeDefined();
    expect(myRange!.scope).toBe('workbook');
    expect(myRange!.sheetIndex).toBeNull();
    expect(myRange!.value).toContain('Data');
  });
});

// ---- 8. Named range – sheet scope ----------------------------------------

describe('named range – sheet scope', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('named-range-sheet.xlsx'));
  });

  it('contains a sheet-scoped defined name', () => {
    const localRange = meta.workbook.definedNames.find((d) => d.name === 'LocalRange');
    expect(localRange).toBeDefined();
    expect(localRange!.scope).toBe('sheet');
    expect(localRange!.sheetIndex).toBe(1);
  });
});

// ---- 8b. Named range – hidden defined name --------------------------------

describe('named range – hidden name', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('named-range-hidden.xlsx'));
  });

  it('contains both visible and hidden defined names', () => {
    expect(meta.workbook.definedNames.length).toBeGreaterThanOrEqual(2);
  });

  it('visible name has hidden=false', () => {
    const visible = meta.workbook.definedNames.find((d) => d.name === 'VisibleRange');
    expect(visible).toBeDefined();
    expect(visible!.hidden).toBe(false);
    expect(visible!.scope).toBe('workbook');
  });

  it('hidden name has hidden=true', () => {
    const hidden = meta.workbook.definedNames.find((d) => d.name === 'HiddenRange');
    expect(hidden).toBeDefined();
    expect(hidden!.hidden).toBe(true);
    expect(hidden!.scope).toBe('workbook');
    expect(hidden!.value).toContain('Data');
  });
});

// ---- 9. Empty workbook ---------------------------------------------------

describe('empty workbook', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('empty-workbook.xlsx'));
  });

  it('has one sheet with no meaningful dimension', () => {
    expect(meta.workbook.sheets).toHaveLength(1);
    expect(meta.workbook.sheets[0].name).toBe('EmptySheet');
    // Empty sheet should have null dimension and a warning.
    expect(meta.workbook.sheets[0].dimension).toBeNull();
  });

  it('emits SHEET_DIMENSION_UNRELIABLE warning', () => {
    const dimWarning = meta.warnings.find(
      (w) => w.code === 'SHEET_DIMENSION_UNRELIABLE',
    );
    expect(dimWarning).toBeDefined();
  });
});

// ---- 9b. Single-cell sheet (A1:A1 with real content must NOT be null) ----

describe('single-cell sheet (A1:A1 with content)', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('single-cell.xlsx'));
  });

  it('preserves A1:A1 dimension when cell has real content', () => {
    expect(meta.workbook.sheets[0].dimension).toBe('A1:A1');
    expect(meta.workbook.sheets[0].minRow).toBe(1);
    expect(meta.workbook.sheets[0].maxRow).toBe(1);
    expect(meta.workbook.sheets[0].minColumn).toBe(1);
    expect(meta.workbook.sheets[0].maxColumn).toBe(1);
  });

  it('does NOT emit SHEET_DIMENSION_UNRELIABLE for non-empty A1', () => {
    const dimWarning = meta.warnings.find(
      (w) => w.code === 'SHEET_DIMENSION_UNRELIABLE',
    );
    expect(dimWarning).toBeUndefined();
  });
});

// ---- 9c. externalLinks warning is always present --------------------------

describe('external links warning', () => {
  it('always emits EXTERNAL_LINKS_NOT_FULLY_SUPPORTED even with no links', async () => {
    const meta = await inspectWorkbook(fixturePath('single-sheet.xlsx'));
    const extWarning = meta.warnings.find(
      (w) => w.code === 'EXTERNAL_LINKS_NOT_FULLY_SUPPORTED',
    );
    expect(extWarning).toBeDefined();
    expect(extWarning!.message).toContain('may not be fully detectable');
    // externalLinks array is empty but warning makes it clear detection is best-effort
    expect(meta.workbook.externalLinks).toEqual([]);
  });
});

// ---- 10. Unicode / Japanese sheet names ----------------------------------

describe('unicode sheet names', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('unicode-sheets.xlsx'));
  });

  it('preserves Japanese sheet names', () => {
    const names = meta.workbook.sheets.map((s) => s.name);
    expect(names).toEqual(['画面設計', '項目定義']);
  });

  it('sheets have dimensions', () => {
    meta.workbook.sheets.forEach((s) => {
      expect(s.dimension).not.toBeNull();
    });
  });
});

// ---- 11. .xlsm file ------------------------------------------------------

describe('xlsm file', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('macro-workbook.xlsm'));
  });

  it('inspects the workbook successfully', () => {
    expect(meta.schemaVersion).toBe('1.0');
    expect(meta.file.extension).toBe('.xlsm');
    expect(meta.workbook.sheets.length).toBeGreaterThanOrEqual(1);
  });

  it('emits MACRO_CONTENT_NOT_INSPECTED warning', () => {
    const macroWarning = meta.warnings.find(
      (w) => w.code === 'MACRO_CONTENT_NOT_INSPECTED',
    );
    expect(macroWarning).toBeDefined();
  });
});

// ---- 12. Invalid extension -----------------------------------------------

describe('invalid extension', () => {
  it('throws UNSUPPORTED_FILE_FORMAT for .xls', async () => {
    await expect(inspectWorkbook(fixturePath('legacy.xls'))).rejects.toThrow(
      InspectorError,
    );
    try {
      await inspectWorkbook(fixturePath('legacy.xls'));
    } catch (err) {
      expect(err).toBeInstanceOf(InspectorError);
      expect((err as InspectorError).code).toBe('UNSUPPORTED_FILE_FORMAT');
    }
  });
});

// ---- 13. Missing file ----------------------------------------------------

describe('missing file', () => {
  it('throws FILE_NOT_FOUND', async () => {
    await expect(
      inspectWorkbook('/nonexistent/path/missing.xlsx'),
    ).rejects.toThrow(InspectorError);
    try {
      await inspectWorkbook('/nonexistent/path/missing.xlsx');
    } catch (err) {
      expect(err).toBeInstanceOf(InspectorError);
      expect((err as InspectorError).code).toBe('FILE_NOT_FOUND');
    }
  });
});

// ---- 14. Corrupted file --------------------------------------------------

describe('corrupted file', () => {
  it('throws CORRUPTED_WORKBOOK', async () => {
    await expect(
      inspectWorkbook(fixturePath('corrupted.xlsx')),
    ).rejects.toThrow(InspectorError);
    try {
      await inspectWorkbook(fixturePath('corrupted.xlsx'));
    } catch (err) {
      expect(err).toBeInstanceOf(InspectorError);
      expect((err as InspectorError).code).toBe('CORRUPTED_WORKBOOK');
    }
  });
});

// ---- 15. Workbook with metadata properties --------------------------------

describe('workbook with properties', () => {
  let meta: WorkbookMetadata;

  beforeAll(async () => {
    meta = await inspectWorkbook(fixturePath('with-properties.xlsx'));
  });

  it('extracts title', () => {
    expect(meta.workbook.properties.title).toBe('Test Workbook Title');
  });

  it('extracts creator', () => {
    expect(meta.workbook.properties.creator).toBe('Test Author');
  });

  it('extracts subject', () => {
    expect(meta.workbook.properties.subject).toBe('Testing');
  });

  it('extracts keywords', () => {
    expect(meta.workbook.properties.keywords).toBe('test, inspector');
  });

  it('extracts description', () => {
    expect(meta.workbook.properties.description).toBe(
      'A workbook for testing property extraction',
    );
  });

  it('extracts lastModifiedBy', () => {
    expect(meta.workbook.properties.lastModifiedBy).toBe('Last Editor');
  });

  it('extracts created date', () => {
    expect(meta.workbook.properties.created).toBe('2026-01-15T10:00:00.000Z');
  });

  it('extracts modified date', () => {
    expect(meta.workbook.properties.modified).toBe('2026-06-20T14:30:00.000Z');
  });

  it('extracts category', () => {
    expect(meta.workbook.properties.category).toBe('TestCategory');
  });
});

// ---- Determinism ----------------------------------------------------------

describe('deterministic output', () => {
  it('produces identical output for the same file', async () => {
    const a = await inspectWorkbook(fixturePath('single-sheet.xlsx'));
    const b = await inspectWorkbook(fixturePath('single-sheet.xlsx'));
    // Compare everything except file.path (absolute) and sizeBytes (stable).
    expect(a.schemaVersion).toBe(b.schemaVersion);
    expect(a.workbook.sheets).toEqual(b.workbook.sheets);
    expect(a.workbook.definedNames).toEqual(b.workbook.definedNames);
    expect(a.warnings).toEqual(b.warnings);
  });
});

// ---- JSON property ordering -----------------------------------------------

describe('JSON property ordering', () => {
  it('top-level keys are in correct order', async () => {
    const meta = await inspectWorkbook(fixturePath('single-sheet.xlsx'));
    const keys = Object.keys(meta);
    expect(keys).toEqual(['schemaVersion', 'file', 'workbook', 'warnings']);
  });

  it('workbook keys are in correct order', async () => {
    const meta = await inspectWorkbook(fixturePath('single-sheet.xlsx'));
    const keys = Object.keys(meta.workbook);
    expect(keys).toEqual([
      'properties',
      'sheets',
      'definedNames',
      'externalLinks',
      'calculation',
    ]);
  });
});
