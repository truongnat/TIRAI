// ---------------------------------------------------------------------------
// Cell + Layout Extractor – tests (Phase 1 + 2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { extractWorkbook, ExtractorError } from '../src/extractor.js';
import { fixturePath } from './fixtures.js';

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
      'rows', 'columns', 'mergedRanges', 'cells', 'styles', 'warnings',
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
