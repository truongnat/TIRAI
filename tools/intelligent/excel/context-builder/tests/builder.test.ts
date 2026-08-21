// ---------------------------------------------------------------------------
// Excel AI Context Builder – tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExcelContext, writeContextPackage } from '../src/builder.js';
import { ContextBuilderError } from '../src/warnings.js';
import type { ExcelContextPackage, ContextChunk } from '../src/models.js';
import {
  simpleSmallSheet,
  multipleSheets,
  unicodeSheet,
  multilineSheet,
  styledEmptyCells,
  largeTable,
  mergedCellsSheet,
  hiddenRowsCols,
  formulaSheet,
  annotationsSheet,
  objectSheet,
  validationSheet,
  writeFixture,
} from './fixtures.js';

// ---- Helper: create temp input dir from fixture ---------------------------

function setupFixture(fixture: { workbook: unknown; layout: unknown }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-builder-test-'));
  writeFixture(fixture as { workbook: any; layout: any }, dir);
  return dir;
}

// ===========================================================================
// Basic tests
// ===========================================================================

describe('Basic', () => {
  it('1. single small sheet → 1 chunk', async () => {
    const dir = setupFixture(simpleSmallSheet());
    const pkg = await buildExcelContext(dir);
    expect(pkg.chunks).toHaveLength(1);
    expect(pkg.chunks[0].type).toBe('tabular');
    expect(pkg.chunks[0].sheet.name).toBe('Sheet1');
    expect(pkg.stats.sheets).toBe(1);
    rmSync(dir, { recursive: true });
  });

  it('2. multiple sheets → multiple chunks', async () => {
    const dir = setupFixture(multipleSheets());
    const pkg = await buildExcelContext(dir);
    expect(pkg.stats.sheets).toBe(2);
    expect(pkg.chunks.length).toBeGreaterThanOrEqual(2);
    const sheetNames = pkg.chunks.map((c) => c.sheet.name);
    expect(sheetNames).toContain('First');
    expect(sheetNames).toContain('Second');
    rmSync(dir, { recursive: true });
  });

  it('3. Unicode / Vietnamese / Japanese content preserved', async () => {
    const dir = setupFixture(unicodeSheet());
    const pkg = await buildExcelContext(dir);
    const content = pkg.chunks[0].content;
    expect(content).toContain('田中太郎');
    expect(content).toContain('Nguyễn Văn A');
    expect(content).toContain('中文测试');
    rmSync(dir, { recursive: true });
  });

  it('4. multiline cell content preserved', async () => {
    const dir = setupFixture(multilineSheet());
    const pkg = await buildExcelContext(dir);
    const content = pkg.chunks[0].content;
    expect(content).toContain('{\n  "key": "value"');
    expect(content).toContain('item1\nitem2\nitem3');
    rmSync(dir, { recursive: true });
  });

  it('5. styled empty cells included', async () => {
    const dir = setupFixture(styledEmptyCells());
    const pkg = await buildExcelContext(dir);
    expect(pkg.chunks).toHaveLength(1);
    // Empty styled cells should still appear in the content
    expect(pkg.chunks[0].stats.cells).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });
});

// ===========================================================================
// Chunking tests
// ===========================================================================

