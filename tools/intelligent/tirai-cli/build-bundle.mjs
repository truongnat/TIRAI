import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
  external: [
    // Node built-ins
    'node:fs', 'node:path', 'node:crypto', 'node:stream', 'node:zlib', 'node:http', 'node:https', 'node:util', 'node:events', 'node:buffer', 'node:url', 'node:querystring', 'node:os', 'node:child_process', 'node:worker_threads',
    'fs', 'path', 'crypto', 'stream', 'zlib', 'http', 'https', 'util', 'events', 'buffer', 'url', 'querystring', 'os', 'child_process', 'worker_threads',
    // Externalize npm deps that are problematic to bundle (dynamic requires) or large
    'groq-sdk', 'node-fetch', 'ajv', 'exceljs', 'jszip', '@google/generative-ai', 'prettier', 'typescript',
  ],
  sourcemap: false,
  logLevel: 'info',
});

 // Copy pdf.worker.mjs for pdfjs-dist (needed for PDF parsing in bundled CLI)
 import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
 const __dirname = path.dirname(fileURLToPath(import.meta.url));
 const workerSrc = path.resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 const workerDest = path.resolve(__dirname, 'dist/pdf.worker.mjs');
 // Try root node_modules, then package's own
 let src = workerSrc;
 if (!fs.existsSync(src)) {
   src = path.resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 }
 if (!fs.existsSync(src)) {
   src = path.resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 }
 if (fs.existsSync(src)) {
   fs.copyFileSync(src, workerDest);
   console.log(`Copied pdf.worker.mjs (${(fs.statSync(src).size/1024/1024).toFixed(1)}MB)`);
 } else {
   console.warn('pdf.worker.mjs not found, PDF parsing may fail in bundled CLI');
 }

console.log('Bundled dist/cli.js');
