import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, '..', 'package.json');
const bakPath = `${pkgPath}.bak`;
if (fs.existsSync(bakPath)) {
  fs.copyFileSync(bakPath, pkgPath);
  fs.unlinkSync(bakPath);
  console.log('postpack: restored package.json');
}
