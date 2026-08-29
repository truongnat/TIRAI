// Local static fixture server for Phase 5.1 acceptance (spec §25).
// Serves the fixture web app with zero external dependencies. Plain JS so it
// runs directly under `node server.mjs` from the Playwright webServer hook.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.env.FIXTURE_ROOT ?? new URL('.', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, rel === '/' || rel === '' ? 'index.html' : rel);
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const body = readFileSync(file);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(body);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`phase-5-1-fixture listening on http://localhost:${PORT}`);
});
