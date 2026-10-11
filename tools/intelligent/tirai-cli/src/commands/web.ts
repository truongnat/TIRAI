import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv } from 'ajv';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PlaywrightBrowserSession } from 'ui-executor';
import type { WebEnvironmentConfig } from '../platform-config.js';
import { CliError } from '../errors.js';
import { loadConfig } from '../config.js';
import { requireWorkspace, type WorkspacePaths } from '../workspace.js';
import { assertNonProductionEnvironment, ensurePrivateWorkspaceArtifactsIgnored, getActiveWebSession, getImportedSessionPath, getManualSessionPath, getWorkflowPaths, safeEnvironmentName } from '../workflow.js';

export interface WebDiscoverOptions {
  cwd: string;
  environment: string;
  maxRoutes?: number;
  json?: boolean;
}

export interface WebAuthOptions {
  cwd: string;
  environment: string;
  json?: boolean;
}

export interface WebAuthImportOptions extends WebAuthOptions {
  file: string;
}

interface PlaywrightStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

const validatePlaywrightStorageState = new Ajv().compile<PlaywrightStorageState>({
  type: 'object',
  properties: {
    cookies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          domain: { type: 'string' },
          path: { type: 'string' },
          expires: { type: 'number' },
          httpOnly: { type: 'boolean' },
          secure: { type: 'boolean' },
          sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
        },
        required: ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'],
        additionalProperties: true,
      },
    },
    origins: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          origin: { type: 'string' },
          localStorage: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, value: { type: 'string' } },
              required: ['name', 'value'],
              additionalProperties: true,
            },
          },
        },
        required: ['origin', 'localStorage'],
        additionalProperties: true,
      },
    },
  },
  required: ['cookies', 'origins'],
  additionalProperties: true,
});

interface DiscoveredRoute {
  path: string;
  title: string;
  headings: string[];
  links: Array<{ label: string; path: string }>;
  controls: string[];
  forms: Array<{ label: string; type: string; required: boolean }>;
}

interface DiscoverySnapshot {
  schemaVersion: '1.0';
  environment: string;
  baseUrl: string;
  discoveredAt: string;
  routes: DiscoveredRoute[];
}

const PAGE_SNAPSHOT_SCRIPT = `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
  const origin = window.location.origin;
  const links = Array.from(document.querySelectorAll('a[href]')).flatMap((anchor) => {
    try {
      const url = new URL(anchor.href, origin);
      const label = clean(anchor.innerText || anchor.getAttribute('aria-label'));
      const unsafe = /logout|sign.?out|delete|remove|destroy|checkout|payment|purchase|unsubscribe|submit/i.test(url.pathname + ' ' + label);
      if (url.origin !== origin || unsafe || !label || !['http:', 'https:'].includes(url.protocol)) return [];
      return [{ label, path: url.pathname }];
    } catch { return []; }
  });
  const controls = Array.from(document.querySelectorAll('button,[role="tab"],[aria-haspopup="menu"],summary')).flatMap((element, index) => {
    const label = clean(element.getAttribute('aria-label') || element.innerText || element.textContent);
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const buttonType = element instanceof HTMLButtonElement ? element.type : '';
    const safe = role === 'tab' || element.matches('summary,[aria-haspopup="menu"]') || /^(open )?(menu|navigation|nav|expand|accordion|details)( .*)?$/i.test(label);
    const unsafe = /submit|save|delete|remove|destroy|checkout|payment|purchase|send|confirm|create|update|logout|sign.?out/i.test(label);
    const visible = element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    const disabled = ('disabled' in element && element.disabled) || element.getAttribute('aria-disabled') === 'true';
    return safe && !unsafe && visible && !disabled && buttonType !== 'submit' && label ? [{ index, label, role }] : [];
  });
  const forms = Array.from(document.querySelectorAll('input,select,textarea')).map((element) => {
    const label = clean(element.labels?.[0]?.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder'));
    return { label, type: element.getAttribute('type') || element.tagName.toLowerCase(), required: element.hasAttribute('required') };
  }).filter((field) => field.label);
  return {
    title: clean(document.title),
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((heading) => clean(heading.innerText)).filter(Boolean).slice(0, 30),
    links,
    controls,
    forms,
  };
})()`;

