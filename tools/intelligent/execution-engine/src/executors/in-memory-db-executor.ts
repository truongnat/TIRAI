// ---------------------------------------------------------------------------
// Execution Engine – in-memory database executor
// ---------------------------------------------------------------------------
// Simulates database operations against a Map-based store.  Supports
// select, create, derive, delete, and restore — no SQL, no real DB.
// Purpose: prove DB lifecycle semantics safely in simulate mode.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
  RuntimeBindingResult,
} from '../models.js';

/** In-memory record store keyed by entity → id → record. */
type RecordStore = Map<string, Map<string, Record<string, unknown>>>;

/**
 * In-memory database executor.  Maintains a Map-of-Maps store and
 * simulates CRUD operations without any real database connection.
 */
export class InMemoryDbExecutor implements PreparationExecutor {
  readonly type = 'database' as const;
  private readonly store: RecordStore = new Map();
  private idCounter = 0;

  canExecute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): ExecutorMatch {
    if (operation.resolver !== 'database') {
      return { supported: false, score: 0, reasons: ['not-database'] };
    }
    return { supported: true, score: 0.8, reasons: ['in-memory-db'] };
  }

  async validate(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<ValidationResult> {
    if (operation.resolver !== 'database') {
      return { valid: false, errors: [{ code: 'INVALID_OP', message: 'Not a database operation' }] };
    }
    return { valid: true, errors: [] };
  }

  async execute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const entity = String(operation.parameters.entity ?? `entity:${operation.dataItemId}`);
    const action = operation.action;

    switch (action) {
      case 'create':
        return this.handleCreate(operation, entity);
      case 'select':
        return this.handleSelect(operation, entity);
      case 'derive':
        return this.handleDerive(operation, entity);
      case 'manual':
        return this.handleManual(operation);
      default:
        return this.handleSelect(operation, entity);
    }
  }

  async cleanup(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const entity = String(operation.parameters.entity ?? `entity:${operation.dataItemId}`);
    const entityStore = this.store.get(entity);
    if (entityStore) {
      // Remove the record created by this operation
      for (const [id] of entityStore) {
        if (id.startsWith(operation.dataItemId)) {
          entityStore.delete(id);
          break;
        }
      }
    }
    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: 'database',
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
    // Same as cleanup for in-memory DB
    return this.cleanup(operation, _context);
  }

  /** Get a snapshot of the current store (for testing). */
  getStoreSnapshot(): Record<string, Record<string, unknown>[]> {
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const [entity, entityStore] of this.store) {
      result[entity] = [...entityStore.values()];
    }
    return result;
  }

  /** Reset the store (for testing). */
  reset(): void {
    this.store.clear();
    this.idCounter = 0;
  }

  private handleCreate(
    operation: PreparationOperation,
    entity: string,
  ): OperationExecutionResult {
    if (!this.store.has(entity)) this.store.set(entity, new Map());
    const id = `${operation.dataItemId}-${++this.idCounter}`;
    const record: Record<string, unknown> = {
      _id: id,
      _operationId: operation.id,
      ...(operation.parameters.values as Record<string, unknown> ?? {}),
    };
    this.store.get(entity)!.set(id, record);

    const binding: RuntimeBindingResult = {
      id: `BIND-${operation.id}`,
      name: `runtime.${operation.dataItemId}`,
      producerOperationId: operation.id,
      value: record,
      sensitive: false,
      status: 'resolved',
    };

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: 'database',
      action: 'create',
      producedBindings: [binding],
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private handleSelect(
    operation: PreparationOperation,
    entity: string,
  ): OperationExecutionResult {
    const entityStore = this.store.get(entity);
    const records = entityStore ? [...entityStore.values()] : [];

    const binding: RuntimeBindingResult = {
      id: `BIND-${operation.id}`,
      name: `runtime.${operation.dataItemId}`,
      producerOperationId: operation.id,
      value: records.length > 0 ? records[0] : { _simulated: true, entity },
      sensitive: false,
      status: 'resolved',
    };

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: 'database',
      action: 'select',
      producedBindings: [binding],
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private handleDerive(
    operation: PreparationOperation,
    entity: string,
  ): OperationExecutionResult {
    // Derive creates a new record based on consumed bindings
    return this.handleCreate(operation, entity);
  }

  private handleManual(operation: PreparationOperation): OperationExecutionResult {
    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'manual',
      executorType: 'database',
      action: operation.action,
      producedBindings: [],
      warnings: [{ code: 'EXECUTION_MANUAL_OPERATION', message: 'Manual database operation required', operationId: operation.id }],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }
}
