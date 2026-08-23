// ---------------------------------------------------------------------------
// Database Executor – main executor implementation
// ---------------------------------------------------------------------------
// Implements the existing PreparationExecutor contract from Execution Engine.
// Converts database preparation operations into safe, parameterized database
// actions.  Real database mutation requires all safety gates to pass.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
  RuntimeBindingResult,
  ExecutionWarning,
  DatabasePreparationSpec,
  DatabaseExecutorOptions,
  DatabaseSession,
  CompiledOperation,
  ResourceMapping,
  DatabaseCatalog,
} from './models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from './errors.js';
import { compileDatabaseCommand } from './compiler/index.js';
import { validateDatabaseOperation } from './validation/operation-validator.js';
import { rejectDDL, rejectRawSql, validateMutationGate, validateWhereClause } from './validation/mutation-safety.js';
import { mapResultToBindings, mapReturningToBindings } from './mapping/result-mapper.js';

/**
 * DatabaseExecutor implements the PreparationExecutor contract for database
 * operations.  It compiles canonical DatabasePreparationSpec into parameterized
 * SQL commands and executes them through a DatabaseDriver.
 *
 * Safety: real database connections are only made in execute mode with all
 * gates passing.  Dry-run compiles only; simulate is not supported (falls
 * through to InMemoryDbExecutor in the Execution Engine).
 */
export class DatabaseExecutor implements PreparationExecutor {
  readonly type = 'database' as const;
  private readonly options: DatabaseExecutorOptions;

  /** Captured operations for test assertions. */
  readonly executedOps: PreparationOperation[] = [];
  readonly cleanedUpOps: PreparationOperation[] = [];
  readonly rolledBackOps: PreparationOperation[] = [];

  /** Metrics for acceptance reporting. */
  readonly metrics = {
    connectionsOpened: 0,
    queriesExecuted: 0,
    transactionsStarted: 0,
    totalDurationMs: 0,
  };

  constructor(options: DatabaseExecutorOptions = {}) {
    this.options = options;
  }

  // ---- PreparationExecutor contract ---------------------------------------

