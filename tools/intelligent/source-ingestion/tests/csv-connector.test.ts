import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CsvSourceConnector } from '../src/csv-connector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures/csv');

describe('CsvSourceConnector', () => {
  it('canOpen true for .csv', () => {
    const c = new CsvSourceConnector();
    expect(c.canOpen({ kind: 'csv', path: 'a.csv' })).toBe(true);
    expect(c.canOpen({ path: 'a.csv' } as any)).toBe(true);
  });

  it('canOpen false for others', () => {
    const c = new CsvSourceConnector();
    expect(c.canOpen({ path: 'a.pdf' } as any)).toBe(false);
    expect(c.canOpen({ path: 'a.xlsx' } as any)).toBe(false);
  });

  it('open simple CSV', async () => {
    const c = new CsvSourceConnector();
    const doc = await c.open({ kind: 'csv', path: path.join(fixturesDir, 'simple.csv') });
    expect(doc.contexts.length).toBe(3); // header + 2 rows
    expect(doc.contexts[0]!.content).toContain('quantity');
    expect(doc.artifacts.filter(a => a.kind === 'row').length).toBe(3);
  });

  it('open empty CSV throws', async () => {
    const c = new CsvSourceConnector();
    await expect(c.open({ kind: 'csv', path: path.join(fixturesDir, 'empty.csv') })).rejects.toThrow();
  });

  it('stableId deterministic', async () => {
    const c = new CsvSourceConnector();
    const doc1 = await c.open({ kind: 'csv', path: path.join(fixturesDir, 'simple.csv') });
    const doc2 = await c.open({ kind: 'csv', path: path.join(fixturesDir, 'simple.csv') });
    expect(doc1.source.id).toBe(doc2.source.id);
  });
});
