// UI Executor v1 — Fake browser session for unit tests.
//
// Simulates browser behavior without launching a real browser. Supports
// configurable element states, navigation tracking, and screenshot stubs.

import type {
  BrowserSession,
  BrowserPage,
  ResolvedLocator,
  UIEnvironmentConfig,
} from '../models.js';

export interface FakeElementState {
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean;
  text?: string;
  value?: string;
  attributes?: Record<string, string>;
}

export interface FakeBrowserConfig {
  elements?: Map<string, FakeElementState>;
  pageTitle?: string;
  currentUrl?: string;
  shouldFail?: boolean;
  failMessage?: string;
}

export class FakeBrowserPage implements BrowserPage {
  private config: FakeBrowserConfig;
  private _url: string;
  private _title: string;
  private actions: Array<{ type: string; target?: string; value?: string }> = [];

  constructor(config: FakeBrowserConfig) {
    this.config = config;
    this._url = config.currentUrl ?? 'http://127.0.0.1/';
    this._title = config.pageTitle ?? 'Test Page';
  }

  async goto(url: string, _options?: { timeoutMs?: number }): Promise<void> {
    if (this.config.shouldFail) throw new Error(this.config.failMessage ?? 'Navigation failed');
    this._url = url;
    this.actions.push({ type: 'goto', target: url });
  }

  async click(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'click', target: target.description });
  }

  async fill(target: ResolvedLocator, value: string, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'fill', target: target.description, value });
  }

  async type(target: ResolvedLocator, value: string, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'type', target: target.description, value });
  }

  async selectOption(target: ResolvedLocator, value: string, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'selectOption', target: target.description, value });
  }

  async check(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'check', target: target.description });
  }

  async uncheck(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'uncheck', target: target.description });
  }

  async press(target: ResolvedLocator, key: string, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'press', target: target.description, value: key });
  }

  async focus(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'focus', target: target.description });
  }

  async blur(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    this.checkElement(target);
    this.actions.push({ type: 'blur', target: target.description });
  }

  async waitForVisible(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    const state = this.getElementState(target);
    if (state?.visible === false) throw new Error(`Element '${target.description}' not visible`);
  }

  async waitForHidden(target: ResolvedLocator, _options?: { timeoutMs?: number }): Promise<void> {
    const state = this.getElementState(target);
    if (state?.visible === true) throw new Error(`Element '${target.description}' still visible`);
  }

  async isVisible(target: ResolvedLocator): Promise<boolean> {
    const state = this.getElementState(target);
    return state?.visible !== false;
  }

  async isEnabled(target: ResolvedLocator): Promise<boolean> {
    const state = this.getElementState(target);
    return state?.enabled !== false;
  }

  async isChecked(target: ResolvedLocator): Promise<boolean> {
    const state = this.getElementState(target);
    return state?.checked === true;
  }

  async textContent(target: ResolvedLocator): Promise<string> {
    const state = this.getElementState(target);
    return state?.text ?? '';
  }

  async inputValue(target: ResolvedLocator): Promise<string> {
    const state = this.getElementState(target);
    return state?.value ?? '';
  }

  async attribute(target: ResolvedLocator, name: string): Promise<string | null> {
    const state = this.getElementState(target);
    return state?.attributes?.[name] ?? null;
  }

  async count(_target: ResolvedLocator): Promise<number> {
    return 1;
  }

  async title(): Promise<string> {
    return this._title;
  }

  url(): string {
    return this._url;
  }

  getActions(): Array<{ type: string; target?: string; value?: string }> {
    return [...this.actions];
  }

  private checkElement(_target: ResolvedLocator): void {
    if (this.config.shouldFail) throw new Error(this.config.failMessage ?? 'Element operation failed');
  }

  private getElementState(target: ResolvedLocator): FakeElementState | undefined {
    const key1 = `${target.strategy}=${target.value}`;
    return this.config.elements?.get(key1) ?? this.config.elements?.get(target.value) ?? this.config.elements?.get(target.description);
  }
}

export class FakeBrowserSession implements BrowserSession {
  private config: FakeBrowserConfig;
  private _closed = false;
  private _page: FakeBrowserPage;
  private _started = false;

  constructor(config: FakeBrowserConfig = {}) {
    this.config = config;
    this._page = new FakeBrowserPage(config);
  }

  async start(_config: UIEnvironmentConfig): Promise<void> {
    if (this.config.shouldFail) {
      throw new Error(this.config.failMessage ?? 'Browser start failed');
    }
    this._started = true;
    this._closed = false;
  }

  page(): BrowserPage {
    return this._page;
  }

  async screenshot(): Promise<Buffer> {
    if (this.config.shouldFail) throw new Error('Screenshot failed');
    return Buffer.from('FAKE_PNG_DATA');
  }

  async close(): Promise<void> {
    this._closed = true;
  }

  isClosed(): boolean {
    return this._closed;
  }

  isStarted(): boolean {
    return this._started;
  }
}