export async function runWebDiscover(opts: WebDiscoverOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const environment = safeEnvironmentName(opts.environment);
  const envConfig = getWebEnvironment(paths, environment);
  assertNonProductionEnvironment(environment, envConfig.baseUrl);
  const maxRoutes = opts.maxRoutes ?? 50;
  if (!Number.isInteger(maxRoutes) || maxRoutes < 1 || maxRoutes > 50) {
    throw new CliError('INVALID_TARGET', '--max-routes must be an integer between 1 and 50.');
  }
  const origin = new URL(envConfig.baseUrl).origin;
  const workflow = getWorkflowPaths(paths);
  const activeSession = getActiveWebSession(workflow.runtime, environment);
  const session = new PlaywrightBrowserSession(activeSession ? { storageState: activeSession.path } : {});
  const routeQueue = [new URL(envConfig.baseUrl).pathname || '/'];
  const seenRoutes = new Set<string>();
  const routes: DiscoveredRoute[] = [];
  try {
    await session.start({ baseUrl: envConfig.baseUrl, allowedOrigins: [origin], headless: true, viewport: envConfig.viewport });
    const page = await session.createIsolatedPage();
    while (routeQueue.length > 0 && routes.length < maxRoutes) {
      const route = routeQueue.shift()!;
      if (seenRoutes.has(route)) continue;
      seenRoutes.add(route);
      const target = new URL(route, origin);
      if (target.origin !== origin || isUnsafeRoute(target.pathname)) continue;
      try {
        await page.goto(target.href, { timeoutMs: 15000 });
      } catch {
        continue;
      }
      if (new URL(page.url()).origin !== origin) continue;
      const pageData = await page.evaluate<{
        title: string;
        headings: string[];
        links: Array<{ label: string; path: string }>;
        controls: Array<{ index: number; label: string; role: string }>;
        forms: Array<{ label: string; type: string; required: boolean }>;
      }>(PAGE_SNAPSHOT_SCRIPT);
      const openedControls: string[] = [];
      const observedLinks = [...pageData.links];
      const observedHeadings = [...pageData.headings];
      const observedForms = [...pageData.forms];
      for (const control of pageData.controls.slice(0, 8)) {
        try {
          const opened = await page.evaluate<boolean>(`(() => {
            const controls = Array.from(document.querySelectorAll('button,[role="tab"],[aria-haspopup="menu"],summary'));
            const element = controls[${control.index}];
            if (!element) return false;
            const label = String(element.getAttribute('aria-label') || element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
            const role = element.getAttribute('role') || element.tagName.toLowerCase();
            const safe = role === 'tab' || element.matches('summary,[aria-haspopup="menu"]') || /^(open )?(menu|navigation|nav|expand|accordion|details)( .*)?$/i.test(label);
            const unsafe = /submit|save|delete|remove|destroy|checkout|payment|purchase|send|confirm|create|update|logout|sign.?out/i.test(label);
            const visible = element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
            const disabled = ('disabled' in element && element.disabled) || element.getAttribute('aria-disabled') === 'true';
            if (label !== ${JSON.stringify(control.label)} || !safe || unsafe || !visible || disabled || element instanceof HTMLButtonElement && element.type === 'submit') return false;
            element.click();
            return true;
          })()`);
          if (opened) {
            openedControls.push(`${control.role}: ${control.label}`);
            if (new URL(page.url()).origin !== origin) continue;
            const afterClick = await page.evaluate<{
              headings: string[];
              links: Array<{ label: string; path: string }>;
              forms: Array<{ label: string; type: string; required: boolean }>;
            }>(`(() => {
              const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
              const links = Array.from(document.querySelectorAll('a[href]')).flatMap((anchor) => {
                try {
                  const url = new URL(anchor.href, window.location.origin);
                  const label = clean(anchor.innerText || anchor.getAttribute('aria-label'));
                  const unsafe = /logout|sign.?out|delete|remove|destroy|checkout|payment|purchase|unsubscribe|submit/i.test(url.pathname + ' ' + label);
                  return url.origin === window.location.origin && !unsafe && label ? [{ label, path: url.pathname }] : [];
                } catch { return []; }
              });
              const forms = Array.from(document.querySelectorAll('input,select,textarea')).map((element) => ({
                label: clean(element.labels?.[0]?.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder')),
                type: element.getAttribute('type') || element.tagName.toLowerCase(),
                required: element.hasAttribute('required'),
              })).filter((field) => field.label);
              return {
                headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((heading) => clean(heading.innerText)).filter(Boolean).slice(0, 30),
                links,
                forms,
              };
            })()`);
            observedLinks.push(...afterClick.links);
            observedHeadings.push(...afterClick.headings);
            observedForms.push(...afterClick.forms);
          }
        } catch {
          // A single page control can disappear as an expanded menu changes the DOM.
        }
      }
      const routePath = target.pathname || '/';
      routes.push({
        path: routePath,
        title: redactText(pageData.title),
        headings: [...new Set(observedHeadings)].map(redactText),
        links: [...new Map(observedLinks.map((link) => [link.path, link])).values()].filter((link) => !seenRoutes.has(link.path) && !isUnsafeRoute(link.path)),
        controls: openedControls.map(redactText),
        forms: [...new Map(observedForms.map((field) => [`${field.label}:${field.type}`, field])).values()].map((field) => ({ ...field, label: redactText(field.label) })),
      });
      for (const link of observedLinks) {
        if (!seenRoutes.has(link.path) && !isUnsafeRoute(link.path) && routeQueue.length + routes.length < maxRoutes * 2) routeQueue.push(link.path);
      }
    }
  } catch (error) {
    throw new CliError('EXECUTION_ERROR', `Web discovery failed: ${error instanceof Error ? error.message : String(error)}`, 'Check the target URL and Chromium installation. TIRAI does not install browsers automatically.');
  } finally {
    await session.close();
  }
  const snapshot: DiscoverySnapshot = {
    schemaVersion: '1.0',
    environment,
    baseUrl: origin,
    discoveredAt: new Date().toISOString(),
    routes,
  };
  fs.mkdirSync(path.dirname(workflow.discovery), { recursive: true });
  fs.writeFileSync(workflow.discovery, JSON.stringify(snapshot, null, 2), 'utf8');
  if (opts.json) console.log(JSON.stringify({ ...snapshot, outputPath: workflow.discovery }, null, 2));
  else console.log(`Discovered ${routes.length} same-origin route(s): ${workflow.discovery}`);
}

