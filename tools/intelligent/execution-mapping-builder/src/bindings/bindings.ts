// Execution Mapping Builder — Bindings catalog.
//
// Validates runtime binding references against the Test Data Plan / Data
// Resolver output. Prevents invention of binding values.

import type {
  BindingsCatalog,
  BindingDefinition,
  RuntimeBindingStore,
  SecretProvider,
} from '../models.js';

// ---- Binding resolver ------------------------------------------------------

export class BindingResolver {
  private readonly bindingNames: Set<string>;
  private readonly sensitiveNames: Set<string>;

  constructor(
    private readonly catalog: BindingsCatalog | null,
    private readonly runtimeStore?: RuntimeBindingStore,
    private readonly secretProvider?: SecretProvider,
    sensitiveNames?: string[],
  ) {
    this.bindingNames = new Set(catalog?.bindings.map(b => b.name) ?? []);
    this.sensitiveNames = new Set(sensitiveNames ?? []);
  }

  // ---- Check if a binding is known -----------------------------------------

  isKnown(bindingName: string): boolean {
    // Check catalog
    if (this.bindingNames.has(bindingName)) return true;
    // Check runtime store
    if (this.runtimeStore) {
      const result = this.runtimeStore.resolve(bindingName);
      if (result !== undefined) return true;
    }
    return false;
  }

  // ---- Check if a binding is sensitive -------------------------------------

  isSensitive(bindingName: string): boolean {
    return this.sensitiveNames.has(bindingName);
  }

  // ---- Get binding definition ----------------------------------------------

  getDefinition(bindingName: string): BindingDefinition | undefined {
    return this.catalog?.bindings.find(b => b.name === bindingName);
  }

  // ---- Get all known binding names -----------------------------------------

  getAllBindingNames(): string[] {
    return Array.from(this.bindingNames);
  }

  // ---- Validate a binding reference ----------------------------------------

  validateBinding(bindingName: string): { valid: boolean; reason?: string } {
    if (this.isKnown(bindingName)) {
      return { valid: true };
    }
    return { valid: false, reason: `Binding '${bindingName}' not found in catalog` };
  }

  // ---- Count required vs resolved ------------------------------------------

  countBindings(requiredBindings: string[]): { required: number; resolved: number } {
    let resolved = 0;
    for (const name of requiredBindings) {
      if (this.isKnown(name)) resolved++;
    }
    return { required: requiredBindings.length, resolved };
  }
}

// ---- Create empty catalog --------------------------------------------------

export function createEmptyBindingsCatalog(): BindingsCatalog {
  return { bindings: [] };
}

// ---- Create catalog from binding names -------------------------------------

export function createBindingsCatalog(names: string[], sensitiveNames?: string[]): BindingsCatalog {
  const sensitiveSet = new Set(sensitiveNames ?? []);
  return {
    bindings: names.map(name => ({
      name,
      type: sensitiveSet.has(name) ? 'secret' as const : 'runtime' as const,
    })),
  };
}
