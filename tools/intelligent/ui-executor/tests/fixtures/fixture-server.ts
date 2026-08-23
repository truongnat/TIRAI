// UI Executor v1 — Local login fixture server for real Playwright acceptance.
//
// Deterministic local web app:
// - /login: username + password form → dashboard on valid credentials
// - /dashboard: welcome page
// - Valid: demo / test-password → dashboard
// - Invalid: → error visible
// - /duplicate: page with duplicate elements for ambiguity testing
//
// All on 127.0.0.1:<ephemeral-port>. No external HTTP requests.

import { createServer, type Server } from 'node:http';

export interface FixtureServer {
  origin: string;
  port: number;
  close(): Promise<void>;
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html>
<head><title>Login</title></head>
<body>
  <h1 data-testid="page-title">Login</h1>
  <form id="login-form">
    <input data-testid="username" type="text" placeholder="Username" />
    <input data-testid="password" type="password" placeholder="Password" />
    <button data-testid="login" type="submit">Login</button>
  </form>
  <div data-testid="error" style="display:none;color:red;">Invalid credentials</div>
  <script>
    document.getElementById('login-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var u = document.querySelector('[data-testid=username]').value;
      var p = document.querySelector('[data-testid=password]').value;
      if (u === 'demo' && p === 'test-password') {
        window.location.href = '/dashboard';
      } else {
        var err = document.querySelector('[data-testid=error]');
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;

const DASHBOARD_PAGE = `<!DOCTYPE html>
<html>
<head><title>Dashboard</title></head>
<body>
  <h1 data-testid="welcome">Welcome, demo!</h1>
  <button data-testid="logout">Logout</button>
</body>
</html>`;

const DUPLICATE_PAGE = `<!DOCTYPE html>
<html>
<head><title>Duplicate Elements</title></head>
<body>
  <div data-testid="item">Item 1</div>
  <div data-testid="item">Item 2</div>
  <div data-testid="item">Item 3</div>
</body>
</html>`;

const REDIRECT_PAGE = `<!DOCTYPE html>
<html>
<head><title>Redirect</title></head>
<body>
  <script>window.location.href = 'https://evil.example.com/steal';</script>
</body>
</html>`;

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    if (path === '/login') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(LOGIN_PAGE);
    } else if (path === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_PAGE);
    } else if (path === '/duplicate') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DUPLICATE_PAGE);
    } else if (path === '/redirect-external') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(REDIRECT_PAGE);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to get server address');
  }

  const port = addr.port;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
