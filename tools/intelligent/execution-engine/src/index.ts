// ---------------------------------------------------------------------------
// Execution Engine – barrel export
// ---------------------------------------------------------------------------

// Engine
export { executePreparation, buildManifest } from './engine.js';

// Policy
export { PolicyEngine, defaultPolicy, mergePolicy, validateExecuteGate } from './policy.js';

// Registry
export { registerExecutor, getExecutor, listExecutors, findBestExecutor, clearRegistry } from './registry.js';

// Executors
export { FakeExecutor, InMemoryDbExecutor, ValueGeneratorExecutor, ManualExecutor } from './executors/index.js';
export type { FakeExecutorConfig } from './executors/index.js';

// Binding store
export { InMemoryBindingStore } from './binding-store.js';

// Audit
export { DefaultAuditRecorder, auditEvent } from './audit.js';

// Scheduler
export { topologicalExecutionOrder, detectExecutionCycles, getDependents, getPredecessors } from './scheduler.js';

// Cleanup / Rollback
export { executeCleanup } from './cleanup/cleanup-handler.js';
export { executeRollback } from './rollback/rollback-handler.js';

// Validation
export { validateExecutionInput } from './validation/input-validator.js';

// Quality
export { computeExecutionQuality } from './quality/metrics.js';

// Persistence
export { writeOutput, loadOutput } from './persistence/output-writer.js';

// Errors / Warnings
export { ExecutionEngineError, ExecutionErrorCode } from './errors.js';
export { ExecutionWarningCode } from './warnings.js';

// Models
export type {
  ExecutionMode,
  ExecutorType,
  ExecutionPolicy,
  OperationStatus,
  RuntimeBindingResult,
  ExecutionErrorResult,
  ExecutionWarning,
  OperationExecutionResult,
  CleanupOperationResult,
  CleanupExecutionSummary,
  RollbackOperationResult,
  RollbackExecutionSummary,
  ExecutionUnresolved,
  AuditEvent,
  AuditEventType,
  ExecutionQualityMetrics,
  ExecutionIRStatus,
  ExecutionResultIR,
  ExecutorMatch,
  ExecutionContext,
  ValidationResult,
  RuntimeBindingStore,
  AuditRecorder,
  SecretProvider,
  SecretValue,
  PreparationExecutor,
  ExecutionIdProvider,
  ExecutionOptions,
  ExecutionManifest,
  ExecutableDataPreparationIR,
  PreparationOperation,
  PreparationDependency,
  RuntimeBinding,
  ResolutionUnresolved,
  TestProvenance,
  IdempotencyPolicy,
} from './models.js';
