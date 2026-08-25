import type { AgenticActionType } from '../models.js';

export type FailureClassification =
  | 'TRANSIENT'
  | 'STALE_STATE'
  | 'NAVIGATION_DRIFT'
  | 'SESSION_LOST'
  | 'CONTEXT_LOST'
  | 'AMBIGUOUS_OUTCOME'
  | 'CAPABILITY_LOST'
  | 'PERMANENT'
  | 'UNSAFE_TO_RETRY';

export type RecoveryOperation =
  | 'REOBSERVE'
  | 'REGROUND'
  | 'REPLAN'
  | 'REAUTHENTICATE'
  | 'REOPEN_CONTEXT'
  | 'RECONCILE_OUTCOME'
  | 'ABORT_BLOCKED'
  | 'ABORT_ERROR';

export interface RecoveryDecision {
  classification: FailureClassification;
  operation: RecoveryOperation;
  allowed: boolean;
  reason: string;
}

export interface RecoveryEvent {
  classification: FailureClassification;
  operation: RecoveryOperation;
  attempt: number;
  stateBefore: string;
  stateAfter?: string;
  outcome: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  evidenceIds: string[];
}

const SAFE_REGROUND_ERRORS = /stale|detached|not found|cannot resolve|not visible|element.*closed/i;
const SESSION_ERRORS = /unauthenticated|authentication required|login|session expired|401/i;

export function classifyRuntimeFailure(error: string, actionType?: AgenticActionType): FailureClassification {
  if (SESSION_ERRORS.test(error)) return 'SESSION_LOST';
  if (SAFE_REGROUND_ERRORS.test(error)) return 'STALE_STATE';
  if (/timeout|timed out|temporar|network|fetch failed|ECONNRESET|socket|503|502|429/i.test(error)) {
    return actionType && !['click', 'fill', 'select', 'check', 'uncheck', 'press'].includes(actionType)
      ? 'TRANSIENT'
      : 'AMBIGUOUS_OUTCOME';
  }
  if (/closed|target page|browser context/i.test(error)) return 'CONTEXT_LOST';
  return 'PERMANENT';
}

export function decideRecovery(classification: FailureClassification, attempt: number, maxAttempts: number): RecoveryDecision {
  if (attempt >= maxAttempts) return { classification, operation: 'ABORT_BLOCKED', allowed: false, reason: 'Recovery budget exhausted.' };
  switch (classification) {
    case 'STALE_STATE':
      return { classification, operation: 'REGROUND', allowed: true, reason: 'Observation is stale; fresh observation and grounding are required.' };
    case 'TRANSIENT':
      return { classification, operation: 'REOBSERVE', allowed: true, reason: 'Transient read/observation failure may be retried once.' };
    case 'NAVIGATION_DRIFT':
      return { classification, operation: 'REPLAN', allowed: true, reason: 'Actual navigation state must drive replanning.' };
    case 'SESSION_LOST':
      return { classification, operation: 'REAUTHENTICATE', allowed: false, reason: 'Reauthentication requires an explicit protected capability.' };
    case 'AMBIGUOUS_OUTCOME':
      return { classification, operation: 'RECONCILE_OUTCOME', allowed: false, reason: 'Side-effect outcome is unknown; blind replay is forbidden.' };
    case 'CONTEXT_LOST':
      return { classification, operation: 'REOPEN_CONTEXT', allowed: false, reason: 'Context restoration is not available without trusted navigation state.' };
    case 'CAPABILITY_LOST':
      return { classification, operation: 'ABORT_BLOCKED', allowed: false, reason: 'Capability loss cannot escalate privileges.' };
    case 'UNSAFE_TO_RETRY':
      return { classification, operation: 'ABORT_BLOCKED', allowed: false, reason: 'Retry safety cannot be proven.' };
    default:
      return { classification, operation: 'ABORT_ERROR', allowed: false, reason: 'Failure is not recoverable by the journey layer.' };
  }
}
