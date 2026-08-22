// ---------------------------------------------------------------------------
// Test fixture generation – creates Excel workbooks for Phase 1 + 2 tests
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as fpath from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

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

  // Phase 4 fixtures
  await singleImage();
  await multipleImages();
  await imageOneCellAnchor();
  await shapeTextBox();
  await chartDetection();

  // Phase 5 fixtures
  await conditionalFormattingCellIs();
  await conditionalFormattingFormula();
  await pageSetupPrint();
  await arrayFormula();
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

// ---- Phase 4: Drawing Objects --------------------------------------------

// Minimal 1x1 red PNG (67 bytes)
function createMinimalPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
}

// ---- 15. Single image ----------------------------------------------------

async function singleImage(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Image');

  ws.getCell('A1').value = 'Sheet with image';

  const imageId = wb.addImage({
    buffer: createMinimalPng(),
    extension: 'png',
  });

  ws.addImage(imageId, {
    tl: { col: 1, row: 1 },
    br: { col: 4, row: 10 },
    editAs: 'oneCell',
  });

  await wb.xlsx.writeFile(fixturePath('single-image.xlsx'));
}

// ---- 16. Multiple images -------------------------------------------------

async function multipleImages(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MultiImage');

  const imageId = wb.addImage({
    buffer: createMinimalPng(),
    extension: 'png',
  });

  ws.addImage(imageId, {
    tl: { col: 0, row: 0 },
    br: { col: 3, row: 5 },
    editAs: 'oneCell',
  });

  ws.addImage(imageId, {
    tl: { col: 5, row: 0 },
    br: { col: 8, row: 5 },
    editAs: 'oneCell',
  });

  ws.addImage(imageId, {
    tl: { col: 0, row: 7 },
    br: { col: 3, row: 12 },
    editAs: 'oneCell',
  });

  await wb.xlsx.writeFile(fixturePath('multiple-images.xlsx'));
}

// ---- 17. Image with oneCellAnchor ----------------------------------------

async function imageOneCellAnchor(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('OneCell');

  const imageId = wb.addImage({
    buffer: createMinimalPng(),
    extension: 'png',
  });

  ws.addImage(imageId, {
    tl: { col: 2, row: 2 },
    ext: { width: 200, height: 150 },
    editAs: 'oneCell',
  });

  await wb.xlsx.writeFile(fixturePath('image-one-cell-anchor.xlsx'));
}

// ---- 18. Shape / TextBox (via raw XML injection) -------------------------

async function shapeTextBox(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Shape');
  ws.getCell('A1').value = 'Sheet with shape';

  const buf = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buf);

  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp macro="" textlink="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="2" name="TextBox 1"/>
        <xdr:cNvSpPr txBox="1"/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </xdr:spPr>
      <xdr:txBody>
        <a:bodyPr wrap="square" rtlCol="0"/>
        <a:lstStyle/>
        <a:p>
          <a:r>
            <a:rPr lang="en-US" dirty="0"/>
            <a:t>TextBox content here</a:t>
          </a:r>
        </a:p>
      </xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;

  zip.file('xl/drawings/drawing1.xml', drawingXml);

  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRels);

  const sheet1Xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const updatedSheet = sheet1Xml.replace(
    '</worksheet>',
    '<drawing r:id="rId1"/></worksheet>',
  );
  zip.file('xl/worksheets/sheet1.xml', updatedSheet);

  const sheetRelsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  let sheetRels = '';
  const existingRels = zip.file(sheetRelsPath);
  if (existingRels) {
    sheetRels = await existingRels.async('string');
    sheetRels = sheetRels.replace(
      '</Relationships>',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    );
  } else {
    sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
  }
  zip.file(sheetRelsPath, sheetRels);

  const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  const updatedCT = contentTypes.replace(
    '</Types>',
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
  );
  zip.file('[Content_Types].xml', updatedCT);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixturePath('shape-textbox.xlsx'), outBuf);
}

// ---- 19. Chart detection (via raw XML injection) -------------------------

async function chartDetection(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Chart');

  ws.getCell('A1').value = 'Category';
  ws.getCell('B1').value = 'Value';
  ws.getCell('A2').value = 'A';
  ws.getCell('B2').value = 10;
  ws.getCell('A3').value = 'B';
  ws.getCell('B3').value = 20;

  const buf = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buf);

  const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:lstStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Test Chart</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea><c:barChart><c:barDir val="col"/></c:barChart></c:plotArea>
  </c:chart>
</c:chartSpace>`;
  zip.file('xl/charts/chart1.xml', chartXml);

  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:ext cx="0" cy="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></xdr:xfrm>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
  zip.file('xl/drawings/drawing1.xml', drawingXml);

  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`;
  zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRels);

  const sheet1Xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const updatedSheet = sheet1Xml.replace(
    '</worksheet>',
    '<drawing r:id="rId1"/></worksheet>',
  );
  zip.file('xl/worksheets/sheet1.xml', updatedSheet);

  const sheetRelsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  let sheetRels = '';
  const existingRels = zip.file(sheetRelsPath);
  if (existingRels) {
    sheetRels = await existingRels.async('string');
    sheetRels = sheetRels.replace(
      '</Relationships>',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    );
  } else {
    sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
  }
  zip.file(sheetRelsPath, sheetRels);

  const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  let updatedCT = contentTypes.replace(
    '</Types>',
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>',
  );
  updatedCT = updatedCT.replace(
    '</Types>',
    '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.chart+xml"/></Types>',
  );
  zip.file('[Content_Types].xml', updatedCT);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixturePath('chart-detection.xlsx'), outBuf);
}

