// ---------------------------------------------------------------------------
// Test fixture generation – creates small Excel workbooks for testing
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as fpath from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const FIXTURES_DIR = fpath.join(import.meta.dirname, 'fixtures');

/** Ensure the fixtures directory exists and populate it. */
export async function createAllFixtures(): Promise<void> {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  await singleSheet();
  await multipleSheets();
  await hiddenSheets();
  await veryHiddenSheet();
  await freezePane();
  await autoFilter();
  await namedRangeWorkbookScope();
  await namedRangeSheetScope();
  await namedRangeHidden();
  await singleCellSheet();
  await emptyWorkbook();
  await unicodeSheetName();
  await xlsmFile();
  await withProperties();
  await invalidExtension();
  await corruptedFile();
}

/** Return the absolute path to a fixture file. */
export function fixturePath(name: string): string {
  return fpath.join(FIXTURES_DIR, name);
}

// ---- Individual fixtures --------------------------------------------------

async function singleSheet(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Hello';
  ws.getCell('B1').value = 'World';
  ws.getCell('A2').value = 42;
  await wb.xlsx.writeFile(fixturePath('single-sheet.xlsx'));
}

async function multipleSheets(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('First');
  ws1.getCell('A1').value = 'A';
  ws1.getCell('B2').value = 'B';

  const ws2 = wb.addWorksheet('Second');
  ws2.getCell('A1').value = 'X';

  const ws3 = wb.addWorksheet('Third');
  ws3.getCell('C5').value = 'Z';

  await wb.xlsx.writeFile(fixturePath('multiple-sheets.xlsx'));
}

async function hiddenSheets(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('Visible');
  ws1.getCell('A1').value = 'data';

  const ws2 = wb.addWorksheet('HiddenSheet');
  ws2.state = 'hidden';
  ws2.getCell('A1').value = 'hidden data';

  await wb.xlsx.writeFile(fixturePath('hidden-sheets.xlsx'));
}

async function veryHiddenSheet(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('Visible');
  ws1.getCell('A1').value = 'data';

  const ws2 = wb.addWorksheet('VeryHiddenSheet');
  ws2.state = 'veryHidden';
  ws2.getCell('A1').value = 'very hidden data';

  await wb.xlsx.writeFile(fixturePath('very-hidden-sheet.xlsx'));
}

async function freezePane(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Frozen');
  ws.views = [{ state: 'frozen' as const, xSplit: 2, ySplit: 3 }];
  ws.getCell('A1').value = 'frozen';
  ws.getCell('C4').value = 'data';
  await wb.xlsx.writeFile(fixturePath('freeze-pane.xlsx'));
}

async function autoFilter(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Filtered');
  ws.getCell('A1').value = 'Name';
  ws.getCell('B1').value = 'Age';
  ws.getCell('A2').value = 'Alice';
  ws.getCell('B2').value = 30;
  ws.getCell('A3').value = 'Bob';
  ws.getCell('B3').value = 25;
  ws.autoFilter = 'A1:B3';
  await wb.xlsx.writeFile(fixturePath('auto-filter.xlsx'));
}

async function namedRangeWorkbookScope(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'val1';
  ws.getCell('A2').value = 'val2';
  ws.getCell('A3').value = 'val3';
  // Use definedNames.add() which accepts (formula, name).
  wb.definedNames.add('Data!$A$1:$A$3', 'MyRange');
  await wb.xlsx.writeFile(fixturePath('named-range-wb.xlsx'));
}

async function namedRangeSheetScope(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('Sheet1');
  ws1.getCell('A1').value = 'a';

  const ws2 = wb.addWorksheet('Sheet2');
  ws2.getCell('A1').value = 'b';
  ws2.getCell('A2').value = 'c';

  const outPath = fixturePath('named-range-sheet.xlsx');
  await wb.xlsx.writeFile(outPath);

  // ExcelJS does not reliably persist sheet-scoped defined names, so we
  // inject them directly into the workbook XML via the zip.
  await injectDefinedNames(outPath, [
    { name: 'LocalRange', value: 'Sheet2!$A$1:$A$2', localSheetId: 1 },
  ]);
}

