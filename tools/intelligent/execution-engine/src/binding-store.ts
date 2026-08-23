// ---------------------------------------------------------------------------
// Execution Engine – runtime binding store
// ---------------------------------------------------------------------------
// Stores produced values during execution, retrieves consumed values,
// protects sensitive data from serialization, and validates duplicate
// bindings.

import type { RuntimeBindingStore, RuntimeBindingResult } from './models.js';

const REDACTED = '***REDACTED***';

/**
 * In-memory runtime binding store.  Tracks produced values, protects
 * sensitive bindings from raw serialization, and supports resolution
 * checks for dependency validation.
 */
export class InMemoryBindingStore implements RuntimeBindingStore {
  private readonly store = new Map<string, RuntimeBindingResult>();

  produce(binding: RuntimeBindingResult): void {
    this.store.set(binding.name, binding);
  }

  resolve(name: string): RuntimeBindingResult | undefined {
    return this.store.get(name);
  }

  isResolved(name: string): boolean {
    const entry = this.store.get(name);
    return entry !== undefined && entry.status === 'resolved';
  }

  all(): RuntimeBindingResult[] {
    return [...this.store.values()];
  }

  sensitiveNames(): Set<string> {
    const result = new Set<string>();
    for (const [name, binding] of this.store) {
      if (binding.sensitive) result.add(name);
    }
    return result;
  }

  /** Return a safe-for-serialization copy with sensitive values redacted. */
  safeSnapshot(): RuntimeBindingResult[] {
    return this.all().map((b) =>
      b.sensitive ? { ...b, value: REDACTED } : b,
    );
  }

  /** Count of all stored bindings. */
  get size(): number {
    return this.store.size;
  }
}