export async function runWebAuthLogin(opts: WebAuthOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const environment = safeEnvironmentName(opts.environment);
  const envConfig = getWebEnvironment(paths, environment);
  assertNonProductionEnvironment(environment, envConfig.baseUrl);
  ensurePrivateWorkspaceArtifactsIgnored(paths);
  const workflow = getWorkflowPaths(paths);
  fs.mkdirSync(workflow.runtime, { recursive: true });
  const activeSession = getActiveWebSession(workflow.runtime, environment);
  if (activeSession) {
    throw new CliError('CONFIG_INVALID', `A browser session already exists for ${environment}. Run "tirai auth clear --environment ${environment}" first.`);
  }
  const statePath = getManualSessionPath(workflow.runtime, environment);
  const session = new PlaywrightBrowserSession({ headless: false });
  try {
    const origin = new URL(envConfig.baseUrl).origin;
    await session.start({ baseUrl: envConfig.baseUrl, allowedOrigins: [], headless: false, viewport: envConfig.viewport });
    const page = await session.createIsolatedPage();
    await page.goto(envConfig.baseUrl, { timeoutMs: 30000 });
    console.log(`Sign in to ${origin} in the opened browser. Do not enter credentials in this terminal.`);
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      await terminal.question('After sign-in completes, press Enter to save a temporary local session. ');
    } finally {
      terminal.close();
    }
    await session.saveStorageState(statePath);
    fs.chmodSync(statePath, 0o600);
    if (opts.json) console.log(JSON.stringify({ status: 'saved', environment, sessionPath: path.relative(paths.root, statePath) }, null, 2));
    else console.log(`Saved temporary session for ${environment}; it will be deleted after the next web run.`);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('EXECUTION_ERROR', `Manual sign-in session failed: ${error instanceof Error ? error.message : String(error)}`, 'Check the target URL and Chromium installation. TIRAI does not install browsers automatically.');
  } finally {
    await session.close();
  }
}

