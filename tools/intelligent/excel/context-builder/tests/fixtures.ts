// ---------------------------------------------------------------------------
// Excel AI Context Builder – test fixtures
// ---------------------------------------------------------------------------
// Creates minimal deterministic-extractor outputs for unit testing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkbookMetadataInput, WorkbookLayoutInput, SheetLayoutInput, CellInput } from '../src/models.js';

export interface TestFixture {
  workbook: WorkbookMetadataInput;
  layout: WorkbookLayoutInput;
  dir: string;
}

/** Write a fixture to a temp directory and return paths. */
export function writeFixture(fixture: { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput }, dir: string): void {
  mkdirSync(join(dir, 'layout'), { recursive: true });
  writeFileSync(join(dir, 'workbook.json'), JSON.stringify(fixture.workbook));
  writeFileSync(join(dir, 'layout', 'full-extract.json'), JSON.stringify(fixture.layout));
}

// ---- Helpers --------------------------------------------------------------

function makeCell(row: number, col: number, value: string, opts?: Partial<CellInput>): CellInput {
  const addr = `${colToLetter(col)}${row}`;
  return {
    address: addr,
    row,
    column: col,
    rawValue: value,
    displayValue: value,
    type: 'string',
    formula: null,
    cachedResult: null,
    numFmt: null,
    styleId: 's0',
    hyperlink: null,
    comment: null,
    isRichText: false,
    source: { sheet: 'Sheet1', cell: addr },
    ...opts,
  };
}

function colToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function makeSheet(name: string, index: number, cells: CellInput[], overrides?: Partial<SheetLayoutInput>): SheetLayoutInput {
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b).map((r) => ({
    row: r, height: null, hidden: false, outlineLevel: 0,
  }));
  const cols = [...new Set(cells.map((c) => c.column))].sort((a, b) => a - b).map((c) => ({
    column: c, width: null, hidden: false, outlineLevel: 0,
  }));
  const maxRow = Math.max(...cells.map((c) => c.row));
  const maxCol = Math.max(...cells.map((c) => c.column));
  const minRow = Math.min(...cells.map((c) => c.row));
  const minCol = Math.min(...cells.map((c) => c.column));

  return {
    index,
    name,
    dimension: cells.length > 0 ? `${colToLetter(minCol)}${minRow}:${colToLetter(maxCol)}${maxRow}` : null,
    rowCount: maxRow,
    columnCount: maxCol,
    rows,
    columns: cols,
    mergedRanges: [],
    cells,
    styles: {},
    validations: [],
    tables: [],
    annotations: [],
    objects: [],
    conditionalFormatting: [],
    pageSetup: null,
    arrayFormulas: [],
    warnings: [],
    ...overrides,
  };
}

function makeWorkbook(sheets: Array<{ name: string; dimension: string | null }>): WorkbookMetadataInput {
  return {
    schemaVersion: '1.0',
    file: { path: '/tmp/test.xlsx', name: 'test.xlsx', extension: '.xlsx', sizeBytes: 1000 },
    workbook: {
      properties: {},
      sheets: sheets.map((s, i) => ({
        index: i, name: s.name, state: 'visible', dimension: s.dimension,
        minRow: 1, maxRow: 10, minColumn: 1, maxColumn: 5,
        freezePane: null, autoFilter: null,
      })),
      definedNames: [],
      externalLinks: [],
      calculation: null,
    },
    warnings: [],
  };
}

function makeLayout(sheets: SheetLayoutInput[]): WorkbookLayoutInput {
  return {
    schemaVersion: '1.0',
    file: { path: '/tmp/test.xlsx', name: 'test.xlsx', extension: '.xlsx', sizeBytes: 1000 },
    sheets,
    warnings: [],
  };
}

// ---- Fixture: Simple small sheet (1 chunk) --------------------------------

