// ---------------------------------------------------------------------------
// Agentic Test Executor — element ID map
// ---------------------------------------------------------------------------

import type { ResolvedLocator, UILocatorStrategy } from 'ui-executor';
import type { BrowserObservation, ObservedElement } from '../models.js';

export interface ElementIdMapping {
  elementId: string;
  locator: ResolvedLocator;
  element: ObservedElement;
}

export class ElementIdMap {
  private readonly mappings = new Map<string, ElementIdMapping>();

  static fromObservation(observation: BrowserObservation): ElementIdMap {
    const map = new ElementIdMap();
    for (const el of observation.elements) {
      const locator = buildLocator(el);
      map.mappings.set(el.id, { elementId: el.id, locator, element: el });
    }
    return map;
  }

  get(elementId: string): ElementIdMapping | undefined {
    return this.mappings.get(elementId);
  }

  has(elementId: string): boolean {
    return this.mappings.has(elementId);
  }

  all(): ElementIdMapping[] {
    return [...this.mappings.values()];
  }

  get size(): number {
    return this.mappings.size;
  }
}

function buildLocator(element: ObservedElement): ResolvedLocator {
  // DOM id is deterministic and unique — strongest strategy when present.
  if (element.domId) {
    return {
      strategy: 'css' as UILocatorStrategy,
      value: `[id="${element.domId.replace(/"/g, '\\"')}"]`,
      exact: true,
      description: `css [id="${element.domId}"]`,
    };
  }
  // Positional css fallback is always unique: nth match of the same selector
  // the observer scanned. Chosen before role/text so generic labels and
  // shared accessible names cannot produce ambiguous locators.
  if (typeof element.domIndex === 'number') {
    return {
      strategy: 'css' as UILocatorStrategy,
      value: `${INTERACTIVE_SELECTOR_CSS} >> nth=${element.domIndex}`,
      exact: true,
      description: `${element.role} "${element.accessibleName ?? element.label ?? element.id}" (domIndex ${element.domIndex})`,
    };
  }
  if (element.accessibleName && element.role && element.role !== 'generic') {
    return {
      strategy: 'role' as UILocatorStrategy,
      value: element.role,
      role: element.role,
      name: element.accessibleName,
      exact: true,
      description: `${element.role} "${element.accessibleName}"`,
    };
  }
  // Generic elements (labels, spans) resolve by their exact text — role-based
  // locators for 'generic' also match ancestor containers with the same
  // accessible name and fail the uniqueness check.
  if (element.accessibleName) {
    return {
      strategy: 'text' as UILocatorStrategy,
      value: element.accessibleName,
      exact: true,
      description: `text "${element.accessibleName}"`,
    };
  }

  if (element.label) {
    return {
      strategy: 'label' as UILocatorStrategy,
      value: element.label,
      exact: true,
      description: `label "${element.label}"`,
    };
  }

  if (element.placeholder) {
    return {
      strategy: 'placeholder' as UILocatorStrategy,
      value: element.placeholder,
      exact: true,
      description: `placeholder "${element.placeholder}"`,
    };
  }

  if (element.visibleText && element.role) {
    return {
      strategy: 'text' as UILocatorStrategy,
      value: element.visibleText,
      exact: true,
      description: `${element.role} with text "${element.visibleText}"`,
    };
  }

  return {
    strategy: 'role' as UILocatorStrategy,
    value: element.role || 'generic',
    exact: false,
    description: `${element.role || 'generic'} [${element.id}]`,
  };
}

export const INTERACTIVE_SELECTOR_CSS =
  'button, a[href], input, select, textarea, label, [role=button], [role=link], [role=textbox], [role=checkbox], [role=radio], [role=combobox], [role=tab], [role=menuitem], [tabindex]';
