// Deterministic local test app (spec §5.4 §7).
//
// No public internet, no external API, no real DB, no auth, no secrets.
// Serves a minimal order-validation UI and a /validate endpoint that applies
// the SAME rule as `order-validation.ts`. The E2E UI calls /validate and
// renders the returned status into a result element (identified by a
// data-testid locator so the trusted ExecutionMappingIR can drive it).
//
// Set INVERT=1 to run an intentionally WRONG local behavior (used only by the
// deterministic negative-business-proof run, spec §23).

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const INVERT = process.env.INVERT === '1';

function rule(quantity, availableStock) {
  const rejected = quantity > availableStock;
  const honest = rejected ? 'INSUFFICIENT_STOCK' : 'ACCEPTED';
  return INVERT ? (honest === 'INSUFFICIENT_STOCK' ? 'ACCEPTED' : 'INSUFFICIENT_STOCK') : honest;
}

const html = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname === '/validate') {
    const quantity = Number(url.searchParams.get('quantity'));
    const availableStock = Number(url.searchParams.get('availableStock'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: rule(quantity, availableStock) }));
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});

server.listen(PORT, () => {
  console.log('READY');
});
