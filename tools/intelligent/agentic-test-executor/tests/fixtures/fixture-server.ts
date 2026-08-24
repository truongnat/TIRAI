// ---------------------------------------------------------------------------
// Acceptance test fixture server — extended login app with scenario variants
// ---------------------------------------------------------------------------

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

const AMBIGUOUS_LOGIN_PAGE = `<!DOCTYPE html>
<html>
<head><title>Login</title></head>
<body>
  <h1 data-testid="page-title">Login</h1>
  <form id="login-form">
    <input data-testid="username" type="text" placeholder="Username" />
    <input data-testid="password" type="password" placeholder="Password" />
    <button data-testid="login-primary" type="submit">Login</button>
  </form>
  <div data-testid="social">
    <button data-testid="login-google">Login with Google</button>
    <button data-testid="login-ms">Login with Microsoft</button>
  </div>
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

const NO_PASSWORD_PAGE = `<!DOCTYPE html>
<html>
<head><title>Login</title></head>
<body>
  <h1 data-testid="page-title">Login</h1>
  <form id="login-form">
    <input data-testid="username" type="text" placeholder="Username" />
    <button data-testid="login" type="submit">Login</button>
  </form>
</body>
</html>`;

const WRONG_BEHAVIOR_PAGE = `<!DOCTYPE html>
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
      window.location.href = '/dashboard';
    });
  </script>
</body>
</html>`;

const UI_CHANGED_LOGIN_PAGE = `<!DOCTYPE html>
<html>
<head><title>Sign In</title></head>
<body>
  <header><h2>Sign In to Your Account</h2></header>
  <form class="auth-form">
    <label>Email Address
      <input data-testid="email-field" type="text" />
    </label>
    <label>Secret Phrase
      <input data-testid="secret-field" type="password" />
    </label>
    <button data-testid="submit-btn" type="submit">Sign In</button>
  </form>
  <div data-testid="error-msg" style="display:none;color:red;">Wrong credentials</div>
  <script>
    document.querySelector('.auth-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var u = document.querySelector('[data-testid=email-field]').value;
      var p = document.querySelector('[data-testid=secret-field]').value;
      if (u === 'demo' && p === 'test-password') {
        window.location.href = '/dashboard';
      } else {
        var err = document.querySelector('[data-testid=error-msg]');
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    const routes: Record<string, string> = {
      '/login': LOGIN_PAGE,
      '/dashboard': DASHBOARD_PAGE,
      '/duplicate': DUPLICATE_PAGE,
      '/redirect-external': REDIRECT_PAGE,
      '/ambiguous-login': AMBIGUOUS_LOGIN_PAGE,
      '/no-password': NO_PASSWORD_PAGE,
      '/wrong-behavior': WRONG_BEHAVIOR_PAGE,
      '/ui-changed-login': UI_CHANGED_LOGIN_PAGE,
    };

    const html = routes[path];
    if (html) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
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
