// Test Execution Orchestrator v1 — Clock abstraction.
//
// Avoids direct Date.now() in domain logic. Production uses SystemClock,
// tests use FixedClock for deterministic timestamps.

import type { Clock } from './models.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return new Date().toISOString();
  }
}

export class FixedClock implements Clock {
  private fixed: Date;

  constructor(isoOrDate: string | Date) {
    this.fixed = typeof isoOrDate === 'string' ? new Date(isoOrDate) : new Date(isoOrDate);
  }

  now(): Date {
    return new Date(this.fixed.getTime());
  }

  nowIso(): string {
    return this.fixed.toISOString();
  }
}
