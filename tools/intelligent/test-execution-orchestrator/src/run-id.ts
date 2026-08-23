// Test Execution Orchestrator v1 — Run ID provider.
//
// Production uses unique IDs, tests use deterministic IDs.

import type { RunIdProvider } from './models.js';

export class UniqueRunIdProvider implements RunIdProvider {
  private counter = 0;

  generate(): string {
    this.counter++;
    const ts = Date.now().toString(36);
    const seq = this.counter.toString(36).padStart(4, '0');
    return `RUN-${ts}-${seq}`;
  }
}

export class DeterministicRunIdProvider implements RunIdProvider {
  private counter = 0;
  private prefix: string;

  constructor(prefix = 'RUN') {
    this.prefix = prefix;
  }

  generate(): string {
    this.counter++;
    return `${this.prefix}-${String(this.counter).padStart(4, '0')}`;
  }
}
