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

export async function executeAction(
  page: BrowserPage,
  action: AgenticAction,
  idMap: ElementIdMap,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'navigate': {
        if (!action.url) return { success: false, error: 'Missing URL' };
        await page.goto(action.url);
        return { success: true };
      }

      case 'click': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.click(loc);
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

      case 'check': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.check(loc);
        return { success: true };
      }

      case 'uncheck': {
        const loc = resolveLocator(action, idMap);
        if (!loc) return { success: false, error: `Cannot resolve element ${action.elementId}` };
        await page.uncheck(loc);
        return { success: true };
      }

      case 'press': {
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
