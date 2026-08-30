import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Backup original
fs.writeFileSync(`${pkgPath}.bak`, JSON.stringify(pkg, null, 2));

// Remove file: dependencies for publishing - they are bundled
const deps = pkg.dependencies || {};
const filtered = {};
for (const [k, v] of Object.entries(deps)) {
  if (!String(v).startsWith('file:')) {
    filtered[k] = v;
  }
}
pkg.dependencies = filtered;

// Also ensure files only includes dist and README
pkg.files = ['dist', 'README.md'];

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log('prepack: filtered file: dependencies, kept', Object.keys(filtered));
