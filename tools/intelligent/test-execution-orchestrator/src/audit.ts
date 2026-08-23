// Test Execution Orchestrator v1 — Audit recorder.
//
// Sequential audit events for test run tracing.

import type { TestRunAuditRecorder, TestRunAuditEvent } from './models.js';

export class InMemoryTestRunAuditRecorder implements TestRunAuditRecorder {
  private _events: TestRunAuditEvent[] = [];
  private sequence = 0;

  record(event: Omit<TestRunAuditEvent, 'sequence' | 'timestamp'>): void {
    this.sequence++;
    this._events.push({
      ...event,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
    });
  }

  events(): TestRunAuditEvent[] {
    return [...this._events];
  }

  reset(): void {
    this._events = [];
    this.sequence = 0;
  }
}
