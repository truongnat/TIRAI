import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxSourceConnector } from '../src/docx-connector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures/docx');

describe('DocxSourceConnector', () => {
  it('canOpen true for .docx', () => {
    const c = new DocxSourceConnector();
    expect(c.canOpen({ kind: 'docx', path: 'a.docx' })).toBe(true);
    expect(c.canOpen({ kind: 'docx', path: 'a.DOCX' })).toBe(true);
    expect(c.canOpen({ path: 'a.docx' } as any)).toBe(true);
  });

  it('canOpen false for others', () => {
    const c = new DocxSourceConnector();
    expect(c.canOpen({ kind: 'docx', path: 'a.pdf' })).toBe(false);
    expect(c.canOpen({ path: 'a.pdf' } as any)).toBe(false);
    expect(c.canOpen({ path: 'a.xlsx' } as any)).toBe(false);
    expect(c.canOpen({ kind: 'excel', path: 'a.docx' })).toBe(false);
  });

  it('open 1-para DOCX', async () => {
    const c = new DocxSourceConnector();
    const doc = await c.open({ kind: 'docx', path: path.join(fixturesDir, 'simple-1para.docx') });
    expect(doc.contexts.length).toBeGreaterThanOrEqual(1);
    expect(doc.contexts[0]!.content).toContain('Order Validation');
    expect(doc.artifacts.filter(a => a.kind === 'document').length).toBe(1);
    expect(doc.artifacts.filter(a => a.kind === 'paragraph').length).toBeGreaterThanOrEqual(1);
    expect(doc.source.connectorId).toBe('local-docx-connector');
  });

  it('open multi-para DOCX', async () => {
    const c = new DocxSourceConnector();
    const doc = await c.open({ kind: 'docx', path: path.join(fixturesDir, 'multi-3para.docx') });
    expect(doc.contexts.length).toBe(3);
    expect(doc.artifacts.filter(a => a.kind === 'paragraph').length).toBe(3);
    expect(doc.contexts[0]!.relations).toContainEqual(expect.objectContaining({ type: 'continuation-next' }));
  });

  it('open empty DOCX', async () => {
    const c = new DocxSourceConnector();
    const doc = await c.open({ kind: 'docx', path: path.join(fixturesDir, 'empty.docx') });
    expect(doc.artifacts.filter(a => a.kind === 'document').length).toBe(1);
  });

  it('open corrupt DOCX throws INVALID_SOURCE', async () => {
    const c = new DocxSourceConnector();
    await expect(c.open({ kind: 'docx', path: path.join(fixturesDir, 'corrupt.docx') })).rejects.toThrow();
  });

  it('stableId deterministic', async () => {
    const c = new DocxSourceConnector();
    const doc1 = await c.open({ kind: 'docx', path: path.join(fixturesDir, 'simple-1para.docx') });
    const doc2 = await c.open({ kind: 'docx', path: path.join(fixturesDir, 'simple-1para.docx') });
    expect(doc1.source.id).toBe(doc2.source.id);
    expect(doc1.revision.contentHash).toBe(doc2.revision.contentHash);
  });
});
