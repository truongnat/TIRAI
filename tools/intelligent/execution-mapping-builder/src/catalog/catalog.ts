// Execution Mapping Builder — UI Catalog integration.
//
// Provides deterministic lookup of UI elements by logical name or alias.
// The catalog is the trusted source for selectors — AI never produces them.

import type {
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UILocatorStrategy,
} from '../models.js';

// ---- Catalog lookup result ------------------------------------------------

export interface CatalogLookupResult {
  found: boolean;
  element?: UIElementDefinition;
  page?: UIPageDefinition;
  ambiguous?: boolean;
  matches?: Array<{ page: UIPageDefinition; element: UIElementDefinition }>;
}

// ---- Catalog wrapper with alias support -----------------------------------

export class UICatalogResolver {
  private readonly aliasMap: Map<string, Array<{ page: UIPageDefinition; element: UIElementDefinition }>>;

  constructor(private readonly catalog: UIElementCatalog) {
    this.aliasMap = this.buildAliasMap();
  }

  get environmentId(): string {
    return this.catalog.environmentId;
  }

  get pages(): UIPageDefinition[] {
    return this.catalog.pages;
  }

  // ---- Lookup by logical name (exact match) --------------------------------

  lookupByLogicalName(logicalName: string): CatalogLookupResult {
    // Exact match first
    for (const page of this.catalog.pages) {
      for (const element of page.elements) {
        if (element.logicalName === logicalName) {
          return { found: true, element, page };
        }
      }
    }
    return { found: false };
  }

  // ---- Lookup by alias -----------------------------------------------------

  lookupByAlias(alias: string): CatalogLookupResult {
    const normalized = alias.toLowerCase().trim();
    const matches = this.aliasMap.get(normalized);
    if (!matches || matches.length === 0) {
      return { found: false };
    }
    if (matches.length === 1) {
      return { found: true, element: matches[0].element, page: matches[0].page };
    }
    return { found: false, ambiguous: true, matches };
  }

  // ---- Lookup by logical name or alias -------------------------------------

  lookup(nameOrAlias: string): CatalogLookupResult {
    const byName = this.lookupByLogicalName(nameOrAlias);
    if (byName.found) return byName;
    return this.lookupByAlias(nameOrAlias);
  }

  // ---- Check if element exists ---------------------------------------------

  hasElement(logicalName: string): boolean {
    return this.lookupByLogicalName(logicalName).found;
  }

  // ---- Check if page exists ------------------------------------------------

  hasPage(pageId: string): boolean {
    return this.catalog.pages.some(p => p.id === pageId);
  }

  // ---- Find page by ID or alias --------------------------------------------

  findPage(pageId: string): UIPageDefinition | undefined {
    return this.catalog.pages.find(p => p.id === pageId);
  }

  // ---- Get all element logical names ---------------------------------------

  getAllElementNames(): string[] {
    const names: string[] = [];
    for (const page of this.catalog.pages) {
      for (const element of page.elements) {
        names.push(element.logicalName);
      }
    }
    return names;
  }

  // ---- Validate a locator strategy is supported ----------------------------

  isSupportedStrategy(strategy: string): strategy is UILocatorStrategy {
    const valid: UILocatorStrategy[] = ['test-id', 'role', 'label', 'placeholder', 'text', 'css', 'xpath'];
    return valid.includes(strategy as UILocatorStrategy);
  }

  // ---- Build alias map from catalog ----------------------------------------

  private buildAliasMap(): Map<string, Array<{ page: UIPageDefinition; element: UIElementDefinition }>> {
    const map = new Map<string, Array<{ page: UIPageDefinition; element: UIElementDefinition }>>();

    for (const page of this.catalog.pages) {
      for (const element of page.elements) {
        // Add logical name (normalized)
        const normalizedName = element.logicalName.toLowerCase().trim();
        if (!map.has(normalizedName)) map.set(normalizedName, []);
        map.get(normalizedName)!.push({ page, element });

        // Add aliases from locator value (if it looks like a human-readable alias)
        // Note: aliases should be defined in catalog metadata, not derived from selectors
      }
    }

    return map;
  }
}

// ---- Create catalog from JSON ----------------------------------------------

export function createUICatalogResolver(catalog: UIElementCatalog): UICatalogResolver {
  return new UICatalogResolver(catalog);
}

// ---- Empty catalog for testing ---------------------------------------------

export function createEmptyCatalog(environmentId = 'test'): UIElementCatalog {
  return { environmentId, pages: [] };
}