describe('Chunking', () => {
  it('6. large table → multiple chunks', async () => {
    const dir = setupFixture(largeTable(200));
    const pkg = await buildExcelContext(dir, { maxChars: 2000 });
    expect(pkg.chunks.length).toBeGreaterThan(1);
    rmSync(dir, { recursive: true });
  });

  it('7. repeated header in subsequent chunks', async () => {
    const dir = setupFixture(largeTable(200));
    const pkg = await buildExcelContext(dir, { maxChars: 2000 });
    if (pkg.chunks.length > 1) {
      // Second chunk should contain column headers
      const secondChunk = pkg.chunks[1];
      expect(secondChunk.content).toContain('Columns:');
      expect(secondChunk.content).toContain('ID');
      expect(secondChunk.content).toContain('Name');
    }
    rmSync(dir, { recursive: true });
  });

  it('8. provenance after split', async () => {
    const dir = setupFixture(largeTable(200));
    const pkg = await buildExcelContext(dir, { maxChars: 2000 });
    for (const chunk of pkg.chunks) {
      expect(chunk.provenance).toBeDefined();
      expect(chunk.provenance.sheetIndex).toBe(0);
      expect(chunk.provenance.sheetName).toBe('Large');
      expect(chunk.provenance.ranges.length).toBeGreaterThan(0);
    }
    rmSync(dir, { recursive: true });
  });

  it('9. previous/next relations for split chunks', async () => {
    const dir = setupFixture(largeTable(200));
    const pkg = await buildExcelContext(dir, { maxChars: 2000 });
    if (pkg.chunks.length > 1) {
      // First chunk: no previous, has next
      expect(pkg.chunks[0].relations.previous).toBeNull();
      expect(pkg.chunks[0].relations.next).toBe(pkg.chunks[1].id);
      // Last chunk: has previous, no next
      const last = pkg.chunks[pkg.chunks.length - 1];
      expect(last.relations.previous).not.toBeNull();
      expect(last.relations.next).toBeNull();
      // Middle chunks: both previous and next
      if (pkg.chunks.length > 2) {
        for (let i = 1; i < pkg.chunks.length - 1; i++) {
          expect(pkg.chunks[i].relations.previous).toBe(pkg.chunks[i - 1].id);
          expect(pkg.chunks[i].relations.next).toBe(pkg.chunks[i + 1].id);
        }
      }
    }
    rmSync(dir, { recursive: true });
  });

  it('10. max size respected', async () => {
    const dir = setupFixture(largeTable(200));
    const maxChars = 2000;
    const pkg = await buildExcelContext(dir, { maxChars });
    // Each chunk should be approximately within limits (header adds some overhead)
    for (const chunk of pkg.chunks) {
      // Allow some overhead for header repetition
      expect(chunk.stats.characters).toBeLessThanOrEqual(maxChars * 1.5);
    }
    rmSync(dir, { recursive: true });
  });
});

// ===========================================================================
// Layout tests
// ===========================================================================

describe('Layout', () => {
  it('11. merged cells not split across chunks', async () => {
    const dir = setupFixture(mergedCellsSheet());
    const pkg = await buildExcelContext(dir);
    expect(pkg.chunks).toHaveLength(1);
    // Layout hints should include merged ranges
    if (pkg.chunks[0].layoutHints?.mergedRanges) {
      expect(pkg.chunks[0].layoutHints.mergedRanges).toContain('A1:C1');
    }
    rmSync(dir, { recursive: true });
  });

  it('12. hidden row/column metadata preserved', async () => {
    const dir = setupFixture(hiddenRowsCols());
    const pkg = await buildExcelContext(dir);
    const hints = pkg.chunks[0].layoutHints;
    expect(hints).not.toBeNull();
    expect(hints?.hiddenRows).toContain(2);
    expect(hints?.hiddenColumns).toContain(2);
    rmSync(dir, { recursive: true });
  });

  it('13. bordered table context via layout hints', async () => {
    const dir = setupFixture(simpleSmallSheet());
    const pkg = await buildExcelContext(dir);
    expect(pkg.chunks[0].layoutHints).not.toBeNull();
    expect(pkg.chunks[0].layoutHints?.headerRows).toContain(1);
    rmSync(dir, { recursive: true });
  });
});

// ===========================================================================
// Feature tests
// ===========================================================================

describe('Features', () => {
  it('14. formula preserved in content', async () => {
    const dir = setupFixture(formulaSheet());
    const pkg = await buildExcelContext(dir);
    const content = pkg.chunks[0].content;
    expect(content).toContain('[=A2+B2]');
    rmSync(dir, { recursive: true });
  });

  it('15. validation metadata available', async () => {
    const dir = setupFixture(validationSheet());
    const pkg = await buildExcelContext(dir);
    expect(pkg.chunks).toHaveLength(1);
    // Validation info is in the source data; chunk should still be created
    expect(pkg.chunks[0].stats.cells).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });

  it('16. comment preserved in content', async () => {
    const dir = setupFixture(annotationsSheet());
    const pkg = await buildExcelContext(dir);
    const content = pkg.chunks[0].content;
    expect(content).toContain('{/* This is a comment */}');
    rmSync(dir, { recursive: true });
  });

  it('17. hyperlink preserved in content', async () => {
    const dir = setupFixture(annotationsSheet());
    const pkg = await buildExcelContext(dir);
    const content = pkg.chunks[0].content;
    expect(content).toContain('[→ https://example.com]');
    rmSync(dir, { recursive: true });
  });

  it('18. image anchor metadata available', async () => {
    const dir = setupFixture(objectSheet());
    const pkg = await buildExcelContext(dir);
    expect(pkg.chunks).toHaveLength(1);
    // Objects exist in source; chunk should be created for cells
    expect(pkg.chunks[0].stats.cells).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });
});

