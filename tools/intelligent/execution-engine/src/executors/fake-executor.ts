// ---------------------------------------------------------------------------
// Execution Engine – fake executor
// ---------------------------------------------------------------------------
// Configurable test double for PreparationExecutor.  Supports configurable
// results, delays, failures, request capture, and cleanup/rollback capture.
// Powers most unit and acceptance tests.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
  ExecutorType,
  RuntimeBindingResult,
} from '../models.js';

export interface FakeExecutorConfig {
  /** When set, the executor will fail with this error on execute. */
  failWith?: { code: string; message: string; retryable: boolean };
  /** Number of attempts before success (for retry testing). */
  failUntilAttempt?: number;
  /** Simulated execution delay in ms. */
  delayMs?: number;
  /** Bindings this executor will produce on success. */
  producedBindings?: RuntimeBindingResult[];
  /** Whether cleanup is supported. */
  supportsCleanup?: boolean;
  /** Whether rollback is supported. */
  supportsRollback?: boolean;
  /** Cleanup failure simulation. */
  cleanupFails?: boolean;
  /** Rollback failure simulation. */
  rollbackFails?: boolean;
}

/**
 * FakeExecutor is a fully configurable test double.  It captures every
 * execute/cleanup/rollback call for later assertion and supports failure
 * simulation, retry testing, and binding production.
 */
export class FakeExecutor implements PreparationExecutor {
  readonly type: ExecutorType;
  private attemptCount = 0;
  private readonly config: FakeExecutorConfig;

  /** Captured operations for test assertions. */
  readonly executedOps: PreparationOperation[] = [];
  readonly cleanedUpOps: PreparationOperation[] = [];
  readonly rolledBackOps: PreparationOperation[] = [];

  constructor(type: ExecutorType = 'fake', config: FakeExecutorConfig = {}) {
    this.type = type;
    this.config = config;
  }

  canExecute(
    _operation: PreparationOperation,
    _context: ExecutionContext,
  ): ExecutorMatch {
    return { supported: true, score: 0.5, reasons: ['fake-executor'] };
  }

  async validate(
    _operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async execute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    this.attemptCount++;
    this.executedOps.push(operation);

    if (this.config.delayMs) {
      await delay(this.config.delayMs);
    }

    // Simulate failure
    if (this.config.failWith) {
      const shouldFail = this.config.failUntilAttempt
        ? this.attemptCount < this.config.failUntilAttempt
        : true;
      if (shouldFail) {
        return {
          operationId: operation.id,
          dataItemId: operation.dataItemId,
          status: 'failed',
          executorType: this.type,
          action: operation.action,
          producedBindings: [],
          warnings: [],
          error: {
            code: this.config.failWith.code,
            message: this.config.failWith.message,
            retryable: this.config.failWith.retryable,
            executorType: this.type,
          },
          provenance: operation.provenance,
          retryCount: this.attemptCount - 1,
        };
      }
    }

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: this.type,
      action: operation.action,
      producedBindings: this.config.producedBindings ?? [],
      warnings: [],
      provenance: operation.provenance,
      retryCount: this.attemptCount - 1,
    };
  }

  async cleanup(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    this.cleanedUpOps.push(operation);

    if (this.config.cleanupFails) {
      return {
        operationId: operation.id,
        dataItemId: operation.dataItemId,
        status: 'failed',
        executorType: this.type,
        action: operation.action,
        producedBindings: [],
        warnings: [],
        error: {
          code: 'CLEANUP_FAILED',
          message: 'Simulated cleanup failure',
          retryable: false,
          executorType: this.type,
        },
        provenance: operation.provenance,
        retryCount: 0,
      };
    }

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: this.type,
      action: operation.action,
      producedBindings: [],
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  async rollback(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    this.rolledBackOps.push(operation);

    if (this.config.rollbackFails) {
      return {
        operationId: operation.id,
        dataItemId: operation.dataItemId,
        status: 'failed',
        executorType: this.type,
        action: operation.action,
        producedBindings: [],
        warnings: [],
        error: {
          code: 'ROLLBACK_FAILED',
          message: 'Simulated rollback failure',
          retryable: false,
          executorType: this.type,
        },
        provenance: operation.provenance,
        retryCount: 0,
      };
    }

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: this.type,
      action: operation.action,
      producedBindings: [],
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  /** Reset attempt counter (for reuse across tests). */
  resetAttempts(): void {
    this.attemptCount = 0;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
