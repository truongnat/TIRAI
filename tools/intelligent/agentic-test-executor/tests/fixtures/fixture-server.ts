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

const JOURNEY_HOME_PAGE = `<!DOCTYPE html>
<html><head><title>Workspace</title></head><body>
  <h1>Workspace</h1>
  <p>Choose a catalog task.</p>
  <a href="/journey-catalog">Open catalog</a>
</body></html>`;

const JOURNEY_DETOUR_PAGE = `<!DOCTYPE html>
<html><head><title>Notice</title></head><body>
  <h1>Notice</h1>
  <p>A notice must be acknowledged before continuing.</p>
  <a href="/journey-catalog">Continue to catalog</a>
</body></html>`;

const JOURNEY_CATALOG_PAGE = `<!DOCTYPE html>
<html><head><title>Catalog</title></head><body>
  <h1>Catalog</h1>
  <p>One item is available for completion.</p>
  <a href="/journey-detail">Open item</a>
</body></html>`;

const JOURNEY_HOME_CHANGED_PAGE = `<!DOCTYPE html>
<html><head><title>Workspace</title></head><body>
  <h1>Workspace</h1><p>Choose a catalog task.</p>
  <a href="/journey-catalog-changed">Browse inventory</a>
</body></html>`;

const JOURNEY_CATALOG_CHANGED_PAGE = `<!DOCTYPE html>
<html><head><title>Catalog</title></head><body>
  <h1>Catalog</h1><p>The item layout has changed.</p>
  <a href="/journey-detail">Browse item</a>
</body></html>`;

const JOURNEY_DETAIL_PAGE = `<!DOCTYPE html>
<html><head><title>Item detail</title></head><body>
  <h1>Item detail</h1>
  <p>Item status: Pending</p>
  <button id="complete-item" type="button">Complete item</button>
  <div role="status" id="completion" style="display:none">Item status: Completed</div>
  <script>
    document.getElementById('complete-item').addEventListener('click', function() {
      this.disabled = true;
      document.querySelector('#completion').style.display = 'block';
    });
  </script>
</body></html>`;

const JOURNEY_MODAL_PAGE = `<!DOCTYPE html>
<html><head><title>Item detail</title></head><body>
  <h1>Item detail</h1>
  <button id="open-confirm" type="button">Complete item</button>
  <div role="dialog" aria-label="Confirm completion" style="display:none">
    <p>Confirm completion?</p><button id="confirm" type="button">Confirm</button>
  </div>
  <div role="status" id="modal-completed" style="display:none">Item status: Completed</div>
  <script>
    document.getElementById('open-confirm').addEventListener('click', function() {
      this.style.display = 'none';
      document.querySelector('[role=dialog]').style.display = 'block';
    });
    document.getElementById('confirm').addEventListener('click', function() {
      document.querySelector('[role=dialog]').style.display = 'none';
      document.querySelector('#modal-completed').style.display = 'block';
    });
  </script>
</body></html>`;

const JOURNEY_LOADING_PAGE = `<!DOCTYPE html>
<html><head><title>Loading</title></head><body>
  <h1>Loading</h1><p>Please wait</p><div id="loading">Loading...</div>
  <script>
    setTimeout(function() {
      document.body.innerHTML = '<h1>Catalog</h1><a href="/journey-detail">Open item</a>';
      document.title = 'Catalog';
    }, 120);
  </script>
</body></html>`;

const JOURNEY_LOOP_A_PAGE = `<!DOCTYPE html>
<html><head><title>Loop A</title></head><body><h1>Loop A</h1><a href="/journey-loop-b">Go to B</a></body></html>`;
const JOURNEY_LOOP_B_PAGE = `<!DOCTYPE html>
<html><head><title>Loop B</title></head><body><h1>Loop B</h1><a href="/journey-loop-a">Go to A</a></body></html>`;

const JOURNEY_BINDING_PAGE = `<!DOCTYPE html>
<html><head><title>Item search</title></head><body>
  <h1>Item search</h1><label>Item code <input placeholder="Item code" /></label>
  <button type="button" id="find-item" onclick="window.location.href='/journey-detail'">Find item</button>
</body></html>`;

const JOURNEY_WRONG_START_PAGE = `<!DOCTYPE html>
<html><head><title>Workspace</title></head><body><h1>Workspace</h1>
  <a href="/journey-wrong-target">Open notice</a><a href="/journey-catalog">Open catalog</a>
</body></html>`;
const JOURNEY_WRONG_TARGET_PAGE = `<!DOCTYPE html>
<html><head><title>Notice</title></head><body><h1>Notice</h1>
  <p>This is not the requested item flow.</p><a href="/journey-catalog">Return to catalog</a>
</body></html>`;

