// UI Executor v1 — Element catalog and locator resolver.
//
// Resolves logical element names to concrete Playwright locators via the
// UIElementCatalog. Never guesses selectors from prose (spec §16).

import type {
  UIElementCatalog,
  UIElementDefinition,
  UIElementTarget,
  UIPageDefinition,
  ResolvedLocator,
} from '../models.js';
import { UIExecutorError } from '../errors.js';

export class LocatorResolver {
  private catalog: UIElementCatalog;
  private testIdAttribute: string;

  constructor(catalog: UIElementCatalog, testIdAttribute = 'data-testid') {
    this.catalog = catalog;
    this.testIdAttribute = testIdAttribute;
  }

  // Find element definition by logical name across all pages
  findElement(logicalName: string): { page: UIPageDefinition; element: UIElementDefinition } | null {
    for (const page of this.catalog.pages) {
      const el = page.elements.find((e) => e.logicalName === logicalName);
      if (el) return { page, element: el };
    }
    return null;
  }

  // Resolve a UIElementTarget to a concrete ResolvedLocator
  resolve(target: UIElementTarget): ResolvedLocator {
    // If target has explicit strategy + value, use directly
    if (target.strategy && target.value) {
      return {
        strategy: target.strategy,
        value: target.value,
        role: target.role,
        exact: target.exact,
        description: `${target.strategy}=${target.value}`,
      };
    }

    // Otherwise look up in catalog by logical name
    const found = this.findElement(target.logicalName);
    if (!found) {
      throw new UIExecutorError(
        'UI_LOCATOR_MAPPING_MISSING',
        `No catalog mapping for logical name '${target.logicalName}'.`,
        { logicalName: target.logicalName },
      );
    }

    return {
      strategy: found.element.locator.strategy,
      value: found.element.locator.value,
      role: found.element.locator.role,
      exact: found.element.locator.exact,
      description: `${found.element.locator.strategy}=${found.element.locator.value} (${target.logicalName})`,
    };
  }

  // Check if element is marked sensitive
  isSensitive(logicalName: string): boolean {
    const found = this.findElement(logicalName);
    return found?.element.sensitive === true;
  }

  // Get page by ID
  getPage(pageId: string): UIPageDefinition | null {
    return this.catalog.pages.find((p) => p.id === pageId) ?? null;
  }

  // Get page route
  getPageRoute(pageId: string): string | null {
    return this.getPage(pageId)?.route ?? null;
  }

  getCatalog(): UIElementCatalog {
    return this.catalog;
  }

  getTestIdAttribute(): string {
    return this.testIdAttribute;
  }
}
