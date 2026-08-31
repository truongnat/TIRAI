import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createPdf(filePath, texts) {
  const doc = await PDFDocument.create();
  for (const text of texts) {
    const page = doc.addPage([600, 400]);
    page.drawText(text, { x: 50, y: 300, size: 12, color: rgb(0, 0, 0) });
  }
  const bytes = await doc.save();
  fs.writeFileSync(filePath, bytes);
  console.log(`Created ${filePath} (${bytes.length} bytes)`);
}

await createPdf(path.join(__dirname, 'simple-1page.pdf'), ['Order Validation\nIf quantity > availableStock then INSUFFICIENT_STOCK']);
await createPdf(path.join(__dirname, 'multi-2page.pdf'), ['Page 1: Order', 'Page 2: Payment']);
await createPdf(path.join(__dirname, 'empty.pdf'), ['']);
fs.writeFileSync(path.join(__dirname, 'corrupt.pdf'), Buffer.from('not a pdf file content random bytes 12345'));
console.log('Done');