const JOURNEY_POPUP_PAGE = `<!DOCTYPE html>
<html><head><title>Popup launcher</title></head><body><h1>Popup launcher</h1>
  <a href="/journey-detail" target="_blank" rel="noopener">Open item in new tab</a>
</body></html>`;
const JOURNEY_POPUP_EXTERNAL_PAGE = `<!DOCTYPE html>
<html><head><title>External launcher</title></head><body><h1>External launcher</h1>
  <a href="https://example.invalid/blocked" target="_blank" rel="noopener">Open external tab</a>
</body></html>`;
const JOURNEY_POPUP_AMBIGUOUS_PAGE = `<!DOCTYPE html>
<html><head><title>Ambiguous launcher</title></head><body><h1>Ambiguous launcher</h1>
  <button type="button" onclick="window.open('/journey-detail'); window.open('/journey-catalog');">Open two tabs</button>
</body></html>`;
const JOURNEY_POPUP_RECOVERY_PAGE = `<!DOCTYPE html>
<html><head><title>Recovery launcher</title></head><body><h1>Recovery launcher</h1>
  <a href="/journey-detail" target="_blank" rel="noopener">Open popup item</a>
  <a href="/journey-catalog">Continue in workspace</a>
</body></html>`;
const JOURNEY_SESSION_LOGIN_PAGE = `<!DOCTYPE html>
<html><head><title>Session expired</title></head><body><h1>Session expired - Sign in</h1>
  <form id="session-login"><label>Username <input name="username" /></label><label>Password <input name="password" type="password" /></label><button type="submit">Sign in</button></form>
  <script>document.getElementById('session-login').addEventListener('submit', function(e) { e.preventDefault(); window.location.href='/journey-home'; });</script>
</body></html>`;
const JOURNEY_RECONCILED_PAGE = `<!DOCTYPE html>
<html><head><title>Reconciled resource</title></head><body><h1>Resource detail</h1>
  <p>Customer status: Created</p><button type="button">Confirm resource</button>
</body></html>`;

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    // Accept the canonical base URL form used by the agent while preserving
    // route semantics for this disposable fixture.
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (path === '/verification/item' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ businessKey: 'ITEM-001', status: url.searchParams.get('wrong') === '1' ? 'ACTIVE' : 'COMPLETED' }));
      return;
    }

    const routes: Record<string, string> = {
      '/login': LOGIN_PAGE,
      '/dashboard': DASHBOARD_PAGE,
      '/duplicate': DUPLICATE_PAGE,
      '/redirect-external': REDIRECT_PAGE,
      '/ambiguous-login': AMBIGUOUS_LOGIN_PAGE,
      '/no-password': NO_PASSWORD_PAGE,
      '/wrong-behavior': WRONG_BEHAVIOR_PAGE,
      '/ui-changed-login': UI_CHANGED_LOGIN_PAGE,
      '/journey-home': JOURNEY_HOME_PAGE,
      '/journey-detour': JOURNEY_DETOUR_PAGE,
      '/journey-catalog': JOURNEY_CATALOG_PAGE,
      '/journey-home-changed': JOURNEY_HOME_CHANGED_PAGE,
      '/journey-catalog-changed': JOURNEY_CATALOG_CHANGED_PAGE,
      '/journey-detail': JOURNEY_DETAIL_PAGE,
      '/journey-modal': JOURNEY_MODAL_PAGE,
      '/journey-loading': JOURNEY_LOADING_PAGE,
      '/journey-loop-a': JOURNEY_LOOP_A_PAGE,
      '/journey-loop-b': JOURNEY_LOOP_B_PAGE,
      '/journey-binding': JOURNEY_BINDING_PAGE,
      '/journey-wrong-start': JOURNEY_WRONG_START_PAGE,
      '/journey-wrong-target': JOURNEY_WRONG_TARGET_PAGE,
      '/journey-popup': JOURNEY_POPUP_PAGE,
      '/journey-popup-external': JOURNEY_POPUP_EXTERNAL_PAGE,
      '/journey-popup-ambiguous': JOURNEY_POPUP_AMBIGUOUS_PAGE,
      '/journey-popup-recovery': JOURNEY_POPUP_RECOVERY_PAGE,
      '/journey-session-login': JOURNEY_SESSION_LOGIN_PAGE,
      '/journey-reconciled': JOURNEY_RECONCILED_PAGE,
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
