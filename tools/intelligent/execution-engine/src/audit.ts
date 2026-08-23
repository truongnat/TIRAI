// ---------------------------------------------------------------------------
// Execution Engine – audit trail
// ---------------------------------------------------------------------------
// Append-only structured event log.  Records execution lifecycle events
// with sequence numbers and deterministic timestamps for dry-run, and
// real timestamps for simulate/execute modes.

import type { AuditEvent, AuditRecorder, AuditEventType } from './models.js';

/**
 * Default audit recorder.  Maintains an ordered list of audit events
 * with auto-incrementing sequence numbers.
 */
export class DefaultAuditRecorder implements AuditRecorder {
  private readonly _events: AuditEvent[] = [];
  private sequence = 0;
  private readonly fixedTimestamp: string | undefined;

  /**
   * @param fixedTimestamp  When provided, all events use this timestamp
   *   instead of Date.now().  Useful for deterministic testing.
   */
  constructor(fixedTimestamp?: string) {
    this.fixedTimestamp = fixedTimestamp;
  }

  record(event: Omit<AuditEvent, 'sequence' | 'timestamp'>): void {
    this._events.push({
      ...event,
      sequence: this.sequence++,
      timestamp: this.fixedTimestamp ?? new Date().toISOString(),
    });
  }

  events(): AuditEvent[] {
    return [...this._events];
  }

  /** Count of recorded events. */
  get size(): number {
    return this._events.length;
  }
}

/** Helper to create a typed audit event (without sequence/timestamp). */
export function auditEvent(
  type: AuditEventType,
  message: string,
  operationId?: string,
): Omit<AuditEvent, 'sequence' | 'timestamp'> {
  return { type, message, operationId };
}