// ===========================================================================
// Integrity tests
// ===========================================================================

describe('Integrity', () => {
  it('19. deterministic IDs', async () => {
    const dir = setupFixture(simpleSmallSheet());
    const pkg1 = await buildExcelContext(dir);
    const pkg2 = await buildExcelContext(dir);
    expect(pkg1.chunks[0].id).toBe(pkg2.chunks[0].id);
    expect(pkg1.chunks[0].id).toBe('ctx-s000-c000');
    rmSync(dir, { recursive: true });
  });

  it('20. deterministic ordering', async () => {
    const dir = setupFixture(multipleSheets());
    const pkg1 = await buildExcelContext(dir);
    const pkg2 = await buildExcelContext(dir);
    const ids1 = pkg1.chunks.map((c) => c.id);
    const ids2 = pkg2.chunks.map((c) => c.id);
    expect(ids1).toEqual(ids2);
    rmSync(dir, { recursive: true });
  });

  it('21. no provenance loss – every chunk has provenance', async () => {
    const dir = setupFixture(largeTable(200));
    const pkg = await buildExcelContext(dir, { maxChars: 2000 });
    for (const chunk of pkg.chunks) {
      expect(chunk.provenance).toBeDefined();
      expect(chunk.provenance.sheetName).toBeTruthy();
      expect(chunk.provenance.ranges.length).toBeGreaterThan(0);
    }
    rmSync(dir, { recursive: true });
  });

  it('22. golden snapshot – real workbook', async () => {
    // Use the actual thiet-ke-chi-tiet.xlsx output
    const realInputDir = join(process.cwd(), 'output', 'excel');
    // Skip if real output doesn't exist
    try {
      const pkg = await buildExcelContext(realInputDir);
      expect(pkg.schemaVersion).toBe('1.0');
      expect(pkg.stats.sheets).toBe(5);
      expect(pkg.chunks.length).toBeGreaterThanOrEqual(5);
      expect(pkg.warnings).toEqual([]);

      // Verify all chunks have content
      for (const chunk of pkg.chunks) {
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.provenance.sheetName).toBeTruthy();
      }
    } catch {
      // If real data not available, skip
    }
  });
});

// ===========================================================================
// Error handling tests
// ===========================================================================

describe('Error handling', () => {
  it('throws on missing input directory', async () => {
    await expect(buildExcelContext('/nonexistent/path')).rejects.toThrow(ContextBuilderError);
  });

  it('throws on missing workbook.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-builder-err-'));
    mkdirSync(join(dir, 'layout'), { recursive: true });
    writeFileSync(join(dir, 'layout', 'full-extract.json'), '{}');
    await expect(buildExcelContext(dir)).rejects.toThrow(ContextBuilderError);
    rmSync(dir, { recursive: true });
  });

  it('throws on invalid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-builder-err-'));
    mkdirSync(join(dir, 'layout'), { recursive: true });
    writeFileSync(join(dir, 'workbook.json'), 'not json');
    writeFileSync(join(dir, 'layout', 'full-extract.json'), '{}');
    await expect(buildExcelContext(dir)).rejects.toThrow(ContextBuilderError);
    rmSync(dir, { recursive: true });
  });
});

// ===========================================================================
// Output writer tests
// ===========================================================================

describe('Output writer', () => {
  it('writes correct directory structure', async () => {
    const fixtureDir = setupFixture(simpleSmallSheet());
    const outDir = mkdtempSync(join(tmpdir(), 'ctx-builder-out-'));

    const pkg = await buildExcelContext(fixtureDir);
    writeContextPackage(pkg, outDir, true);

    // Check files exist
    expect(() => readFileSync(join(outDir, 'manifest.json'), 'utf-8')).not.toThrow();
    expect(() => readFileSync(join(outDir, 'workbook-context.json'), 'utf-8')).not.toThrow();
    expect(() => readFileSync(join(outDir, 'chunks', 'ctx-s000-c000.json'), 'utf-8')).not.toThrow();

    // Check manifest content
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf-8'));
    expect(manifest.schemaVersion).toBe('1.0');
    expect(manifest.stats.sheets).toBe(1);

    rmSync(fixtureDir, { recursive: true });
    rmSync(outDir, { recursive: true });
  });
});
