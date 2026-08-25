// UI Executor v1 — Playwright browser session (production).
//
// Real Chromium implementation of BrowserSession. Manages Browser →
// BrowserContext → Page lifecycle. Each createIsolatedPage() call produces
// a fresh BrowserContext for test isolation. Tracks lifecycle counters.

import type {
  BrowserSession,
  BrowserPage,
  ResolvedLocator,
  UIEnvironmentConfig,
  BrowserLifecycleCounters,
  BrowserPageContext,
  HistoryNavigationResult,
  UILocatorStrategy,
} from '../models.js';
import type { Page, Locator, Browser, BrowserContext } from 'playwright';
import { UIExecutorError } from '../errors.js';

// Playwright role type derived from Page.getByRole signature
type PWRole = Parameters<Page['getByRole']>[0];

// Lazy import of playwright to avoid hard crash if not installed
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pw: typeof import('playwright') | undefined;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
async function getPlaywright(): Promise<typeof import('playwright')> {
  if (!pw) {
    pw = await import('playwright');
  }
  return pw;
}

export interface PlaywrightSessionOptions {
  headless?: boolean;
  slowMo?: number;
}

export class PlaywrightBrowserSession implements BrowserSession {
  private browser: Browser | null = null;
  private currentContext: BrowserContext | null = null;
  private currentPage: Page | null = null;
  private pageEntries = new Map<string, { page: Page; openerPageId?: string }>();
  private nextPageId = 1;
  private _closed = false;
  private _started = false;
  private _counters: BrowserLifecycleCounters = {
    browsersLaunched: 0,
    browsersClosed: 0,
    contextsCreated: 0,
    contextsClosed: 0,
    pagesCreated: 0,
    pagesClosed: 0,
  };
  private sessionOptions: PlaywrightSessionOptions;

  constructor(options: PlaywrightSessionOptions = {}) {
    this.sessionOptions = options;
  }

