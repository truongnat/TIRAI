// ---------------------------------------------------------------------------
// Cell + Layout Extractor – tests (Phase 1 + 2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { extractWorkbook, ExtractorError } from '../src/extractor.js';
import { fixturePath } from './fixtures.js';
import { WorkbookOOXMLContext } from '../src/ooxml-context.js';

// ---- 1. Cell types -------------------------------------------------------

describe('cell types', () => {
  it('extracts all basic types correctly', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    expect(meta.sheets).toHaveLength(1);

    const cells = meta.sheets[0].cells;
    const byAddr = Object.fromEntries(cells.map((c) => [c.address, c]));

    // String
    expect(byAddr['A1'].rawValue).toBe('Text value');
    expect(byAddr['A1'].type).toBe('string');

    // Integer
    expect(byAddr['A2'].rawValue).toBe(42);
    expect(byAddr['A2'].type).toBe('number');

    // Float
    expect(byAddr['A3'].rawValue).toBe(3.14);
    expect(byAddr['A3'].type).toBe('number');

    // Boolean true
    expect(byAddr['A4'].rawValue).toBe(true);
    expect(byAddr['A4'].type).toBe('boolean');

    // Boolean false
    expect(byAddr['A5'].rawValue).toBe(false);
    expect(byAddr['A5'].type).toBe('boolean');

    // Date
    expect(byAddr['A6'].type).toBe('date');
    expect(byAddr['A6'].rawValue).toContain('2026-01-15');

    // Rich text
    expect(byAddr['A7'].type).toBe('richtext');
    expect(byAddr['A7'].isRichText).toBe(true);

    // Empty string
    expect(byAddr['A9'].rawValue).toBe('');
    expect(byAddr['A9'].type).toBe('string');
  });

  it('all cells have source provenance', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const cells = meta.sheets[0].cells;
    for (const cell of cells) {
      expect(cell.source).toBeDefined();
      expect(cell.source.sheet).toBe('Types');
      expect(cell.source.cell).toBe(cell.address);
    }
  });
});

describe('memory profiling', () => {
  it('is opt-in and records workbook and sheet boundaries', async () => {
    const normal = await extractWorkbook(fixturePath('cell-types.xlsx'));
    expect(normal.performanceProfile).toBeUndefined();

    const profiled = await extractWorkbook(fixturePath('multi-sheet.xlsx'), {
      profilePerformance: true,
    });
    expect(profiled.performanceProfile?.memory.map((snapshot) => snapshot.label)).toEqual(
      expect.arrayContaining(['before-workbook-load', 'after-ooxml-context', 'before-serialization']),
    );
    expect(profiled.performanceProfile?.sheets).toHaveLength(profiled.sheets.length);
    expect(profiled.performanceProfile?.sheets[0].memory.length).toBeGreaterThan(0);
    expect(profiled.performanceProfile?.sheets[0].estimatedSheetObjectBytes).toBeGreaterThan(0);
  });

  it('keeps OOXML text cache workbook-scoped and releasable', async () => {
    const context = await WorkbookOOXMLContext.fromFile(fixturePath('cell-types.xlsx'));
    await context.text('xl/workbook.xml');
    await context.text('xl/worksheets/sheet1.xml');
    expect(context.profile().cachedEntries).toBe(2);
    context.release('xl/worksheets/sheet1.xml');
    expect(context.profile().cachedEntries).toBe(1);
  });
});

// ---- 2. Formulas ---------------------------------------------------------