  canExecute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): ExecutorMatch {
    // Only handle database resolver operations
    if (operation.resolver !== 'database') {
      return { supported: false, score: 0, reasons: ['Not a database operation'] };
    }

    // Check if resolverSpec has database shape
    const spec = operation.resolverSpec as unknown as DatabasePreparationSpec | undefined;
    if (!spec || !spec.mode || !spec.entity) {
      return { supported: false, score: 0, reasons: ['Missing DatabasePreparationSpec'] };
    }

    // Derive mode doesn't need DB
    if (spec.mode === 'derive') {
      return { supported: false, score: 0.1, reasons: ['Derive mode handled by value generator'] };
    }

    return {
      supported: true,
      score: 0.9,
      reasons: [`Database ${spec.mode} on ${spec.entity}`],
    };
  }

  async validate(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<ValidationResult> {
    const catalog = this.getCatalog(operation.resourceId);
    const mapping = this.getMapping(operation);

    // Reject raw SQL in parameters
    try {
      rejectRawSql(operation.parameters, operation.id);
    } catch (err) {
      if (err instanceof DatabaseExecutorError) {
        return { valid: false, errors: [{ code: err.code, message: err.message, operationId: operation.id }] };
      }
      throw err;
    }

    return validateDatabaseOperation(operation, context, catalog, mapping);
  }

  async execute(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    const spec = operation.resolverSpec as unknown as DatabasePreparationSpec;
    const resourceId = operation.resourceId ?? '';

    // ---- Dry-run: compile only, no connections (spec §51) ----
    if (context.mode === 'dry-run') {
      return this.executeDryRun(operation, context, spec, resourceId, startedAt, startTime);
    }

    // ---- Simulate: should not reach here (spec §52) ----
    if (context.mode === 'simulate') {
      // In simulate mode, the Execution Engine should use InMemoryDbExecutor.
      // If DatabaseExecutor is called in simulate, treat as dry-run with warning.
      return this.executeDryRun(operation, context, spec, resourceId, startedAt, startTime);
    }

    // ---- Execute mode: real database (spec §53) ----
    return this.executeReal(operation, context, spec, resourceId, startedAt, startTime);
  }

  async cleanup(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    this.cleanedUpOps.push(operation);
    const startedAt = new Date().toISOString();

    // Cleanup in dry-run: just validate
    if (context.mode !== 'execute') {
      return this.buildResult(operation, 'cleanup-succeeded', startedAt, [], []);
    }

    // Execute mode: compile and run cleanup (typically a DELETE by PK)
    const spec = operation.resolverSpec as unknown as DatabasePreparationSpec | undefined;
    if (!spec) {
      return this.buildResult(operation, 'cleanup-failed', startedAt, [], [{
        code: DatabaseErrorCode.DB_CLEANUP_FAILED,
        message: `No resolverSpec for cleanup of ${operation.id}`,
        operationId: operation.id,
      }]);
    }

    try {
      const compiled = this.compileOperation(operation, spec, context);
      validateWhereClause(compiled.command, operation.id);
      rejectDDL(compiled.command, operation.id);

      // Execute cleanup through real DB
      const session = await this.connectOrThrow(operation.resourceId ?? '', context);
      try {
        await session.begin();
        const result = await session.query(compiled.command);
        await session.commit();

        context.audit.record({
          type: 'operation-end',
          operationId: operation.id,
          message: `Cleanup: ${result.rowCount} rows affected`,
        });
      } finally {
        await session.close();
      }

      return this.buildResult(operation, 'cleanup-succeeded', startedAt, [], []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.buildResult(operation, 'cleanup-failed', startedAt, [], [{
        code: DatabaseErrorCode.DB_CLEANUP_FAILED,
        message,
        operationId: operation.id,
      }]);
    }
  }

  async rollback(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    this.rolledBackOps.push(operation);
    const startedAt = new Date().toISOString();

    // In non-execute modes, rollback is a no-op success
    if (context.mode !== 'execute') {
      return this.buildResult(operation, 'rolled-back', startedAt, [], []);
    }

    // Execute mode: attempt compensating operation if planned
    // spec §31: use transaction rollback if still active, or compensating op
    try {
      const spec = operation.resolverSpec as unknown as DatabasePreparationSpec | undefined;
      if (!spec) {
        return this.buildResult(operation, 'rolled-back', startedAt, [], []);
      }

      // If cleanup operations are defined, they serve as the rollback
      if (operation.cleanupOperationIds.length > 0) {
        context.audit.record({
          type: 'rollback-end',
          operationId: operation.id,
          message: 'Rollback delegated to cleanup operations',
        });
      }

      return this.buildResult(operation, 'rolled-back', startedAt, [], []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.buildResult(operation, 'rolled-back', startedAt, [], [{
        code: DatabaseErrorCode.DB_TRANSACTION_FAILED,
        message,
        operationId: operation.id,
      }]);
    }
  }

  // ---- Dry-run execution (spec §51) ---------------------------------------

  private executeDryRun(
    operation: PreparationOperation,
    context: ExecutionContext,
    spec: DatabasePreparationSpec,
    resourceId: string,
    startedAt: string,
    startTime: number,
  ): OperationExecutionResult {
    // Compile only — no connections, no queries
    try {
      const compiled = this.compileOperation(operation, spec, context);

      // Record audit
      context.audit.record({
        type: 'operation-end',
        operationId: operation.id,
        message: `Dry-run: compiled ${compiled.command.kind} on ${compiled.command.metadata.table}`,
      });

      this.executedOps.push(operation);

      return this.buildResult(
        operation,
        'validated',
        startedAt,
        [],
        [],
        Date.now() - startTime,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof DatabaseExecutorError ? err.code : DatabaseErrorCode.DB_UNKNOWN_ERROR;
      return this.buildResult(
        operation,
        'failed',
        startedAt,
        [],
        [{ code, message, operationId: operation.id }],
        Date.now() - startTime,
      );
    }
  }

  // ---- Real execution (spec §53) ------------------------------------------

  private async executeReal(
    operation: PreparationOperation,
    context: ExecutionContext,
    spec: DatabasePreparationSpec,
    resourceId: string,
    startedAt: string,
    startTime: number,
  ): Promise<OperationExecutionResult> {
    // Safety gates (spec §2)
    try {
      validateMutationGate(context, resourceId, operation.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.buildResult(
        operation,
        'blocked',
        startedAt,
        [],
        [{ code: DatabaseErrorCode.DB_GATE_FAILURE, message, operationId: operation.id }],
        Date.now() - startTime,
      );
    }

    // Check connection config exists
    const config = this.options.connections?.get(resourceId);
    if (!config) {
      return this.buildResult(
        operation,
        'failed',
        startedAt,
        [],
        [{
          code: DatabaseErrorCode.DB_MISSING_CONFIG,
          message: `No connection config for resource "${resourceId}"`,
          operationId: operation.id,
        }],
        Date.now() - startTime,
      );
    }

    // Check allowConnection flag
    if (!this.options.allowConnection) {
      return this.buildResult(
        operation,
        'blocked',
        startedAt,
        [],
        [{
          code: DatabaseErrorCode.DB_GATE_FAILURE,
          message: 'Database connections not allowed (allowConnection=false)',
          operationId: operation.id,
        }],
        Date.now() - startTime,
      );
    }

    try {
      const compiled = this.compileOperation(operation, spec, context);
      validateWhereClause(compiled.command, operation.id);
      rejectDDL(compiled.command, operation.id);

      // Connect and execute
      const session = await this.connectOrThrow(resourceId, context);
      this.metrics.connectionsOpened++;

      try {
        // Mutating operations use a transaction
        if (compiled.isMutating) {
          await session.begin();
          this.metrics.transactionsStarted++;

          context.audit.record({
            type: 'operation-start',
            operationId: operation.id,
            message: `Transaction begin for ${compiled.command.kind}`,
          });
        }

        const queryResult = await session.query(compiled.command);
        this.metrics.queriesExecuted++;

        context.audit.record({
          type: 'operation-end',
          operationId: operation.id,
          message: `${compiled.command.kind}: ${queryResult.rowCount} rows`,
        });

        // Map results to bindings
        let producedBindings: RuntimeBindingResult[] = [];
        if (compiled.command.kind === 'select') {
          producedBindings = mapResultToBindings(
            queryResult,
            compiled.command,
            compiled.resultMappings,
            operation.id,
          );
        } else {
          producedBindings = mapReturningToBindings(
            queryResult,
            compiled.resultMappings,
            operation.id,
          );
        }

        // Produce bindings into the store
        for (const binding of producedBindings) {
          context.bindings.produce(binding);
          context.audit.record({
            type: 'binding-produced',
            operationId: operation.id,
            message: `Binding: ${binding.name}`,
          });
        }

        // Commit if mutating
        if (compiled.isMutating) {
          await session.commit();
          context.audit.record({
            type: 'operation-end',
            operationId: operation.id,
            message: 'Transaction committed',
          });
        }

        this.executedOps.push(operation);

        return this.buildResult(
          operation,
          'succeeded',
          startedAt,
          producedBindings,
          [],
          Date.now() - startTime,
        );
      } catch (err) {
        // Rollback on failure
        if (compiled.isMutating) {
          try {
            await session.rollback();
            context.audit.record({
              type: 'rollback-end',
              operationId: operation.id,
              message: 'Transaction rolled back on error',
            });
          } catch {
            // Swallow rollback errors
          }
        }
        throw err;
      } finally {
        await session.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof DatabaseExecutorError ? err.code : DatabaseErrorCode.DB_UNKNOWN_ERROR;

      return this.buildResult(
        operation,
        'failed',
        startedAt,
        [],
        [{ code, message, operationId: operation.id }],
        Date.now() - startTime,
      );
    }
  }

  // ---- Helpers ------------------------------------------------------------

  private compileOperation(
    operation: PreparationOperation,
    spec: DatabasePreparationSpec,
    context: ExecutionContext,
  ): CompiledOperation {
    const catalog = this.getCatalog(operation.resourceId);
    const mapping = this.getMapping(operation);

    const { command, resultMappings, isMutating } = compileDatabaseCommand(spec, {
      operationId: operation.id,
      resourceId: operation.resourceId ?? '',
      catalog,
      resourceMapping: mapping,
      context,
    });

    return { command, spec, resultMappings, isMutating };
  }

  private async connectOrThrow(
    resourceId: string,
    context: ExecutionContext,
  ): Promise<DatabaseSession> {
    const config = this.options.connections?.get(resourceId);
    if (!config) {
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_MISSING_CONFIG,
        message: `No connection configuration for resource "${resourceId}"`,
      });
    }

    // Resolve secrets
    const driverModule = await import('./driver/driver.js');
    const secrets = await driverModule.resolveSecrets(config, this.options.secretProvider);

    // Import PostgreSQL driver
    const pgModule = await import('./driver/postgres-driver.js');
    const driver = new pgModule.PostgreSQLDriver();

    try {
      const session = await driver.connect(config, secrets);

      context.audit.record({
        type: 'operation-start',
        operationId: '__db_connection',
        message: `Connected to ${config.dialect} resource ${resourceId}`,
      });

      return session;
    } catch (err) {
      context.audit.record({
        type: 'operation-end',
        operationId: '__db_connection',
        message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  private getCatalog(resourceId?: string): DatabaseCatalog | undefined {
    if (!resourceId || !this.options.catalogs) return undefined;
    return this.options.catalogs.get(resourceId);
  }

  private getMapping(operation: PreparationOperation): ResourceMapping | undefined {
    if (!this.options.resourceMappings || !operation.resourceId) return undefined;
    return this.options.resourceMappings.find(
      m => m.logicalEntity === (operation.resolverSpec as unknown as DatabasePreparationSpec)?.entity
        && m.resourceId === operation.resourceId,
    );
  }

  private buildResult(
    operation: PreparationOperation,
    status: OperationExecutionResult['status'],
    startedAt: string,
    producedBindings: RuntimeBindingResult[],
    warnings: ExecutionWarning[],
    durationMs?: number,
  ): OperationExecutionResult {
    const finishedAt = new Date().toISOString();

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status,
      executorType: 'database',
      action: operation.action,
      startedAt,
      finishedAt,
      durationMs: durationMs ?? (Date.now() - new Date(startedAt).getTime()),
      producedBindings,
      warnings,
      provenance: operation.provenance,
      retryCount: 0,
    };
  }
}
