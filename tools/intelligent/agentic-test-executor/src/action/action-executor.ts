// ---------------------------------------------------------------------------
// Agentic Test Executor — action executor
// ---------------------------------------------------------------------------

import type { BrowserPage, ResolvedLocator } from 'ui-executor';
import type { AgenticAction } from '../models.js';
import type { ElementIdMap } from '../observation/element-id-map.js';

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface ExecuteActionOptions {
  /** Origin used to resolve relative navigate URLs when the page is blank. */
  baseUrl?: string;
  /** Override for page.goto timeout on slow targets. */
  navigationTimeoutMs?: number;
}

export async function executeAction(
  page: BrowserPage,
  action: AgenticAction,
  idMap: ElementIdMap,
  options?: ExecuteActionOptions,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'navigate': {
        if (!action.url) return { success: false, error: 'Missing URL' };
        // Relative paths must resolve against the page's current origin —
        // Playwright rejects bare relative URLs with "invalid URL".
        const base = options?.baseUrl ?? (page.url().startsWith('http') ? page.url() : undefined);
        const target = /^https?:\/\//i.test(action.url)
          ? action.url
          : base ? new URL(action.url, base).href : action.url;
        await page.goto(target, options?.navigationTimeoutMs ? { timeoutMs: options.navigationTimeoutMs } : undefined);
        return { success: true };
      }

      case 'click': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.click(loc);
        return { success: true };
      }

      case 'hover': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.hover(loc);
        return { success: true };
      }

      case 'fill': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.fill(loc, action.value ?? '');
        return { success: true };
      }

      case 'select': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.selectOption(loc, action.value ?? '');
        return { success: true };
      }

      case 'check':
      case 'uncheck': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        const desired = action.type === 'check';
        const before = await page.checkboxInfo(loc);
        if (before.checked === null || before.kind === 'unsupported') {
          return { success: false, error: 'Cannot safely determine checkbox state' };
        }
        if (before.checked !== desired) {
          if (before.kind === 'native') {
            if (desired) await page.check(loc);
            else await page.uncheck(loc);
          } else {
            await page.click(loc);
          }
        }
        const after = await page.checkboxInfo(loc);
        if (after.checked !== desired) {
          return { success: false, error: `Checkbox state did not change to ${desired}` };
        }
        return { success: true };
      }

      case 'press': {
        if (!action.elementId) {
          // Key-only press (e.g. "press Enter") acts on the focused element.
          await page.pressKey(action.key ?? 'Enter');
          return { success: true };
        }
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.press(loc, action.key ?? 'Enter');
        return { success: true };
      }

      case 'wait-for': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.waitForVisible(loc);
        return { success: true };
      }

      case 'observe': {
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function resolveLocator(action: AgenticAction, idMap: ElementIdMap): ResolvedLocator | null {
  if (!action.elementId) return null;
  const mapping = idMap.get(action.elementId);
  return mapping?.locator ?? null;
}