export async function runWebAuthImport(opts: WebAuthImportOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const environment = safeEnvironmentName(opts.environment);
  const envConfig = getWebEnvironment(paths, environment);
  assertNonProductionEnvironment(environment, envConfig.baseUrl);
  if (!opts.file.trim()) throw new CliError('INVALID_TARGET', 'Session import requires --file <storageState.json>.');
  ensurePrivateWorkspaceArtifactsIgnored(paths);
  const workflow = getWorkflowPaths(paths);
  fs.mkdirSync(workflow.runtime, { recursive: true });
  if (getActiveWebSession(workflow.runtime, environment)) {
    throw new CliError('CONFIG_INVALID', `A browser session already exists for ${environment}. Run "tirai auth clear --environment ${environment}" first.`);
  }

  let storageState: string;
  try {
    const sourcePath = path.resolve(opts.cwd, opts.file);
    if (!fs.statSync(sourcePath).isFile()) throw new Error('not a file');
    storageState = fs.readFileSync(sourcePath, 'utf8');
  } catch {
    throw new CliError('CONFIG_INVALID', 'Unable to read the session file. Provide a readable Playwright storageState JSON file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(storageState);
  } catch {
    throw new CliError('CONFIG_INVALID', 'The session file is not valid Playwright storageState JSON.');
  }
  if (!validatePlaywrightStorageState(parsed)) {
    throw new CliError('CONFIG_INVALID', 'The session file must contain Playwright storageState cookies and origins.');
  }

  const statePath = getImportedSessionPath(workflow.runtime, environment);
  let created = false;
  try {
    const descriptor = fs.openSync(statePath, 'wx', 0o600);
    created = true;
    try {
      fs.writeFileSync(descriptor, storageState, 'utf8');
      fs.fchmodSync(descriptor, 0o600);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (created && fs.existsSync(statePath)) fs.unlinkSync(statePath);
    if (isFileExistsError(error)) {
      throw new CliError('CONFIG_INVALID', `A browser session already exists for ${environment}. Run "tirai auth clear --environment ${environment}" first.`);
    }
    throw new CliError('EXECUTION_ERROR', 'Unable to securely store the imported browser session.');
  }

  if (opts.json) console.log(JSON.stringify({ status: 'imported', environment, sessionPath: path.relative(paths.root, statePath) }, null, 2));
  else console.log(`Imported Playwright browser session for ${environment}; it remains until "tirai auth clear".`);
}

export async function runWebAuthClear(opts: { cwd: string; environment?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const workflow = getWorkflowPaths(paths);
  const names = opts.environment
    ? [safeEnvironmentName(opts.environment)]
    : fs.existsSync(workflow.runtime)
      ? fs.readdirSync(workflow.runtime, { withFileTypes: true }).flatMap((entry) => {
        const match = entry.isFile() ? /^(?:manual|imported)-session-([a-zA-Z0-9_-]+)\.json$/.exec(entry.name) : null;
        return match ? [match[1]!] : [];
      })
      : [];
  const cleared: string[] = [];
  for (const name of new Set(names)) {
    let didClear = false;
    for (const statePath of [
      getManualSessionPath(workflow.runtime, name),
      getImportedSessionPath(workflow.runtime, name),
    ]) {
      if (!fs.existsSync(statePath)) continue;
      fs.unlinkSync(statePath);
      didClear = true;
    }
    if (didClear) cleared.push(name);
  }
  if (opts.json) console.log(JSON.stringify({ status: 'cleared', environments: cleared }, null, 2));
  else console.log(cleared.length ? `Cleared browser sessions: ${cleared.join(', ')}` : 'No browser sessions found.');
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}


function getWebEnvironment(paths: WorkspacePaths, environment: string): WebEnvironmentConfig {
  const config = loadConfig(paths);
  const envConfig = config.platforms?.web?.environments[environment];
  if (!envConfig) throw new CliError('CONFIG_INVALID', `Web environment "${environment}" is not configured. Run "tirai target add web --environment ${environment} --url <url>" first.`);
  let parsed: URL;
  try {
    parsed = new URL(envConfig.baseUrl);
  } catch {
    throw new CliError('CONFIG_INVALID', `Invalid web base URL for ${environment}: ${envConfig.baseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CliError('CONFIG_INVALID', 'Web base URL must use HTTP(S) and must not embed credentials.');
  }
  return envConfig;
}



function isUnsafeRoute(route: string): boolean {
  return /logout|sign.?out|delete|remove|destroy|checkout|payment|purchase|unsubscribe|submit/i.test(route);
}

function redactText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_NUMBER]')
    .replace(/\b(?:sk|pk|token|secret)[_-][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED_TOKEN]');
}
