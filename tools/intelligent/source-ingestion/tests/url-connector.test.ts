import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { UrlSourceConnector } from '../src/url-connector.js';

describe('UrlSourceConnector', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/spec') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body>
            <h1>Order Validation</h1>
            <p>If quantity > availableStock then INSUFFICIENT_STOCK</p>
          </body></html>
        `);
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    await new Promise<void>(resolve => server.listen(0, () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://localhost:${addr.port}/spec`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('canOpen true for http/https URL', () => {
    const c = new UrlSourceConnector();
    expect(c.canOpen({ kind: 'url', path: 'http://example.com/spec' })).toBe(true);
    expect(c.canOpen({ kind: 'url', path: 'https://example.com/spec' })).toBe(true);
    expect(c.canOpen({ path: 'http://example.com/spec' } as any)).toBe(true);
  });

  it('canOpen false for others', () => {
    const c = new UrlSourceConnector();
    expect(c.canOpen({ kind: 'url', path: 'a.pdf' })).toBe(false);
    expect(c.canOpen({ path: 'a.pdf' } as any)).toBe(false);
    expect(c.canOpen({ kind: 'excel', path: baseUrl } as any)).toBe(false);
  });

  it('open URL', async () => {
    const c = new UrlSourceConnector();
    const doc = await c.open({ kind: 'url', path: baseUrl });
    expect(doc.contexts.length).toBeGreaterThan(0);
    expect(doc.contexts[0]!.content).toContain('Order Validation');
    expect(doc.source.connectorId).toBe('local-url-connector');
    expect(doc.artifacts.filter(a => a.kind === 'document').length).toBe(1);
  });

  it('open invalid URL throws', async () => {
    const c = new UrlSourceConnector();
    await expect(c.open({ kind: 'url', path: 'http://localhost:1/notfound' })).rejects.toThrow();
  });
});
