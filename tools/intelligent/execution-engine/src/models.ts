// ---------------------------------------------------------------------------
// Execution Engine – canonical data model
// ---------------------------------------------------------------------------
// Transforms Executable Data Preparation IR into Execution Result IR while
// enforcing policy, managing bindings, handling failures, cleanup, rollback,
// and producing a complete audit trail.  Default mode is dry-run — real
// mutation requires explicit triple-gate agreement (CLI flag + policy +
// resource allowlist).

import type {
  ExecutableDataPreparationIR,
  PreparationOperation,
  PreparationDependency,
  RuntimeBinding,
  ResolutionUnresolved,
  IdempotencyPolicy,
  PreparationAction,
} from 'data-resolver';

import type { TestProvenance } from 'test-data-planner';

// Re-export upstream types consumed by downstream code
export type {
  ExecutableDataPreparationIR,
  PreparationOperation,
  PreparationDependency,
  RuntimeBinding,
  ResolutionUnresolved,
  TestProvenance,
  IdempotencyPolicy,
};

// ---- Execution mode (spec §5) ---------------------------------------------

export type ExecutionMode = 'dry-run' | 'simulate' | 'execute';

// ---- Executor types (spec §12) --------------------------------------------

export type ExecutorType =
  | 'database'
  | 'api'
  | 'account'
  | 'file'
  | 'configuration'
  | 'state'
  | 'value-generator'
  | 'manual'
  | 'fake';

// ---- Execution policy (spec §9) -------------------------------------------

export interface ExecutionPolicy {
  mode: ExecutionMode;
  allowMutation: boolean;
  allowedResourceIds: string[];
  deniedResourceIds: string[];
  allowedExecutorTypes: ExecutorType[];
  requireDryRunFirst: boolean;
  maxOperations?: number;
  failFast: boolean;
  cleanupOnFailure: boolean;
  rollbackOnFailure: boolean;
  cleanupAfterSuccess?: boolean;
  maxConcurrency?: number;
  maxRetryAttempts?: number;
}

// ---- Operation status (spec §21) ------------------------------------------

export type OperationStatus =
  | 'pending'
  | 'validated'
  | 'skipped'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rolled-back'
  | 'cleanup-succeeded'
  | 'cleanup-failed'
  | 'manual'
  | 'blocked';

// ---- Execution result types (spec §22-23) ---------------------------------

export interface RuntimeBindingResult {
  id: string;
  name: string;
  producerOperationId: string;
  value: unknown;
  sensitive: boolean;
  status: 'resolved' | 'unresolved' | 'invalid';
}

export interface ExecutionErrorResult {
  code: string;
  message: string;
  retryable: boolean;
  executorType?: string;
}

export interface ExecutionWarning {
  code: string;
  message: string;
  operationId?: string;
}

export interface OperationExecutionResult {
  operationId: string;
  dataItemId: string;
  status: OperationStatus;
  executorType: ExecutorType;
  action: PreparationAction;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  producedBindings: RuntimeBindingResult[];
  warnings: ExecutionWarning[];
  error?: ExecutionErrorResult;
  provenance: TestProvenance[];
  retryCount: number;
}

// ---- Cleanup / Rollback summaries -----------------------------------------

export interface CleanupOperationResult {
  operationId: string;
  parentOperationId: string;
  status: 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  error?: ExecutionErrorResult;
}

export interface CleanupExecutionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  results: CleanupOperationResult[];
}

export interface RollbackOperationResult {
  operationId: string;
  parentOperationId: string;
  status: 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  error?: ExecutionErrorResult;
}

export interface RollbackExecutionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  results: RollbackOperationResult[];
}

// ---- Unresolved (spec §38) ------------------------------------------------

export interface ExecutionUnresolved {
  id: string;
  dataItemId: string;
  description: string;
  reason: string;
  provenance: TestProvenance[];
}

// ---- Audit trail (spec §39) -----------------------------------------------

