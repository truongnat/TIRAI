// UI Executor v1 — Browser policy and origin safety.
//
// Enforces allowed origins, browser types, screenshot policy, and navigation
// safety. Fail-closed: missing base URL or disallowed origin → reject.

import type { UIBrowserPolicy, UIEnvironmentConfig } from './models.js';
import { UIExecutorError } from './errors.js';

export const DEFAULT_BROWSER_POLICY: UIBrowserPolicy = {
  allowedOrigins: ['http://127.0.0.1', 'http://localhost'],
  browser: 'chromium',
  headless: true,
  allowDownloads: false,
  allowPopups: false,
  captureScreenshots: 'failure',
  maxPages: 1,
  navigationTimeoutMs: 10_000,
  actionTimeoutMs: 5_000,
  assertionTimeoutMs: 5_000,
  testIdAttribute: 'data-testid',
};

export function mergeBrowserPolicy(overrides?: Partial<UIBrowserPolicy>): UIBrowserPolicy {
  return { ...DEFAULT_BROWSER_POLICY, ...overrides };
}

// Validate that a URL is within allowed origins
export function validateOrigin(url: string, policy: UIBrowserPolicy): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UIExecutorError('UI_NAVIGATION_FAILED', `Invalid URL: '${url}'.`);
  }

  // Reject dangerous protocols (spec §21)
  const blockedProtocols = ['javascript:', 'file:', 'data:', 'vbscript:'];
  if (blockedProtocols.some((p) => parsed.protocol === p || parsed.protocol.startsWith(p.replace(':', '')))) {
    throw new UIExecutorError(
      'UI_ORIGIN_DENIED',
      `Protocol '${parsed.protocol}' is not allowed.`,
      { url, protocol: parsed.protocol },
    );
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  const allowed = policy.allowedOrigins.some((ao) => origin === ao || origin.startsWith(ao));
  if (!allowed) {
    throw new UIExecutorError(
      'UI_ORIGIN_DENIED',
      `Origin '${origin}' is not in allowed origins: [${policy.allowedOrigins.join(', ')}].`,
      { url, origin, allowedOrigins: policy.allowedOrigins },
    );
  }
}

// Resolve a relative path against base URL
export function resolveUrl(baseUrl: string, relativePath: string): string {
  if (!baseUrl) {
    throw new UIExecutorError('UI_BASE_URL_MISSING', 'Base URL is required for navigation.');
  }
  // If relativePath is already a full URL, reject (spec §23)
  if (/^https?:\/\//.test(relativePath)) {
    throw new UIExecutorError(
      'UI_ORIGIN_DENIED',
      `Arbitrary full URL '${relativePath}' is not allowed. Use relative paths.`,
      { relativePath },
    );
  }
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const path = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `${base}${path}`;
}

// Validate base URL exists
export function validateBaseUrl(config: UIEnvironmentConfig): void {
  if (!config.baseUrl || config.baseUrl.trim() === '') {
    throw new UIExecutorError(
      'UI_BASE_URL_MISSING',
      'UI environment config must define a baseUrl.',
    );
  }
}

// Validate safe known key strings for press action (spec §36)
const SAFE_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Control', 'Alt', 'Shift', 'Meta',
]);

export function validateKeyPress(key: string): void {
  if (!SAFE_KEYS.has(key)) {
    throw new UIExecutorError(
      'UI_ACTION_UNSUPPORTED',
      `Key '${key}' is not in the safe key set.`,
      { key },
    );
  }
}
