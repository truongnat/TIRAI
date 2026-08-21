// ---------------------------------------------------------------------------
// Loader tests – Context Package loading and validation
// ---------------------------------------------------------------------------
// Spec coverage: scenarios 1-4

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadContextPackage } from '../src/persistence/loader.js';
import { VALID_CONTEXT_DIR } from './fixtures/helpers.js';

describe('loadContextPackage', () => {
  // Scenario 1: load valid context package
  it('loads a valid context package with manifest and all chunks', () => {
    const loaded = loadContextPackage(VALID_CONTEXT_DIR);

    expect(loaded.manifest).toBeDefined();
    expect(loaded.manifest.schemaVersion).toBe('1.0');
    expect(loaded.manifest.sheets).toHaveLength(2);
    expect(loaded.chunks).toHaveLength(2);
    expect(loaded.contextDir).toBe(path.resolve(VALID_CONTEXT_DIR));

    // Verify chunk contents
    const ids = loaded.chunks.map((c) => c.id);
    expect(ids).toContain('ctx-test-000');
    expect(ids).toContain('ctx-test-001');

    // Each chunk must have non-empty content and valid sheet reference
    for (const chunk of loaded.chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.sheet.name).toBeTruthy();
    }
  });

  // Scenario 2: missing manifest
  it('throws INPUT_NOT_FOUND when manifest.json is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-test-'));
    try {
      expect(() => loadContextPackage(tmpDir)).toThrowError(/manifest\.json not found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Scenario 3: missing chunk file
  it('throws INPUT_NOT_FOUND when a referenced chunk file is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-test-'));
    try {
      // Write a manifest that references a non-existent chunk
      const manifest = {
        schemaVersion: '1.0',
        source: { file: 'test.xlsx', sizeBytes: 100 },
        stats: { sheets: 1, chunks: 1, characters: 10, estimatedTokens: 5 },
        sheets: [{ index: 0, name: 'Sheet1', dimension: 'A1:B2', chunks: ['ctx-missing'] }],
        warnings: [],
      };
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest));
      fs.mkdirSync(path.join(tmpDir, 'chunks'));

      expect(() => loadContextPackage(tmpDir)).toThrowError(/Chunk file not found/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Scenario 4: invalid context schema (missing schemaVersion)
  it('throws INVALID_CONTEXT when manifest has no schemaVersion', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-test-'));
    try {
      const badManifest = {
        source: { file: 'test.xlsx', sizeBytes: 100 },
        sheets: [{ index: 0, name: 'Sheet1', chunks: ['ctx-000'] }],
      };
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(badManifest));

      expect(() => loadContextPackage(tmpDir)).toThrowError(/schemaVersion/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws INPUT_NOT_FOUND when directory does not exist', () => {
    expect(() => loadContextPackage('/nonexistent/path/to/context')).toThrow();
  });

  it('throws INVALID_CONTEXT when manifest has no sheets', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-test-'));
    try {
      const manifest = {
        schemaVersion: '1.0',
        source: { file: 'test.xlsx', sizeBytes: 100 },
        sheets: [],
      };
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest));

      expect(() => loadContextPackage(tmpDir)).toThrowError(/no sheets/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws INVALID_CONTEXT when chunk has empty content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-test-'));
    try {
      const manifest = {
        schemaVersion: '1.0',
        source: { file: 'test.xlsx', sizeBytes: 100 },
        stats: { sheets: 1, chunks: 1, characters: 0, estimatedTokens: 0 },
        sheets: [{ index: 0, name: 'Sheet1', dimension: null, chunks: ['ctx-empty'] }],
        warnings: [],
      };
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest));

      const chunksDir = path.join(tmpDir, 'chunks');
      fs.mkdirSync(chunksDir);
      const chunk = {
        schemaVersion: '1.0',
        id: 'ctx-empty',
        type: 'tabular',
        sheet: { index: 0, name: 'Sheet1' },
        content: '',
        provenance: { sheetIndex: 0, sheetName: 'Sheet1', ranges: [] },
      };
      fs.writeFileSync(path.join(chunksDir, 'ctx-empty.json'), JSON.stringify(chunk));

      expect(() => loadContextPackage(tmpDir)).toThrowError(/empty or invalid content/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
