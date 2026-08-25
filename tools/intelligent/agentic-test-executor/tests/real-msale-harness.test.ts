// Acceptance-harness-only locator regression.
// This file intentionally does not feed selectors into AgenticTestExecutor.

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

describe('real-app acceptance harness login targeting', () => {
  let server: Server;
  let browser: Browser;
  let origin: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<button>ĐĂNG NHẬP</button><button>ĐĂNG NHẬP SSO</button>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not start');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  });

  it('uses exact accessible semantics and does not use positional selection', async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/`);

    const normalLogin = page.getByRole('button', { name: 'ĐĂNG NHẬP', exact: true });
    expect(await normalLogin.count()).toBe(1);
    expect(await page.getByRole('button', { name: 'ĐĂNG NHẬP SSO', exact: true }).count()).toBe(1);

    await normalLogin.click();
    await page.close();
  });
});