export function simpleSmallSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Name'), makeCell(1, 2, 'Age'), makeCell(1, 3, 'City'),
    makeCell(2, 1, 'Alice'), makeCell(2, 2, '30', { type: 'number', rawValue: 30 }), makeCell(2, 3, 'Tokyo'),
    makeCell(3, 1, 'Bob'), makeCell(3, 2, '25', { type: 'number', rawValue: 25 }), makeCell(3, 3, 'Osaka'),
  ];
  const sheet = makeSheet('Sheet1', 0, cells);
  return { workbook: makeWorkbook([{ name: 'Sheet1', dimension: 'A1:C3' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Multiple sheets ---------------------------------------------

export function multipleSheets(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells1 = [makeCell(1, 1, 'A'), makeCell(1, 2, 'B'), makeCell(2, 1, '1'), makeCell(2, 2, '2')];
  const cells2 = [makeCell(1, 1, 'X'), makeCell(1, 2, 'Y'), makeCell(2, 1, '9'), makeCell(2, 2, '8')];
  const s1 = makeSheet('First', 0, cells1);
  const s2 = makeSheet('Second', 1, cells2);
  return {
    workbook: makeWorkbook([{ name: 'First', dimension: 'A1:B2' }, { name: 'Second', dimension: 'A1:B2' }]),
    layout: makeLayout([s1, s2]),
  };
}

// ---- Fixture: Unicode content ---------------------------------------------

export function unicodeSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, '名前'), makeCell(1, 2, '年齢'),
    makeCell(2, 1, '田中太郎'), makeCell(2, 2, '30'),
    makeCell(3, 1, 'Nguyễn Văn A'), makeCell(3, 2, '25'),
    makeCell(4, 1, '中文测试'), makeCell(4, 2, '40'),
  ];
  const sheet = makeSheet('Unicode', 0, cells);
  return { workbook: makeWorkbook([{ name: 'Unicode', dimension: 'A1:B4' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Multiline content -------------------------------------------

export function multilineSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Field'), makeCell(1, 2, 'Value'),
    makeCell(2, 1, 'JSON'), makeCell(2, 2, '{\n  "key": "value",\n  "nested": true\n}'),
    makeCell(3, 1, 'List'), makeCell(3, 2, 'item1\nitem2\nitem3'),
  ];
  const sheet = makeSheet('Multi', 0, cells);
  return { workbook: makeWorkbook([{ name: 'Multi', dimension: 'A1:B3' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Styled empty cells ------------------------------------------

export function styledEmptyCells(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Header1', { styleId: 's1' }), makeCell(1, 2, 'Header2', { styleId: 's1' }),
    makeCell(2, 1, 'Data1'), makeCell(2, 2, 'Data2'),
    makeCell(3, 1, '', { styleId: 's0', rawValue: '', displayValue: '' }),
    makeCell(3, 2, '', { styleId: 's0', rawValue: '', displayValue: '' }),
  ];
  const sheet = makeSheet('Styled', 0, cells);
  return { workbook: makeWorkbook([{ name: 'Styled', dimension: 'A1:B3' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Large table (needs chunking) --------------------------------

export function largeTable(maxRows: number = 100): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [];
  // Header
  cells.push(makeCell(1, 1, 'ID'), makeCell(1, 2, 'Name'), makeCell(1, 3, 'Value'));
  // Data rows
  for (let r = 2; r <= maxRows; r++) {
    cells.push(
      makeCell(r, 1, String(r - 1), { type: 'number', rawValue: r - 1 }),
      makeCell(r, 2, `Item ${r - 1}`),
      makeCell(r, 3, `Value ${r - 1}`),
    );
  }
  const sheet = makeSheet('Large', 0, cells);
  return { workbook: makeWorkbook([{ name: 'Large', dimension: `A1:C${maxRows}` }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Merged cells ------------------------------------------------

export function mergedCellsSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Title'), makeCell(1, 2, ''), makeCell(1, 3, ''),
    makeCell(2, 1, 'A'), makeCell(2, 2, 'B'), makeCell(2, 3, 'C'),
    makeCell(3, 1, '1'), makeCell(3, 2, '2'), makeCell(3, 3, '3'),
    makeCell(4, 1, '4'), makeCell(4, 2, '5'), makeCell(4, 3, '6'),
  ];
  const sheet = makeSheet('Merged', 0, cells, {
    mergedRanges: [{
      range: 'A1:C1', masterCell: 'A1',
      topRow: 1, leftColumn: 1, bottomRow: 1, rightColumn: 3,
    }],
  });
  return { workbook: makeWorkbook([{ name: 'Merged', dimension: 'A1:C4' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Hidden rows/columns -----------------------------------------

export function hiddenRowsCols(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'H1'), makeCell(1, 2, 'H2'), makeCell(1, 3, 'H3'),
    makeCell(2, 1, 'D1'), makeCell(2, 2, 'D2'), makeCell(2, 3, 'D3'),
    makeCell(3, 1, 'H1'), makeCell(3, 2, 'H2'), makeCell(3, 3, 'H3'),
  ];
  const sheet = makeSheet('Hidden', 0, cells, {
    rows: [
      { row: 1, height: 20, hidden: false, outlineLevel: 0 },
      { row: 2, height: 20, hidden: true, outlineLevel: 0 },
      { row: 3, height: 20, hidden: false, outlineLevel: 0 },
    ],
    columns: [
      { column: 1, width: 10, hidden: false, outlineLevel: 0 },
      { column: 2, width: 10, hidden: true, outlineLevel: 0 },
      { column: 3, width: 10, hidden: false, outlineLevel: 0 },
    ],
  });
  return { workbook: makeWorkbook([{ name: 'Hidden', dimension: 'A1:C3' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Formula cells -----------------------------------------------

export function formulaSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'A'), makeCell(1, 2, 'B'), makeCell(1, 3, 'Sum'),
    makeCell(2, 1, '10', { type: 'number', rawValue: 10 }),
    makeCell(2, 2, '20', { type: 'number', rawValue: 20 }),
    makeCell(2, 3, '30', { type: 'number', rawValue: 30, formula: 'A2+B2', cachedResult: 30 }),
  ];
  const sheet = makeSheet('Formulas', 0, cells);
  return { workbook: makeWorkbook([{ name: 'Formulas', dimension: 'A1:C2' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Comments + hyperlinks ---------------------------------------

export function annotationsSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Cell'), makeCell(1, 2, 'Link'),
    makeCell(2, 1, 'Note', { comment: 'This is a comment' }),
    makeCell(2, 2, 'Click', { hyperlink: 'https://example.com' }),
  ];
  const sheet = makeSheet('Annotations', 0, cells, {
    annotations: [
      { type: 'comment', source: { sheet: 'Annotations', cell: 'A2' }, author: 'Test', comment: 'This is a comment' },
      { type: 'hyperlink', source: { sheet: 'Annotations', cell: 'B2' }, target: 'https://example.com', text: 'Click' },
    ],
  });
  return { workbook: makeWorkbook([{ name: 'Annotations', dimension: 'A1:B2' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Image/object anchor -----------------------------------------

export function objectSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Image'), makeCell(1, 2, 'Description'),
    makeCell(2, 1, 'Here'), makeCell(2, 2, 'A picture'),
  ];
  const sheet = makeSheet('Objects', 0, cells, {
    objects: [{
      type: 'image',
      relationshipId: 'rId1',
      anchor: {
        type: 'twoCellAnchor',
        from: { row: 1, column: 1, rowOffset: 0, columnOffset: 0 },
        to: { row: 5, column: 3, rowOffset: 0, columnOffset: 0 },
      },
      asset: { target: 'media/image1.png', mimeType: 'image/png', sizeBytes: 12345, extractedPath: null },
      text: null,
      source: { sheet: 'Objects' },
    }],
  });
  return { workbook: makeWorkbook([{ name: 'Objects', dimension: 'A1:B2' }]), layout: makeLayout([sheet]) };
}

// ---- Fixture: Validation --------------------------------------------------

export function validationSheet(): { workbook: WorkbookMetadataInput; layout: WorkbookLayoutInput } {
  const cells: CellInput[] = [
    makeCell(1, 1, 'Status'), makeCell(1, 2, 'Count'),
    makeCell(2, 1, 'Active'), makeCell(2, 2, '10'),
  ];
  const sheet = makeSheet('Validation', 0, cells, {
    validations: [{
      ranges: ['A2:A100'], type: 'list', operator: null,
      formula1: '"Active,Inactive,Pending"', formula2: null,
      allowBlank: false, showInputMessage: true, showErrorMessage: true,
      promptTitle: 'Status', prompt: 'Choose status',
      errorTitle: null, error: null,
    }],
  });
  return { workbook: makeWorkbook([{ name: 'Validation', dimension: 'A1:B2' }]), layout: makeLayout([sheet]) };
}
