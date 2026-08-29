import * as ExcelJS from 'exceljs';

// Author a REAL .xlsx (not hardcoded JSON) encoding a business rule so the
// acceptance proves genuine Excel ingestion. The rule text is read by the
// deterministic workbook inspector and surfaced as canonical context content.

export async function writeOrderValidationWorkbook(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Order Validation');
  ws.getCell('A1').value = 'Order Validation Rule';
  ws.getCell('A2').value = 'If quantity is greater than availableStock then reject the order.';
  ws.getCell('A3').value = 'Inputs: quantity, availableStock';
  ws.getCell('A4').value = 'Expected: valid=false, reason=INSUFFICIENT_STOCK';
  ws.getCell('A5').value = 'Otherwise the order is accepted with valid=true.';
  await wb.xlsx.writeFile(filePath);
}
