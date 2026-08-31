import { describe, it, expect } from 'vitest';
import { createDefaultSourceConnectorRegistry } from '../src/index.js';

describe('PdfSourceConnector registry', () => {
  it('resolves PDF to PdfConnector', async () => {
    const reg = createDefaultSourceConnectorRegistry();
    const conn = await reg.resolve({ kind: 'pdf', path: 'a.pdf' } as any);
    expect(conn.id).toBe('local-pdf-connector');
    expect(conn.kind).toBe('pdf');
  });

  it('does not resolve PDF as Excel', async () => {
    const reg = createDefaultSourceConnectorRegistry();
    await expect(async () => await reg.resolve({ kind: 'excel', path: 'a.pdf' } as any)).rejects.toThrow();
  });

  it('tirai ingest via pipeline with PDF', async () => {
    // This is a lightweight check that the registry can open a PDF
    const reg = createDefaultSourceConnectorRegistry();
    const conn = await reg.resolve({ kind: 'pdf', path: 'tests/fixtures/pdf/simple-1page.pdf' } as any);
    const doc = await conn.open({ kind: 'pdf', path: 'tests/fixtures/pdf/simple-1page.pdf' } as any);
    expect(doc.contexts.length).toBeGreaterThan(0);
    expect(doc.source.connectorId).toBe('local-pdf-connector');
  });
});