export type AuditEventType =
  | 'execution-start'
  | 'policy-validation'
  | 'operation-start'
  | 'operation-end'
  | 'binding-produced'
  | 'cleanup-start'
  | 'cleanup-end'
  | 'rollback-start'
  | 'rollback-end'
  | 'execution-end';

export interface AuditEvent {
  sequence: number;
  type: AuditEventType;
  operationId?: string;
  timestamp: string;
  message: string;
}

// ---- Quality metrics (spec §60) -------------------------------------------

export interface ExecutionQualityMetrics {
  operationsTotal: number;
  validated: number;
  executed: number;
  succeeded: number;
  failed: number;
  blocked: number;
  manual: number;
  cleanupSucceeded: number;
  cleanupFailed: number;
  rollbackSucceeded: number;
  rollbackFailed: number;
  bindingsProduced: number;
  unresolvedBindings: number;
  provenanceCoverage: number;
}

// ---- Execution Result IR (spec §23) ---------------------------------------

export type ExecutionIRStatus =
  | 'validated'
  | 'succeeded'
  | 'partially-succeeded'
  | 'failed'
  | 'rolled-back';

export interface ExecutionResultIR {
  schemaVersion: '1.0';
  executionId: string;
  mode: ExecutionMode;
  status: ExecutionIRStatus;
  operations: OperationExecutionResult[];
  bindings: RuntimeBindingResult[];
  cleanup: CleanupExecutionSummary;
  rollback: RollbackExecutionSummary;
  unresolved: ExecutionUnresolved[];
  auditTrail: AuditEvent[];
  quality: ExecutionQualityMetrics;
}

// ---- Executor contract (spec §11) -----------------------------------------

export interface ExecutorMatch {
  supported: boolean;
  score: number;
  reasons: string[];
}

export interface ExecutionContext {
  mode: ExecutionMode;
  policy: ExecutionPolicy;
  bindings: RuntimeBindingStore;
  audit: AuditRecorder;
  seed?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ExecutionWarning[];
}

/**
 * Runtime binding store interface — the executor contract for storing and
 * retrieving produced values during execution.
 */
export interface RuntimeBindingStore {
  produce(binding: RuntimeBindingResult): void;
  resolve(name: string): RuntimeBindingResult | undefined;
  isResolved(name: string): boolean;
  all(): RuntimeBindingResult[];
  sensitiveNames(): Set<string>;
}

/**
 * Audit recorder interface — append-only event log for the execution trail.
 */
export interface AuditRecorder {
  record(event: Omit<AuditEvent, 'sequence' | 'timestamp'>): void;
  events(): AuditEvent[];
}

/**
 * Secret provider contract (spec §20).  For v1 only FakeSecretProvider is
 * used — no real secret manager integration.
 */
export interface SecretProvider {
  resolve(secretRef: string): Promise<SecretValue>;
}

export interface SecretValue {
  value: string;
  redacted: string;
}

// ---- Executor interface (spec §11) ----------------------------------------

export interface PreparationExecutor {
  readonly type: ExecutorType;
  canExecute(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): ExecutorMatch;
  validate(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<ValidationResult>;
  execute(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult>;
  cleanup?(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult>;
  rollback?(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult>;
}

// ---- Execution ID provider (spec §24) -------------------------------------

export interface ExecutionIdProvider {
  generate(): string;
}

// ---- Execution options ----------------------------------------------------

export interface ExecutionOptions {
  policy?: Partial<ExecutionPolicy>;
  secretProvider?: SecretProvider;
  executionIdProvider?: ExecutionIdProvider;
  seed?: string;
}

// ---- Manifest -------------------------------------------------------------

export interface ExecutionManifest {
  schemaVersion: '1.0';
  source: {
    executableDataPreparationIR: string;
  };
  mode: ExecutionMode;
  stats: {
    operationsTotal: number;
    succeeded: number;
    failed: number;
    blocked: number;
    manual: number;
    bindingsProduced: number;
    cleanupAttempted: number;
    rollbackAttempted: number;
    auditEvents: number;
  };
  warnings: ExecutionWarning[];
}
