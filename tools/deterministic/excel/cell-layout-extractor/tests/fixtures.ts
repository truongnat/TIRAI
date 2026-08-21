// ---------------------------------------------------------------------------
// Test fixture generation – creates Excel workbooks for Phase 1 + 2 tests
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as fpath from 'node:path';
import ExcelJS from 'exceljs';

const FIXTURES_DIR = fpath.join(import.meta.dirname, 'fixtures');

export async function createAllFixtures(): Promise<void> {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  await cellTypes();
  await formulas();
  await mergedCells();
  await styles();
  await hiddenRowsCols();
  await emptyStyled();
  await unicodeContent();
  await multiSheet();
  await corruptedFile();

  // Phase 3 fixtures
  await validations();
  await tables();
  await hyperlinks();
  await comments();
  await cellWithHyperLINKAndComment();
}

export function fixturePath(name: string): string {
  return fpath.join(FIXTURES_DIR, name);
}

// ---- 1. Cell types -------------------------------------------------------

async function cellTypes(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Types');

  ws.getCell('A1').value = 'Text value';
  ws.getCell('A2').value = 42;
  ws.getCell('A3').value = 3.14;
  ws.getCell('A4').value = true;
  ws.getCell('A5').value = false;
  ws.getCell('A6').value = new Date('2026-01-15T10:00:00Z');
  ws.getCell('A7').value = { richText: [
    { text: 'Bold ', font: { bold: true } },
    { text: 'and normal' },
  ]};
  ws.getCell('A8').value = null;
  ws.getCell('A9').value = '';

  await wb.xlsx.writeFile(fixturePath('cell-types.xlsx'));
}

// ---- 2. Formulas ---------------------------------------------------------

async function formulas(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formulas');

  ws.getCell('A1').value = 10;
  ws.getCell('A2').value = 20;
  ws.getCell('A3').value = 30;
  ws.getCell('B1').value = { formula: 'SUM(A1:A3)', result: 60 };
  ws.getCell('B2').value = { formula: 'A1*2', result: 20 };
  ws.getCell('B3').value = { formula: 'AVERAGE(A1:A3)' };

  await wb.xlsx.writeFile(fixturePath('formulas.xlsx'));
}

// ---- 3. Merged cells -----------------------------------------------------

async function mergedCells(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Merged');

  ws.getCell('A1').value = 'Header';
  ws.mergeCells('A1:C1');

  ws.getCell('A3').value = 'Merged Block';
  ws.mergeCells('A3:B5');

  ws.getCell('D1').value = 'Solo';

  await wb.xlsx.writeFile(fixturePath('merged-cells.xlsx'));
}

// ---- 4. Styles -----------------------------------------------------------

async function styles(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Styled');

  // Bold + red font
  ws.getCell('A1').value = 'Bold Red';
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFFF0000' }, size: 14 };

  // Yellow fill
  ws.getCell('A2').value = 'Yellow BG';
  ws.getCell('A2').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFF00' },
  };

  // Thin border
  ws.getCell('A3').value = 'Bordered';
  ws.getCell('A3').border = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' },
  };

  // Center alignment + wrap
  ws.getCell('A4').value = 'Centered wrapped text';
  ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  // Number format
  ws.getCell('A5').value = 1234.5678;
  ws.getCell('A5').numFmt = '#,##0.00';

  await wb.xlsx.writeFile(fixturePath('styles.xlsx'));
}

// ---- 5. Hidden rows/columns ----------------------------------------------

async function hiddenRowsCols(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hidden');

  ws.getCell('A1').value = 'Visible';
  ws.getCell('A2').value = 'Hidden Row';
  ws.getCell('A3').value = 'Visible Again';

  ws.getCell('B1').value = 'Col A';
  ws.getCell('C1').value = 'Hidden Col';
  ws.getCell('D1').value = 'Col C';

  // Hide row 2
  ws.getRow(2).hidden = true;
  ws.getRow(2).height = 20;

  // Hide column C (column 3)
  ws.getColumn(3).hidden = true;
  ws.getColumn(2).width = 25;

  await wb.xlsx.writeFile(fixturePath('hidden-rows-cols.xlsx'));
}

// ---- 6. Empty styled cells -----------------------------------------------

async function emptyStyled(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('EmptyStyled');

  // Cell with border but no value
  ws.getCell('A1').border = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' },
  };

  // Cell with fill but no value
  ws.getCell('B1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFCCCCCC' },
  };

  // Normal cell with value
  ws.getCell('C1').value = 'Has value';

  await wb.xlsx.writeFile(fixturePath('empty-styled.xlsx'));
}

// ---- 7. Unicode content --------------------------------------------------

async function unicodeContent(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('日本語');

  ws.getCell('A1').value = '出荷日';
  ws.getCell('A2').value = '数量';
  ws.getCell('B1').value = 'テストデータ';
  ws.getCell('B2').value = 100;

  await wb.xlsx.writeFile(fixturePath('unicode-content.xlsx'));
}

