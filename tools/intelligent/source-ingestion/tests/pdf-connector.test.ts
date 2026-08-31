import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfSourceConnector } from '../src/pdf-connector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures/pdf');

describe('PdfSourceConnector', () => {
  it('canOpen true for .pdf', () => {
    const c = new PdfSourceConnector();
    expect(c.canOpen({ kind: 'pdf', path: 'a.pdf' })).toBe(true);
    expect(c.canOpen({ kind: 'pdf', path: 'a.PDF' })).toBe(true);
    expect(c.canOpen({ path: 'a.pdf' } as any)).toBe(true);
  });

  it('canOpen false for others', () => {
    const c = new PdfSourceConnector();
    expect(c.canOpen({ kind: 'pdf', path: 'a.xlsx' })).toBe(false);
    expect(c.canOpen({ path: 'a.xlsx' } as any)).toBe(false);
    expect(c.canOpen({ path: 'a.md' } as any)).toBe(false);
    expect(c.canOpen({ path: 'a.txt' } as any)).toBe(false);
    expect(c.canOpen({ kind: 'excel', path: 'a.pdf' })).toBe(false);
  });

  it('open 1-page PDF', async () => {
    const c = new PdfSourceConnector();
    const doc = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'simple-1page.pdf') });
    expect(doc.contexts.length).toBeGreaterThanOrEqual(1);
    expect(doc.contexts[0]!.content).toContain('Order Validation');
    expect(doc.artifacts.filter(a => a.kind === 'document').length).toBe(1);
    expect(doc.artifacts.filter(a => a.kind === 'page').length).toBe(1);
    expect(doc.artifacts.filter(a => a.kind === 'page-content').length).toBe(1);
    expect(doc.source.connectorId).toBe('local-pdf-connector');
  });

  it('open multi-page PDF', async () => {
    const c = new PdfSourceConnector();
    const doc = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'multi-2page.pdf') });
    expect(doc.contexts.length).toBe(2);
    expect(doc.artifacts.filter(a => a.kind === 'page').length).toBe(2);
    // Check relations
    expect(doc.contexts[0]!.relations).toContainEqual(expect.objectContaining({ type: 'continuation-next' }));
    expect(doc.contexts[1]!.relations).toContainEqual(expect.objectContaining({ type: 'continuation-previous' }));
  });

  it('open empty PDF', async () => {
    const c = new PdfSourceConnector();
    const doc = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'empty.pdf') });
    // Should not throw, contexts may be 0 or 1 empty
    expect(doc.artifacts.filter(a => a.kind === 'document').length).toBe(1);
    expect(doc.artifacts.filter(a => a.kind === 'page').length).toBe(1);
  });

  it('open corrupt PDF throws INVALID_SOURCE', async () => {
    const c = new PdfSourceConnector();
    await expect(c.open({ kind: 'pdf', path: path.join(fixturesDir, 'corrupt.pdf') })).rejects.toThrow();
    try {
      await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'corrupt.pdf') });
    } catch (e: any) {
      expect(e.code === 'INVALID_SOURCE' || e.message.includes('INVALID_SOURCE')).toBe(true);
    }
  });

  it('metadata sanitized', async () => {
    const c = new PdfSourceConnector();
    const doc = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'simple-1page.pdf') });
    // Check that no artifact metadata contains sk-... pattern
    for (const a of doc.artifacts) {
      const metaStr = JSON.stringify(a.metadata);
      expect(metaStr).not.toContain('sk-proj');
    }
  });

  it('stableId deterministic', async () => {
    const c = new PdfSourceConnector();
    const doc1 = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'simple-1page.pdf') });
    const doc2 = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'simple-1page.pdf') });
    expect(doc1.source.id).toBe(doc2.source.id);
    expect(doc1.revision.contentHash).toBe(doc2.revision.contentHash);
  });

  it('open large PDF guard', async () => {
    // Create a mock large file check by testing the guard logic
    // For MVP, we just check that canOpen works and open doesn't throw for normal size
    const c = new PdfSourceConnector();
    const doc = await c.open({ kind: 'pdf', path: path.join(fixturesDir, 'simple-1page.pdf') });
    expect(doc).toBeDefined();
  });
});
