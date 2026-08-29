// Locator expression builder (spec §7, §8).
//
// Converts a trusted UIElementLocator (from UIElementCatalog) into a
// deterministic Playwright locator source expression. This mirrors the
// runtime strategy mapping in ui-executor's playwright-browser-session
// `mapLocator`, but emits *source text* instead of a runtime Locator.
//
// No guessing: the strategy + value are taken verbatim from the trusted
// catalog. `pageVar` is the Playwright test fixture parameter (default `page`).

import type { UILocatorStrategy } from './re-export.js';

export interface LocatorSpec {
  strategy: UILocatorStrategy;
  value: string;
  role?: string;
  exact?: boolean;
}

function js(value: string): string {
  return JSON.stringify(value);
}

export function locatorExpression(locator: LocatorSpec, pageVar = 'page'): string {
  const { strategy, value, role, exact } = locator;
  switch (strategy) {
    case 'test-id':
      return `${pageVar}.getByTestId(${js(value)})`;
    case 'role': {
      const opts: string[] = [];
      if (exact) opts.push(`exact: true`);
      if (role !== undefined) opts.push(`name: ${js(role)}`);
      const optStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : '';
      return `${pageVar}.getByRole(${js(value)}${optStr})`;
    }
    case 'label':
      return `${pageVar}.getByLabel(${js(value)}${exact ? ', { exact: true }' : ''})`;
    case 'placeholder':
      return `${pageVar}.getByPlaceholder(${js(value)}${exact ? ', { exact: true }' : ''})`;
    case 'text':
      return `${pageVar}.getByText(${js(value)}${exact ? ', { exact: true }' : ''})`;
    case 'css':
      return `${pageVar}.locator(${js(value)})`;
    case 'xpath':
      return `${pageVar}.locator(\`xpath=${value.replace(/`/g, '\\`')}\`)`;
    default:
      // Exhaustiveness guard — unknown strategy is a programming error, never a guess.
      throw new Error(`UNSUPPORTED_LOCATOR_STRATEGY:${strategy}`);
  }
}
