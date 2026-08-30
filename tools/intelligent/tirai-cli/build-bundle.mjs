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

console.log('Bundled dist/cli.js');
