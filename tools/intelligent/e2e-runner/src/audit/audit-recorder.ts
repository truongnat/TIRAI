// Audit trail — structured event recording (spec §73).

import type { RunnerAuditEvent, RunnerAuditEventType, RunnerAuditRecorder } from '../models.js';

export class InMemoryRunAuditRecorder implements RunnerAuditRecorder {
  private _events: RunnerAuditEvent[] = [];
  private seq = 0;

  record(type: RunnerAuditEventType, message: string, details?: Record<string, unknown>): void {
    this._events.push({
      sequence: this.seq++,
      type,
      timestamp: new Date().toISOString(),
      message,
      details,
    });
  }

  events(): RunnerAuditEvent[] {
    return [...this._events];
  }
}