async function namedRangeHidden(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'x';
  ws.getCell('A2').value = 'y';

  const outPath = fixturePath('named-range-hidden.xlsx');
  await wb.xlsx.writeFile(outPath);

  // Inject a workbook-scoped visible name AND a hidden name.
  await injectDefinedNames(outPath, [
    { name: 'VisibleRange', value: 'Data!$A$1:$A$2' },
    { name: 'HiddenRange', value: 'Data!$A$1:$A$1', hidden: true },
  ]);
}

/** Inject <definedName> entries into an existing xlsx file. */
async function injectDefinedNames(
  xlsxPath: string,
  names: Array<{ name: string; value: string; localSheetId?: number; hidden?: boolean }>,
): Promise<void> {
  const buf = fs.readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(buf);
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');

  const entries = names
    .map((n) => {
      const scopeAttr = n.localSheetId !== undefined ? ` localSheetId="${n.localSheetId}"` : '';
      const hiddenAttr = n.hidden ? ' hidden="1"' : '';
      return `<definedName name="${n.name}"${scopeAttr}${hiddenAttr}>${n.value}</definedName>`;
    })
    .join('\n');

  const definedNamesBlock = `<definedNames>\n${entries}\n</definedNames>`;

  // Insert before </workbook> or replace existing <definedNames> block.
  let modified: string;
  if (wbXml.includes('<definedNames>')) {
    modified = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, definedNamesBlock);
  } else {
    modified = wbXml.replace('</workbook>', `${definedNamesBlock}\n</workbook>`);
  }

  zip.file('xl/workbook.xml', modified);
  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(xlsxPath, outBuf);
}

async function singleCellSheet(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('OnlyA1');
  ws.getCell('A1').value = 'single';
  await wb.xlsx.writeFile(fixturePath('single-cell.xlsx'));
}

async function emptyWorkbook(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS always creates at least one sheet when writing.
  // We add one with no data to simulate an "empty" workbook.
  wb.addWorksheet('EmptySheet');
  await wb.xlsx.writeFile(fixturePath('empty-workbook.xlsx'));
}

async function unicodeSheetName(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('画面設計');
  ws.getCell('A1').value = 'テスト';
  ws.getCell('B1').value = 'データ';

  const ws2 = wb.addWorksheet('項目定義');
  ws2.getCell('A1').value = '項目1';

  await wb.xlsx.writeFile(fixturePath('unicode-sheets.xlsx'));
}

async function xlsmFile(): Promise<void> {
  // Create a normal xlsx and save with .xlsm extension.
  // This won't contain real VBA, but it tests extension-based handling.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MacroSheet');
  ws.getCell('A1').value = 'macro data';
  await wb.xlsx.writeFile(fixturePath('macro-workbook.xlsm'));
}

async function withProperties(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Test Author';
  wb.title = 'Test Workbook Title';
  wb.subject = 'Testing';
  wb.keywords = 'test, inspector';
  wb.description = 'A workbook for testing property extraction';
  wb.lastModifiedBy = 'Last Editor';
  wb.created = new Date('2026-01-15T10:00:00Z');
  wb.modified = new Date('2026-06-20T14:30:00Z');
  wb.category = 'TestCategory';

  const ws = wb.addWorksheet('Props');
  ws.getCell('A1').value = 'data';
  await wb.xlsx.writeFile(fixturePath('with-properties.xlsx'));
}

function invalidExtension(): void {
  // Write a plain text file with .xls extension.
  fs.writeFileSync(fixturePath('legacy.xls'), 'not a real xls file');
}

function corruptedFile(): void {
  // Write random bytes with .xlsx extension.
  fs.writeFileSync(
    fixturePath('corrupted.xlsx'),
    Buffer.from('this is not a valid xlsx file at all'),
  );
}
