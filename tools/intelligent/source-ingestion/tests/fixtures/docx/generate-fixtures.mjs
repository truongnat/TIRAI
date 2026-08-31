import { Document, Packer, Paragraph, TextRun } from 'docx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createDocx(filePath, texts) {
  const doc = new Document({
    sections: [{ children: texts.map(text => new Paragraph({ children: [new TextRun(text)] })) }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  console.log(`Created ${filePath} (${buffer.length} bytes)`);
}

await createDocx(path.join(__dirname, 'simple-1para.docx'), ['Order Validation If quantity > availableStock then INSUFFICIENT_STOCK']);
await createDocx(path.join(__dirname, 'multi-3para.docx'), ['Paragraph 1: Order', 'Paragraph 2: Payment', 'Paragraph 3: Shipping']);
await createDocx(path.join(__dirname, 'empty.docx'), ['']);
fs.writeFileSync(path.join(__dirname, 'corrupt.docx'), Buffer.from('not a docx file content random bytes 12345'));
console.log('Done');