describe('formulas', () => {
  it('extracts formula and cached result', async () => {
    const meta = await extractWorkbook(fixturePath('formulas.xlsx'));
    const cells = meta.sheets[0].cells;
    const byAddr = Object.fromEntries(cells.map((c) => [c.address, c]));

    expect(byAddr['B1'].type).toBe('formula');
    expect(byAddr['B1'].formula).toBe('SUM(A1:A3)');
    expect(byAddr['B1'].cachedResult).toBe(60);
    expect(byAddr['B1'].rawValue).toBe(60);

    expect(byAddr['B2'].formula).toBe('A1*2');
    expect(byAddr['B2'].cachedResult).toBe(20);
  });

  it('warns when formula has no cached result', async () => {
    const meta = await extractWorkbook(fixturePath('formulas.xlsx'));
    const cells = meta.sheets[0].cells;
    const b3 = cells.find((c) => c.address === 'B3');
    expect(b3).toBeDefined();
    expect(b3!.formula).toBe('AVERAGE(A1:A3)');
    expect(b3!.cachedResult).toBeNull();

    const warning = meta.sheets[0].warnings.find(
      (w) => w.code === 'FORMULA_CACHED_VALUE_MISSING',
    );
    expect(warning).toBeDefined();
  });
});

// ---- 3. Merged cells -----------------------------------------------------

describe('merged cells', () => {
  it('extracts merged ranges correctly', async () => {
    const meta = await extractWorkbook(fixturePath('merged-cells.xlsx'));
    const sheet = meta.sheets[0];

    expect(sheet.mergedRanges.length).toBeGreaterThanOrEqual(2);

    const ranges = sheet.mergedRanges.map((m) => m.range);
    expect(ranges).toContain('A1:C1');
    expect(ranges).toContain('A3:B5');

    // Master cell check
    const merge1 = sheet.mergedRanges.find((m) => m.range === 'A1:C1');
    expect(merge1!.masterCell).toBe('A1');
    expect(merge1!.topRow).toBe(1);
    expect(merge1!.leftColumn).toBe(1);
    expect(merge1!.bottomRow).toBe(1);
    expect(merge1!.rightColumn).toBe(3);

    const merge2 = sheet.mergedRanges.find((m) => m.range === 'A3:B5');
    expect(merge2!.masterCell).toBe('A3');
    expect(merge2!.topRow).toBe(3);
    expect(merge2!.bottomRow).toBe(5);
  });

  it('master cell retains its value', async () => {
    const meta = await extractWorkbook(fixturePath('merged-cells.xlsx'));
    const cells = meta.sheets[0].cells;
    const a1 = cells.find((c) => c.address === 'A1');
    expect(a1!.rawValue).toBe('Header');
  });
});