// ---- 8. Multi-sheet ------------------------------------------------------

async function multiSheet(): Promise<void> {
  const wb = new ExcelJS.Workbook();

  const ws1 = wb.addWorksheet('Sheet1');
  ws1.getCell('A1').value = 'First';
  ws1.getCell('A2').value = 1;

  const ws2 = wb.addWorksheet('Sheet2');
  ws2.getCell('A1').value = 'Second';
  ws2.getCell('B1').value = true;

  await wb.xlsx.writeFile(fixturePath('multi-sheet.xlsx'));
}

// ---- 9. Corrupted file ---------------------------------------------------

function corruptedFile(): void {
  fs.writeFileSync(
    fixturePath('corrupted.xlsx'),
    Buffer.from('this is not a valid xlsx file'),
  );
}

// ---- 10. Data Validations ------------------------------------------------

async function validations(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Validations');

  // Header
  ws.getCell('A1').value = 'Status';
  ws.getCell('B1').value = 'Quantity';
  ws.getCell('C1').value = 'Date';

  // List validation on A2:A100
  ws.getCell('A2').value = 'Yes';
  ws.dataValidations.add('A2:A100', {
    type: 'list',
    allowBlank: true,
    formulae: ['"Yes,No,Maybe"'],
    showInputMessage: true,
    showErrorMessage: true,
    errorTitle: 'Invalid Status',
    error: 'Please select Yes, No, or Maybe',
  });

  // Numeric validation on B2:B100
  ws.getCell('B2').value = 50;
  ws.dataValidations.add('B2:B100', {
    type: 'whole',
    operator: 'between',
    formulae: ['0', '1000'],
    allowBlank: false,
    showErrorMessage: true,
    errorTitle: 'Invalid Quantity',
    error: 'Must be between 0 and 1000',
  });

  await wb.xlsx.writeFile(fixturePath('validations.xlsx'));
}

// ---- 11. Tables ----------------------------------------------------------

async function tables(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tables');

  // Headers
  ws.getCell('A1').value = 'ID';
  ws.getCell('B1').value = 'Name';
  ws.getCell('C1').value = 'Email';
  ws.getCell('D1').value = 'Active';

  // Data
  ws.getCell('A2').value = 1;
  ws.getCell('B2').value = 'Alice';
  ws.getCell('C2').value = 'alice@example.com';
  ws.getCell('D2').value = true;

  ws.getCell('A3').value = 2;
  ws.getCell('B3').value = 'Bob';
  ws.getCell('C3').value = 'bob@example.com';
  ws.getCell('D3').value = false;

  // Add table
  ws.addTable({
    name: 'UserTable',
    ref: 'A1:D3',
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleMedium2',
      showRowStripes: true,
    },
    columns: [
      { name: 'ID' },
      { name: 'Name' },
      { name: 'Email' },
      { name: 'Active' },
    ],
    rows: [
      [1, 'Alice', 'alice@example.com', true],
      [2, 'Bob', 'bob@example.com', false],
    ],
  });

  await wb.xlsx.writeFile(fixturePath('tables.xlsx'));
}

// ---- 12. Hyperlinks ------------------------------------------------------

async function hyperlinks(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hyperlinks');

  // External hyperlink
  ws.getCell('A1').value = {
    text: 'Open Google',
    hyperlink: 'https://www.google.com',
  };

  // External with tooltip
  ws.getCell('A2').value = {
    text: 'Visit GitHub',
    hyperlink: 'https://github.com',
    tooltip: 'Go to GitHub',
  };

  // Internal hyperlink
  ws.getCell('A3').value = {
    text: 'Go to Sheet2',
    hyperlink: "#'Sheet2'!A1",
  };

  // Another sheet for internal link target
  const ws2 = wb.addWorksheet('Sheet2');
  ws2.getCell('A1').value = 'Target';

  await wb.xlsx.writeFile(fixturePath('hyperlinks.xlsx'));
}

// ---- 13. Comments --------------------------------------------------------

async function comments(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');

  // Simple comment
  ws.getCell('A1').value = 'Header';
  ws.getCell('A1').note = 'This is a header cell';

  // Comment with Unicode/Japanese
  ws.getCell('B1').value = '出荷日';
  ws.getCell('B1').note = '確認してください';

  // Comment with author (using object format)
  ws.getCell('C1').value = 'Review';
  ws.getCell('C1').note = {
    texts: [{ text: 'Please review this' }],
    author: 'Reviewer',
  } as ExcelJS.Comment;

  await wb.xlsx.writeFile(fixturePath('comments.xlsx'));
}

// ---- 14. Cell with both hyperlink and comment ----------------------------

async function cellWithHyperLINKAndComment(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Both');

  ws.getCell('A1').value = {
    text: 'Link with note',
    hyperlink: 'https://example.com',
  };
  ws.getCell('A1').note = 'Important link';

  await wb.xlsx.writeFile(fixturePath('cell-both.xlsx'));
}
