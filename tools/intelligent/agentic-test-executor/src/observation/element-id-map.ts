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
  if (element.accessibleName && element.role) {
    return {
      strategy: 'role' as UILocatorStrategy,
      value: element.role,
      role: element.role,
      name: element.accessibleName,
      exact: true,
      description: `${element.role} "${element.accessibleName}"`,
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