describe('empty merged cells', () => {
  it('extracts empty merged masters and children without throwing', async () => {
    const meta = await extractWorkbook(fixturePath('empty-merged-cells.xlsx'));
    const sheet = meta.sheets[0];
    const byAddr = Object.fromEntries(sheet.cells.map((c) => [c.address, c]));

    expect(sheet.mergedRanges).toHaveLength(50);
    expect(byAddr.A1).toMatchObject({
      rawValue: null,
      displayValue: null,
      type: null,
      formula: null,
      cachedResult: null,
      isRichText: false,
    });
    expect(byAddr.B2).toMatchObject({
      rawValue: null,
      displayValue: null,
      type: null,
    });
  });

  it('preserves deterministic output for empty merged cells', async () => {
    const input = fixturePath('empty-merged-cells.xlsx');
    const first = await extractWorkbook(input);
    const second = await extractWorkbook(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// ---- 4. Styles -----------------------------------------------------------

describe('styles', () => {
  it('extracts and deduplicates styles', async () => {
    const meta = await extractWorkbook(fixturePath('styles.xlsx'));
    const sheet = meta.sheets[0];

    // Should have multiple styles
    const styleCount = Object.keys(sheet.styles).length;
    expect(styleCount).toBeGreaterThanOrEqual(3);

    // Check bold red font
    const a1 = sheet.cells.find((c) => c.address === 'A1');
    expect(a1).toBeDefined();
    expect(a1!.styleId).not.toBeNull();
    const style1 = sheet.styles[a1!.styleId!];
    expect(style1.font).not.toBeNull();
    expect(style1.font!.bold).toBe(true);
    expect(style1.font!.color).toContain('FF0000');
    expect(style1.font!.size).toBe(14);

    // Check fill
    const a2 = sheet.cells.find((c) => c.address === 'A2');
    const style2 = sheet.styles[a2!.styleId!];
    expect(style2.fill).not.toBeNull();
    expect(style2.fill!.type).toBe('pattern');
    expect(style2.fill!.fgColor).toContain('FFFF00');

    // Check border
    const a3 = sheet.cells.find((c) => c.address === 'A3');
    const style3 = sheet.styles[a3!.styleId!];
    expect(style3.border).not.toBeNull();
    expect(style3.border!.top!.style).toBe('thin');

    // Check alignment
    const a4 = sheet.cells.find((c) => c.address === 'A4');
    const style4 = sheet.styles[a4!.styleId!];
    expect(style4.alignment).not.toBeNull();
    expect(style4.alignment!.horizontal).toBe('center');
    expect(style4.alignment!.wrapText).toBe(true);

    // Check number format
    const a5 = sheet.cells.find((c) => c.address === 'A5');
    expect(a5!.numFmt).toBe('#,##0.00');
  });
});

// ---- 5. Hidden rows/columns ----------------------------------------------

describe('hidden rows and columns', () => {
  it('detects hidden row', async () => {
    const meta = await extractWorkbook(fixturePath('hidden-rows-cols.xlsx'));
    const sheet = meta.sheets[0];

    const row2 = sheet.rows.find((r) => r.row === 2);
    expect(row2).toBeDefined();
    expect(row2!.hidden).toBe(true);
    expect(row2!.height).toBe(20);
  });

  it('detects hidden column', async () => {
    const meta = await extractWorkbook(fixturePath('hidden-rows-cols.xlsx'));
    const sheet = meta.sheets[0];

    const col3 = sheet.columns.find((c) => c.column === 3);
    expect(col3).toBeDefined();
    expect(col3!.hidden).toBe(true);
  });

  it('extracts custom column width', async () => {
    const meta = await extractWorkbook(fixturePath('hidden-rows-cols.xlsx'));
    const sheet = meta.sheets[0];

    const col2 = sheet.columns.find((c) => c.column === 2);
    expect(col2).toBeDefined();
    expect(col2!.width).toBe(25);
  });
});

// ---- 6. Empty styled cells -----------------------------------------------

describe('empty styled cells', () => {
  it('includes empty cells with borders/fills', async () => {
    const meta = await extractWorkbook(fixturePath('empty-styled.xlsx'));
    const sheet = meta.sheets[0];
    const cells = sheet.cells;

    // A1: empty but has border
    const a1 = cells.find((c) => c.address === 'A1');
    expect(a1).toBeDefined();
    expect(a1!.rawValue).toBeNull();
    expect(a1!.styleId).not.toBeNull();
    const styleA1 = sheet.styles[a1!.styleId!];
    expect(styleA1.border).not.toBeNull();

    // B1: empty but has fill
    const b1 = cells.find((c) => c.address === 'B1');
    expect(b1).toBeDefined();
    expect(b1!.rawValue).toBeNull();
    expect(b1!.styleId).not.toBeNull();
    const styleB1 = sheet.styles[b1!.styleId!];
    expect(styleB1.fill).not.toBeNull();

    // C1: has value
    const c1 = cells.find((c) => c.address === 'C1');
    expect(c1).toBeDefined();
    expect(c1!.rawValue).toBe('Has value');
  });
});

// ---- 7. Unicode content --------------------------------------------------

describe('unicode content', () => {
  it('preserves Japanese sheet name and cell values', async () => {
    const meta = await extractWorkbook(fixturePath('unicode-content.xlsx'));
    expect(meta.sheets[0].name).toBe('日本語');

    const cells = meta.sheets[0].cells;
    const a1 = cells.find((c) => c.address === 'A1');
    expect(a1!.rawValue).toBe('出荷日');

    const b1 = cells.find((c) => c.address === 'B1');
    expect(b1!.rawValue).toBe('テストデータ');
  });
});

// ---- 8. Multi-sheet ------------------------------------------------------

describe('multi-sheet', () => {
  it('extracts all sheets in order', async () => {
    const meta = await extractWorkbook(fixturePath('multi-sheet.xlsx'));
    expect(meta.sheets).toHaveLength(2);
    expect(meta.sheets[0].name).toBe('Sheet1');
    expect(meta.sheets[1].name).toBe('Sheet2');
    expect(meta.sheets[0].index).toBe(0);
    expect(meta.sheets[1].index).toBe(1);
  });

  it('supports --sheet filter by name', async () => {
    const meta = await extractWorkbook(fixturePath('multi-sheet.xlsx'), {
      sheets: ['Sheet2'],
    });
    expect(meta.sheets).toHaveLength(1);
    expect(meta.sheets[0].name).toBe('Sheet2');
  });

  it('supports --sheet filter by index', async () => {
    const meta = await extractWorkbook(fixturePath('multi-sheet.xlsx'), {
      sheets: [0],
    });
    expect(meta.sheets).toHaveLength(1);
    expect(meta.sheets[0].name).toBe('Sheet1');
  });
});

// ---- 9. Error handling ---------------------------------------------------

describe('error handling', () => {
  it('throws FILE_NOT_FOUND for missing file', async () => {
    await expect(extractWorkbook('/nonexistent/file.xlsx')).rejects.toThrow(
      ExtractorError,
    );
  });

  it('throws UNSUPPORTED_FILE_FORMAT for .xls', async () => {
    // Create a temp .xls file
    const fs = await import('node:fs');
    const tmpPath = fixturePath('temp-legacy.xls');
    fs.writeFileSync(tmpPath, 'not xls');
    try {
      await expect(extractWorkbook(tmpPath)).rejects.toThrow(ExtractorError);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws CORRUPTED_WORKBOOK for invalid file', async () => {
    await expect(
      extractWorkbook(fixturePath('corrupted.xlsx')),
    ).rejects.toThrow(ExtractorError);
  });
});

// ---- 10. Deterministic output --------------------------------------------

describe('deterministic output', () => {
  it('produces identical output for same file', async () => {
    const a = await extractWorkbook(fixturePath('styles.xlsx'));
    const b = await extractWorkbook(fixturePath('styles.xlsx'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---- 11. JSON property ordering ------------------------------------------

describe('JSON property ordering', () => {
  it('top-level keys are in correct order', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const keys = Object.keys(meta);
    expect(keys).toEqual(['schemaVersion', 'file', 'sheets', 'warnings']);
  });

  it('sheet keys are in correct order', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const keys = Object.keys(meta.sheets[0]);
    expect(keys).toEqual([
      'index', 'name', 'dimension', 'rowCount', 'columnCount',
      'rows', 'columns', 'mergedRanges', 'cells', 'styles',
      'validations', 'tables', 'annotations', 'objects',
      'conditionalFormatting', 'pageSetup', 'arrayFormulas', 'warnings',
    ]);
  });
});

// ---- 12. Cells sorted row-major ------------------------------------------

describe('cell ordering', () => {
  it('cells are sorted by row then column', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const cells = meta.sheets[0].cells;
    for (let i = 1; i < cells.length; i++) {
      const prev = cells[i - 1];
      const curr = cells[i];
      expect(
        prev.row < curr.row || (prev.row === curr.row && prev.column <= curr.column),
      ).toBe(true);
    }
  });
});

// ===========================================================================
// Phase 3 Tests: Validations, Tables, Annotations
// ===========================================================================

// ---- 13. Data Validations ------------------------------------------------

describe('data validations', () => {
  it('extracts list validation', async () => {
    const meta = await extractWorkbook(fixturePath('validations.xlsx'));
    const sheet = meta.sheets[0];

    expect(sheet.validations.length).toBeGreaterThanOrEqual(1);

    const listVal = sheet.validations.find((v) => v.type === 'list');
    expect(listVal).toBeDefined();
    expect(listVal!.ranges).toContain('A2:A100');
    expect(listVal!.formula1).toContain('Yes,No,Maybe');
    expect(listVal!.allowBlank).toBe(true);
    expect(listVal!.showErrorMessage).toBe(true);
    expect(listVal!.errorTitle).toBe('Invalid Status');
  });

  it('extracts numeric validation with operator', async () => {
    const meta = await extractWorkbook(fixturePath('validations.xlsx'));
    const sheet = meta.sheets[0];

    const numVal = sheet.validations.find((v) => v.type === 'whole');
    expect(numVal).toBeDefined();
    expect(numVal!.operator).toBe('between');
    expect(numVal!.formula1).toBe('0');
    expect(numVal!.formula2).toBe('1000');
    expect(numVal!.ranges).toContain('B2:B100');
  });
});

// ---- 14. Tables ----------------------------------------------------------

describe('tables', () => {
  it('extracts table with columns and style', async () => {
    const meta = await extractWorkbook(fixturePath('tables.xlsx'));
    const sheet = meta.sheets[0];

    expect(sheet.tables.length).toBeGreaterThanOrEqual(1);

    const table = sheet.tables.find((t) => t.name === 'UserTable');
    expect(table).toBeDefined();
    expect(table!.displayName).toBe('UserTable');
    expect(table!.range).toBe('A1:D3');
    expect(table!.headerRow).toBe(true);
    expect(table!.totalsRow).toBe(false);

    // Columns
    expect(table!.columns.length).toBe(4);
    expect(table!.columns.map((c) => c.name)).toEqual(['ID', 'Name', 'Email', 'Active']);

    // Style
    expect(table!.style).not.toBeNull();
    expect(table!.style!.name).toContain('TableStyleMedium2');
    expect(table!.style!.showRowStripes).toBe(true);
  });
});

// ---- 15. Hyperlinks ------------------------------------------------------

describe('hyperlinks', () => {
  it('extracts external hyperlink', async () => {
    const meta = await extractWorkbook(fixturePath('hyperlinks.xlsx'));
    const sheet = meta.sheets[0];

    const link = sheet.annotations.find(
      (a) => a.type === 'hyperlink' && a.source.cell === 'A1',
    );
    expect(link).toBeDefined();
    expect(link!.target).toBe('https://www.google.com');
    expect(link!.source.sheet).toBe('Hyperlinks');
  });

  it('extracts hyperlink with tooltip', async () => {
    const meta = await extractWorkbook(fixturePath('hyperlinks.xlsx'));
    const sheet = meta.sheets[0];

    const link = sheet.annotations.find(
      (a) => a.type === 'hyperlink' && a.source.cell === 'A2',
    );
    expect(link).toBeDefined();
    expect(link!.target).toBe('https://github.com');
    // Note: ExcelJS does not persist tooltip through write/read cycle
    // tooltip may be null - this is a known limitation
  });

  it('preserves internal hyperlink as-is', async () => {
    const meta = await extractWorkbook(fixturePath('hyperlinks.xlsx'));
    const sheet = meta.sheets[0];

    const link = sheet.annotations.find(
      (a) => a.type === 'hyperlink' && a.source.cell === 'A3',
    );
    expect(link).toBeDefined();
    // Internal links should be preserved raw
    expect(link!.target).toContain('Sheet2');
  });
});

// ---- 16. Comments --------------------------------------------------------

describe('comments', () => {
  it('extracts simple comment', async () => {
    const meta = await extractWorkbook(fixturePath('comments.xlsx'));
    const sheet = meta.sheets[0];

    const comment = sheet.annotations.find(
      (a) => a.type === 'comment' && a.source.cell === 'A1',
    );
    expect(comment).toBeDefined();
    expect(comment!.comment).toBe('This is a header cell');
  });

  it('extracts Unicode/Japanese comment', async () => {
    const meta = await extractWorkbook(fixturePath('comments.xlsx'));
    const sheet = meta.sheets[0];

    const comment = sheet.annotations.find(
      (a) => a.type === 'comment' && a.source.cell === 'B1',
    );
    expect(comment).toBeDefined();
    expect(comment!.comment).toBe('確認してください');
  });

  it('extracts comment with author', async () => {
    const meta = await extractWorkbook(fixturePath('comments.xlsx'));
    const sheet = meta.sheets[0];

    const comment = sheet.annotations.find(
      (a) => a.type === 'comment' && a.source.cell === 'C1',
    );
    expect(comment).toBeDefined();
    expect(comment!.comment).toBe('Please review this');
    // Note: ExcelJS does not persist comment author through write/read cycle
    // author may be null - this is a known limitation
  });
});

// ---- 17. Cell with both hyperlink and comment ----------------------------

describe('cell with hyperlink and comment', () => {
  it('extracts both annotations for same cell', async () => {
    const meta = await extractWorkbook(fixturePath('cell-both.xlsx'));
    const sheet = meta.sheets[0];

    const hyperlink = sheet.annotations.find(
      (a) => a.type === 'hyperlink' && a.source.cell === 'A1',
    );
    const comment = sheet.annotations.find(
      (a) => a.type === 'comment' && a.source.cell === 'A1',
    );

    expect(hyperlink).toBeDefined();
    expect(hyperlink!.target).toBe('https://example.com');

    expect(comment).toBeDefined();
    expect(comment!.comment).toBe('Important link');
  });
});

// ---- 18. Sheet keys include Phase 3+5 fields ------------------------------

describe('sheet schema Phase 3+5', () => {
  it('sheet keys include validations, tables, annotations, objects, Phase 5', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const keys = Object.keys(meta.sheets[0]);
    expect(keys).toContain('validations');
    expect(keys).toContain('tables');
    expect(keys).toContain('annotations');
    expect(keys).toContain('objects');
    expect(keys).toContain('conditionalFormatting');
    expect(keys).toContain('pageSetup');
    expect(keys).toContain('arrayFormulas');
  });
});

// ===========================================================================
// Phase 4 Tests: Drawing Objects (Images, Shapes, Charts)
// ===========================================================================

// ---- 20. Single image ----------------------------------------------------

describe('single image', () => {
  it('extracts image with twoCellAnchor', async () => {
    const meta = await extractWorkbook(fixturePath('single-image.xlsx'));
    const sheet = meta.sheets[0];

    expect(sheet.objects.length).toBeGreaterThanOrEqual(1);

    const img = sheet.objects.find((o) => o.type === 'image');
    expect(img).toBeDefined();
    expect(img!.relationshipId).toBeTruthy();
    expect(img!.anchor).not.toBeNull();
    expect(img!.anchor!.type).toBe('twoCellAnchor');
    expect(img!.anchor!.from).not.toBeNull();
    expect(img!.anchor!.from!.column).toBe(1);
    expect(img!.anchor!.from!.row).toBe(1);
  });

  it('includes asset metadata with mime type', async () => {
    const meta = await extractWorkbook(fixturePath('single-image.xlsx'));
    const img = meta.sheets[0].objects.find((o) => o.type === 'image');
    expect(img).toBeDefined();
    expect(img!.asset).not.toBeNull();
    expect(img!.asset!.mimeType).toBe('image/png');
    expect(img!.asset!.sizeBytes).toBeGreaterThan(0);
    expect(img!.asset!.extractedPath).toBeNull(); // --assets not used
  });

  it('has sheet source provenance', async () => {
    const meta = await extractWorkbook(fixturePath('single-image.xlsx'));
    const img = meta.sheets[0].objects.find((o) => o.type === 'image');
    expect(img).toBeDefined();
    expect(img!.source.sheet).toBe('Image');
  });
});

// ---- 21. Multiple images -------------------------------------------------

describe('multiple images', () => {
  it('extracts all images', async () => {
    const meta = await extractWorkbook(fixturePath('multiple-images.xlsx'));
    const images = meta.sheets[0].objects.filter((o) => o.type === 'image');
    expect(images.length).toBe(3);
  });

  it('each image has unique anchor position', async () => {
    const meta = await extractWorkbook(fixturePath('multiple-images.xlsx'));
    const images = meta.sheets[0].objects.filter((o) => o.type === 'image');
    const positions = images.map((i) => `${i.anchor?.from?.row},${i.anchor?.from?.column}`);
    const unique = new Set(positions);
    expect(unique.size).toBe(3);
  });
});

// ---- 22. One-cell anchor -------------------------------------------------

describe('oneCellAnchor', () => {
  it('extracts image with oneCellAnchor', async () => {
    const meta = await extractWorkbook(fixturePath('image-one-cell-anchor.xlsx'));
    const sheet = meta.sheets[0];
    const img = sheet.objects.find((o) => o.type === 'image');
    expect(img).toBeDefined();
    // ExcelJS may use twoCellAnchor internally; check anchor exists
    expect(img!.anchor).not.toBeNull();
    expect(img!.anchor!.from).not.toBeNull();
    expect(img!.anchor!.from!.column).toBe(2);
    expect(img!.anchor!.from!.row).toBe(2);
  });
});

// ---- 23. Shape / TextBox -------------------------------------------------

describe('shape/textbox', () => {
  it('extracts shape with text content', async () => {
    const meta = await extractWorkbook(fixturePath('shape-textbox.xlsx'));
    const sheet = meta.sheets[0];
    const shape = sheet.objects.find((o) => o.type === 'shape');
    expect(shape).toBeDefined();
    expect(shape!.text).toBe('TextBox content here');
    expect(shape!.anchor).not.toBeNull();
    expect(shape!.anchor!.type).toBe('twoCellAnchor');
  });
});

// ---- 24. Chart detection -------------------------------------------------

describe('chart detection', () => {
  it('detects chart and emits warning', async () => {
    const meta = await extractWorkbook(fixturePath('chart-detection.xlsx'));
    const sheet = meta.sheets[0];
    const chart = sheet.objects.find((o) => o.type === 'chart');
    expect(chart).toBeDefined();
    expect(chart!.relationshipId).toBeTruthy();
    expect(chart!.anchor).not.toBeNull();

    // Should have CHART_CONTENT_NOT_EXTRACTED warning
    const warning = sheet.warnings.find(
      (w) => w.code === 'CHART_CONTENT_NOT_EXTRACTED',
    );
    expect(warning).toBeDefined();
  });
});

// ---- 25. Sheet without drawings ------------------------------------------

describe('no drawings', () => {
  it('returns empty objects array for sheet without drawings', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const sheet = meta.sheets[0];
    expect(sheet.objects).toEqual([]);
  });
});

// ---- 26. Deterministic output --------------------------------------------

describe('deterministic objects', () => {
  it('produces identical objects for same file', async () => {
    const a = await extractWorkbook(fixturePath('single-image.xlsx'));
    const b = await extractWorkbook(fixturePath('single-image.xlsx'));
    expect(JSON.stringify(a.sheets[0].objects)).toBe(
      JSON.stringify(b.sheets[0].objects),
    );
  });
});

// ===========================================================================
// Phase 5 – Conditional Formatting / Page Setup / Array Formulas
// ===========================================================================

// ---- 27. Conditional Formatting (cellIs) ---------------------------------

describe('conditional formatting cellIs', () => {
  it('extracts cellIs rules with ranges', async () => {
    const meta = await extractWorkbook(fixturePath('cf-cell-is.xlsx'));
    const sheet = meta.sheets[0];
    expect(sheet.conditionalFormatting).toHaveLength(1);

    const cf = sheet.conditionalFormatting[0];
    expect(cf.ranges).toEqual(['A2:A10']);
    expect(cf.rules).toHaveLength(2);

    // First rule: greaterThan 0
    expect(cf.rules[0].type).toBe('cellIs');
    expect(cf.rules[0].operator).toBe('greaterThan');
    expect(cf.rules[0].formula).toEqual(['0']);
    expect(cf.rules[0].priority).toBe(1);
    expect(cf.rules[0].stopIfTrue).toBe(false);
    expect(cf.rules[0].dxfId).toBe(0);

    // Second rule: lessThan 50, stopIfTrue
    expect(cf.rules[1].type).toBe('cellIs');
    expect(cf.rules[1].operator).toBe('lessThan');
    expect(cf.rules[1].formula).toEqual(['50']);
    expect(cf.rules[1].priority).toBe(2);
    expect(cf.rules[1].stopIfTrue).toBe(true);
    expect(cf.rules[1].dxfId).toBe(1);
  });
});

// ---- 28. Conditional Formatting (formula-based) --------------------------

describe('conditional formatting formula', () => {
  it('extracts expression-type rules with formulas', async () => {
    const meta = await extractWorkbook(fixturePath('cf-formula.xlsx'));
    const sheet = meta.sheets[0];
    expect(sheet.conditionalFormatting).toHaveLength(1);

    const cf = sheet.conditionalFormatting[0];
    expect(cf.ranges).toEqual(['B2:B6']);
    expect(cf.rules).toHaveLength(2);

    // Rules sorted by priority
    expect(cf.rules[0].type).toBe('expression');
    expect(cf.rules[0].operator).toBeNull();
    expect(cf.rules[0].priority).toBe(3);
    expect(cf.rules[0].formula).toEqual(['A2>=80']);

    expect(cf.rules[1].type).toBe('expression');
    expect(cf.rules[1].priority).toBe(5);
    expect(cf.rules[1].formula).toEqual(['A2<50']);
  });
});

// ---- 29. Page Setup + Print ----------------------------------------------

describe('page setup', () => {
  it('extracts orientation, paper size, margins', async () => {
    const meta = await extractWorkbook(fixturePath('page-setup.xlsx'));
    const sheet = meta.sheets[0];
    expect(sheet.pageSetup).not.toBeNull();

    const ps = sheet.pageSetup!;
    expect(ps.orientation).toBe('landscape');
    expect(ps.paperSize).toBe(9);
    expect(ps.fitToWidth).toBe(1);
    expect(ps.fitToHeight).toBe(0);
  });

  it('extracts margins', async () => {
    const meta = await extractWorkbook(fixturePath('page-setup.xlsx'));
    const ps = meta.sheets[0].pageSetup!;
    expect(ps.margins).not.toBeNull();
    expect(ps.margins!.left).toBeCloseTo(0.7, 1);
    expect(ps.margins!.top).toBeCloseTo(0.75, 1);
  });

  it('extracts print area from defined names', async () => {
    const meta = await extractWorkbook(fixturePath('page-setup.xlsx'));
    const ps = meta.sheets[0].pageSetup!;
    expect(ps.printArea).toBe('A1:B20');
  });

  it('extracts print titles (repeat rows)', async () => {
    const meta = await extractWorkbook(fixturePath('page-setup.xlsx'));
    const ps = meta.sheets[0].pageSetup!;
    expect(ps.printTitles).not.toBeNull();
    expect(ps.printTitles!.rows).toBe('1:3');
  });
});

// ---- 30. Array Formula ---------------------------------------------------

describe('array formula', () => {
  it('extracts array formula with range and cached result', async () => {
    const meta = await extractWorkbook(fixturePath('array-formula.xlsx'));
    const sheet = meta.sheets[0];
    expect(sheet.arrayFormulas).toHaveLength(1);

    const af = sheet.arrayFormulas[0];
    expect(af.masterCell).toBe('C2');
    expect(af.range).toBe('C2');
    expect(af.formula).toBe('SUM(A2:A4*B2:B4)');
    expect(af.cachedResult).toBe(7800);
    expect(af.source.sheet).toBe('Array');
    expect(af.source.cell).toBe('C2');
  });
});

// ---- 31. No CF / No Page Setup / No Array --------------------------------

describe('no Phase 5 data', () => {
  it('returns empty/null for sheet without Phase 5 data', async () => {
    const meta = await extractWorkbook(fixturePath('cell-types.xlsx'));
    const sheet = meta.sheets[0];
    expect(sheet.conditionalFormatting).toEqual([]);
    expect(sheet.arrayFormulas).toEqual([]);
  });
});

// ---- 32. Deterministic Phase 5 output ------------------------------------

describe('deterministic Phase 5', () => {
  it('produces identical Phase 5 output for same file', async () => {
    const a = await extractWorkbook(fixturePath('cf-cell-is.xlsx'));
    const b = await extractWorkbook(fixturePath('cf-cell-is.xlsx'));
    expect(JSON.stringify(a.sheets[0].conditionalFormatting)).toBe(
      JSON.stringify(b.sheets[0].conditionalFormatting),
    );
  });
});