  async start(config: UIEnvironmentConfig): Promise<void> {
    if (this._started) return;
    try {
      const playwright = await getPlaywright();
      this.browser = await playwright.chromium.launch({
        headless: config.headless ?? this.sessionOptions.headless ?? true,
        slowMo: this.sessionOptions.slowMo,
      });
      this._counters.browsersLaunched++;
      this._started = true;
      this._closed = false;
    } catch (err) {
      throw new UIExecutorError(
        'UI_BROWSER_START_FAILED',
        `Failed to launch Chromium: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  page(): BrowserPage {
    if (!this.currentPage) {
      throw new UIExecutorError(
        'UI_BROWSER_SESSION_MISSING',
        'No active page. Call start() and createIsolatedPage() first.',
      );
    }
    return new PlaywrightBrowserPage(this.currentPage);
  }

  async pageContexts(): Promise<BrowserPageContext[]> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const contexts: BrowserPageContext[] = [];
    for (const [id, entry] of this.pageEntries) {
      if (entry.page.isClosed()) continue;
      if (!entry.openerPageId) {
        const opener = await entry.page.opener();
        if (opener) {
          entry.openerPageId = [...this.pageEntries.entries()].find(([, candidate]) => candidate.page === opener)?.[0];
        }
      }
      contexts.push({ id, page: new PlaywrightBrowserPage(entry.page), url: entry.page.url(), openerPageId: entry.openerPageId, active: entry.page === this.currentPage });
    }
    return contexts;
  }

  async activatePage(pageId: string): Promise<BrowserPageContext> {
    const entry = this.pageEntries.get(pageId);
    if (!entry || entry.page.isClosed()) throw new UIExecutorError('UI_BROWSER_SESSION_MISSING', `Page '${pageId}' is not available.`);
    this.currentPage = entry.page;
    const contexts = await this.pageContexts();
    const context = contexts.find((candidate) => candidate.id === pageId);
    if (!context) throw new UIExecutorError('UI_BROWSER_SESSION_MISSING', `Page '${pageId}' is not available.`);
    return context;
  }

  async closePage(pageId: string): Promise<void> {
    const entry = this.pageEntries.get(pageId);
    if (!entry || entry.page.isClosed()) return;
    await entry.page.close();
    this._counters.pagesClosed++;
    this.pageEntries.delete(pageId);
    if (this.currentPage === entry.page) this.currentPage = null;
  }

  /// Create an isolated BrowserContext + Page for a test case.
  /// Cookies/localStorage from previous contexts will not leak.
  async createIsolatedPage(): Promise<BrowserPage> {
    if (!this.browser) {
      throw new UIExecutorError(
        'UI_BROWSER_SESSION_MISSING',
        'Browser not launched. Call start() first.',
      );
    }
    // Close previous context if any
    if (this.currentContext) {
      for (const entry of this.pageEntries.values()) {
        if (!entry.page.isClosed()) {
          await entry.page.close();
          this._counters.pagesClosed++;
        }
      }
      await this.currentContext.close();
      this._counters.contextsClosed++;
      this.currentContext = null;
      this.currentPage = null;
      this.pageEntries.clear();
    }
    const context = await this.browser.newContext();
    this._counters.contextsCreated++;
    this.currentContext = context;

    const page = await context.newPage();
    this._counters.pagesCreated++;
    this.currentPage = page;
    this.pageEntries.clear();
    this.nextPageId = 1;
    this.pageEntries.set(`page-${this.nextPageId++}`, { page });
    context.on('page', (openedPage) => {
      if (openedPage === page || [...this.pageEntries.values()].some((entry) => entry.page === openedPage)) return;
      this._counters.pagesCreated++;
      this.pageEntries.set(`page-${this.nextPageId++}`, { page: openedPage });
    });

    return new PlaywrightBrowserPage(page);
  }

  async screenshot(): Promise<Buffer> {
    if (!this.currentPage) {
      throw new UIExecutorError('UI_SCREENSHOT_FAILED', 'No active page for screenshot.');
    }
    const buf = await this.currentPage.screenshot({ fullPage: false });
    return Buffer.from(buf);
  }

  async close(): Promise<void> {
    if (this._closed) return;
    try {
      if (this.currentPage && !this.currentPage.isClosed()) {
        await this.currentPage.close();
        this._counters.pagesClosed++;
      }
      this.currentPage = null;
      if (this.currentContext) {
        await this.currentContext.close();
        this._counters.contextsClosed++;
      }
      this.currentContext = null;
      if (this.browser) {
        await this.browser.close();
        this._counters.browsersClosed++;
      }
      this.browser = null;
    } finally {
      this._closed = true;
      this._started = false;
    }
  }

  isClosed(): boolean {
    return this._closed;
  }

  getCounters(): Readonly<BrowserLifecycleCounters> {
    return { ...this._counters };
  }
}

// ---- PlaywrightBrowserPage: real Playwright page wrapper ------------------

class PlaywrightBrowserPage implements BrowserPage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(url: string, options?: { timeoutMs?: number }): Promise<void> {
    try {
      await this.page.goto(url, { timeout: options?.timeoutMs, waitUntil: 'domcontentloaded' });
    } catch (err) {
      throw new UIExecutorError(
        'UI_NAVIGATION_FAILED',
        `Navigation to '${url}' failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async click(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.click({ timeout: options?.timeoutMs });
  }

  async fill(target: ResolvedLocator, value: string, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.fill(value, { timeout: options?.timeoutMs });
  }

  async type(target: ResolvedLocator, value: string, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.pressSequentially(value, { timeout: options?.timeoutMs });
  }

  async selectOption(target: ResolvedLocator, value: string, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    // Try by value first, then by label
    try {
      await loc.selectOption({ value });
    } catch {
      await loc.selectOption({ label: value });
    }
    // Note: timeout is handled by auto-wait on the locator
    void options;
  }

  async check(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.check({ timeout: options?.timeoutMs });
  }

  async uncheck(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.uncheck({ timeout: options?.timeoutMs });
  }

  async press(target: ResolvedLocator, key: string, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.press(key, { timeout: options?.timeoutMs });
  }

  async focus(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    await loc.focus({ timeout: options?.timeoutMs });
  }

  async blur(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await this.assertUnique(loc, target);
    // Playwright doesn't have a direct blur; dispatch blur event
    await loc.dispatchEvent('blur', {}, { timeout: options?.timeoutMs });
  }

  async waitForVisible(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await loc.waitFor({ state: 'visible', timeout: options?.timeoutMs });
  }

  async waitForHidden(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void> {
    const loc = this.toPlaywrightLocator(target);
    await loc.waitFor({ state: 'hidden', timeout: options?.timeoutMs });
  }

  async isVisible(target: ResolvedLocator): Promise<boolean> {
    const loc = this.toPlaywrightLocator(target);
    return loc.isVisible();
  }

  async isEnabled(target: ResolvedLocator): Promise<boolean> {
    const loc = this.toPlaywrightLocator(target);
    return loc.isEnabled();
  }

  async isChecked(target: ResolvedLocator): Promise<boolean> {
    const loc = this.toPlaywrightLocator(target);
    return loc.isChecked();
  }

  async textContent(target: ResolvedLocator): Promise<string> {
    const loc = this.toPlaywrightLocator(target);
    return (await loc.textContent()) ?? '';
  }

  async inputValue(target: ResolvedLocator): Promise<string> {
    const loc = this.toPlaywrightLocator(target);
    return (await loc.inputValue()) ?? '';
  }

  async attribute(target: ResolvedLocator, name: string): Promise<string | null> {
    const loc = this.toPlaywrightLocator(target);
    return loc.getAttribute(name);
  }

  async count(target: ResolvedLocator): Promise<number> {
    const loc = this.toPlaywrightLocator(target);
    return loc.count();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  url(): string {
    return this.page.url();
  }

  async goBack(): Promise<HistoryNavigationResult> {
    try {
      const response = await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 2_000 });
      return { success: response !== null, url: this.page.url() };
    } catch (error) {
      return { success: false, url: this.page.url(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  async evaluate<T>(expression: string): Promise<T> {
    return this.page.evaluate(expression) as Promise<T>;
  }

  // ---- Locator adapter: map ResolvedLocator → Playwright Locator ----------

  private toPlaywrightLocator(target: ResolvedLocator): Locator {
    return mapLocator(this.page, target);
  }

  // Verify exactly 1 match — never fall back to .first() / .nth(0)
  private async assertUnique(loc: Locator, target: ResolvedLocator): Promise<void> {
    const n = await loc.count();
    if (n === 0) {
      throw new UIExecutorError(
        'UI_ELEMENT_NOT_FOUND',
        `No element found for '${target.description}' (${target.strategy}=${target.value}).`,
        { strategy: target.strategy, value: target.value },
      );
    }
    if (n > 1) {
      throw new UIExecutorError(
        'UI_LOCATOR_AMBIGUOUS',
        `Found ${n} elements for '${target.description}' (${target.strategy}=${target.value}).`,
        { strategy: target.strategy, value: target.value, count: n },
      );
    }
  }
}

// ---- Locator adapter function (spec §6) -----------------------------------
// Maps UILocatorStrategy → Playwright Locator.
// Never uses .first(), .nth(0), or force:true.

export function mapLocator(
  page: Page,
  target: ResolvedLocator,
): Locator {
  const strategy: UILocatorStrategy = target.strategy;
  const value = target.value;

  switch (strategy) {
    case 'test-id':
      return page.getByTestId(value);
    case 'role':
      return page.getByRole(value as PWRole, { exact: target.exact, ...(target.name ? { name: target.name } : {}) });
    case 'label':
      return page.getByLabel(value, { exact: target.exact });
    case 'placeholder':
      return page.getByPlaceholder(value, { exact: target.exact });
    case 'text':
      return page.getByText(value, { exact: target.exact });
    case 'css':
      return page.locator(value);
    case 'xpath':
      return page.locator(`xpath=${value}`);
    default:
      throw new UIExecutorError(
        'UI_ACTION_UNSUPPORTED',
        `Unsupported locator strategy: '${strategy as string}'.`,
        { strategy },
      );
  }
}