// ---- Phase 5: Conditional Formatting / Page Setup / Array Formulas --------

// ---- 20. Conditional Formatting (cellIs) ---------------------------------

async function conditionalFormattingCellIs(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CF');

  // Header
  ws.getCell('A1').value = 'Value';
  ws.getCell('B1').value = 'Status';

  // Data
  for (let i = 2; i <= 10; i++) {
    ws.getCell(`A${i}`).value = i * 10;
    ws.getCell(`B${i}`).value = `Item ${i}`;
  }

  const buf = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Inject conditional formatting XML into sheet
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const cfXml = `<conditionalFormatting sqref="A2:A10"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule><cfRule type="cellIs" dxfId="1" priority="2" stopIfTrue="1" operator="lessThan"><formula>50</formula></cfRule></conditionalFormatting>`;
  const updatedSheet = sheetXml.replace('</worksheet>', `${cfXml}</worksheet>`);
  zip.file('xl/worksheets/sheet1.xml', updatedSheet);

  // Add dxfs to styles.xml
  const stylesXml = await zip.file('xl/styles.xml')!.async('string');
  const dxfsXml = '<dxfs count="2"><dxf id="0"><font><b/><color rgb="FFFF0000"/></font></dxf><dxf id="1"><fill><bgColor rgb="FFFFFF00"/></fill></dxf></dxfs>';
  const updatedStyles = stylesXml.replace('</styleSheet>', `${dxfsXml}</styleSheet>`);
  zip.file('xl/styles.xml', updatedStyles);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixturePath('cf-cell-is.xlsx'), outBuf);
}

// ---- 21. Conditional Formatting (formula-based + multiple priorities) -----

async function conditionalFormattingFormula(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CFFormula');

  ws.getCell('A1').value = 'Score';
  ws.getCell('B1').value = 'Grade';
  for (let i = 2; i <= 6; i++) {
    ws.getCell(`A${i}`).value = i * 15;
    ws.getCell(`B${i}`).value = `Student ${i}`;
  }

  const buf = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buf);

  const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  const cfXml = `<conditionalFormatting sqref="B2:B6"><cfRule type="expression" dxfId="0" priority="3"><formula>A2&gt;=80</formula></cfRule><cfRule type="expression" dxfId="1" priority="5"><formula>A2&lt;50</formula></cfRule></conditionalFormatting>`;
  const updatedSheet = sheetXml.replace('</worksheet>', `${cfXml}</worksheet>`);
  zip.file('xl/worksheets/sheet1.xml', updatedSheet);

  const stylesXml = await zip.file('xl/styles.xml')!.async('string');
  const dxfsXml = '<dxfs count="2"><dxf id="0"><font><color rgb="FF008000"/></font></dxf><dxf id="1"><font><color rgb="FFFF0000"/></font></dxf></dxfs>';
  const updatedStyles = stylesXml.replace('</styleSheet>', `${dxfsXml}</styleSheet>`);
  zip.file('xl/styles.xml', updatedStyles);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixturePath('cf-formula.xlsx'), outBuf);
}

// ---- 22. Page Setup + Print Area + Print Titles --------------------------

async function pageSetupPrint(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Print');

  // Header rows (will be print titles)
  ws.getCell('A1').value = 'Report Title';
  ws.getCell('A2').value = 'Generated Date';
  ws.getCell('A3').value = 'Category';
  ws.getCell('B3').value = 'Amount';

  // Data
  for (let i = 4; i <= 20; i++) {
    ws.getCell(`A${i}`).value = `Item ${i - 3}`;
    ws.getCell(`B${i}`).value = (i - 3) * 100;
  }

  // Page setup
  ws.pageSetup.orientation = 'landscape';
  ws.pageSetup.paperSize = 9; // A4
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.scale = 75;

  // Margins (in inches)
  ws.pageMargins = {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 0.75,
    header: 0.3,
    footer: 0.3,
  };

  await wb.xlsx.writeFile(fixturePath('page-setup.xlsx'));

  // Now inject print area and print titles via raw XML
  const buf = fs.readFileSync(fixturePath('page-setup.xlsx'));
  const zip = await JSZip.loadAsync(buf);

  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  const definedNames = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Print!$A$1:$B$20</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">Print!$1:$3</definedName></definedNames>`;
  const updatedWb = wbXml.replace('</workbook>', `${definedNames}</workbook>`);
  zip.file('xl/workbook.xml', updatedWb);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixturePath('page-setup.xlsx'), outBuf);
}

// ---- 23. Array Formula ---------------------------------------------------

async function arrayFormula(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Array');

  // Input data
  ws.getCell('A1').value = 'X';
  ws.getCell('B1').value = 'Y';
  ws.getCell('A2').value = 10;
  ws.getCell('B2').value = 20;
  ws.getCell('A3').value = 30;
  ws.getCell('B3').value = 40;
  ws.getCell('A4').value = 50;
  ws.getCell('B4').value = 60;

  // C2 will be the array formula master cell: SUM(A2:A4*B2:B4)
  ws.getCell('C1').value = 'Product Sum';
  ws.getCell('C2').value = 7800; // cached result

  const buf = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Inject array formula into sheet XML
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  // Replace the existing C2 cell with an array formula cell
  const updatedSheet = sheetXml.replace(
    '<c r="C2"><v>7800</v></c>',
    '<c r="C2"><f t="array" ref="C2">SUM(A2:A4*B2:B4)</f><v>7800</v></c>',
  );
  zip.file('xl/worksheets/sheet1.xml', updatedSheet);

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixturePath('array-formula.xlsx'), outBuf);
}
