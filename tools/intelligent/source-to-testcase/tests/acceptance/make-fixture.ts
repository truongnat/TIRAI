import * as ExcelJS from 'exceljs';

// Author REAL .xlsx fixtures (not hardcoded JSON) so the acceptance proves
// genuine Excel ingestion through the connector registry.

/** Generic spec workbook: prose rule text. The pipeline ingests it into
 *  context artifacts but stops at 'awaiting-agent' (no business-flow table). */
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

/** Structured detailed-design workbook: a business-flow table plus an entity
 *  sheet. `compileStructuredDesignDocument` compiles it deterministically —
 *  no agent artifacts required. */
export async function writeStructuredDesignWorkbook(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();

  const flow = wb.addWorksheet('Business Flow');
  flow.getRow(1).values = [
    'STT', 'Mã xử lý', 'Tên xử lý', 'Mô tả xử lý', 'Đầu vào', 'Đầu ra', 'API liên quan', 'Điều kiện rẽ nhánh', 'Ghi chú',
  ];
  flow.getRow(2).values = [
    1, 'BF-005', 'Kiểm tra tiêu đề todo', 'Validate the todo title before submit', 'title', 'Title is required',
    '-', 'title is empty', '-',
  ];
  flow.getRow(3).values = [
    2, 'BF-100', 'Xem danh sách todo', 'Render the todo list page', '-', 'Todo list rendered', '-', '-', '-',
  ];
  await Promise.all(
    [flow.getColumn(1), flow.getColumn(2), flow.getColumn(3), flow.getColumn(4), flow.getColumn(5),
     flow.getColumn(6), flow.getColumn(7), flow.getColumn(8), flow.getColumn(9)]
      .map(async (column, index) => { column.width = [4, 10, 24, 40, 16, 24, 16, 20, 12][index]; }),
  );

  const entity = wb.addWorksheet('Entity Definition');
  entity.getRow(1).values = ['STT', 'Entity', 'Attribute', 'Data Type'];
  entity.getRow(2).values = [1, 'Todo', 'title', 'string'];
  entity.getRow(3).values = [2, 'Todo', 'completed', 'boolean'];

  await wb.xlsx.writeFile(filePath);
}
