// ---------------------------------------------------------------------------
// Database Executor – test helpers
// ---------------------------------------------------------------------------

import type {
  PreparationOperation,
  ExecutionContext,
  DatabasePreparationSpec,
  DatabaseCatalog,
  DatabaseConnectionConfig,
  ResourceMapping,
  RuntimeBindingResult,
  ExecutionPolicy,
  AuditRecorder,
  AuditEvent,
  RuntimeBindingStore,
  DataConstraint,
  DataValueExpression,
} from '../src/models.js';

// ---- Minimal builders -----------------------------------------------------

let opCounter = 0;
export function resetCounters(): void { opCounter = 0; }

export function minimalSpec(overrides?: Partial<DatabasePreparationSpec>): DatabasePreparationSpec {
  return {
    mode: 'select',
    entity: 'users',
    criteria: [],
    values: [],
    bindings: ['runtime.userId'],
    ...overrides,
  };
}

export function minimalOperation(overrides?: Partial<PreparationOperation>): PreparationOperation {
  opCounter++;
  const spec = minimalSpec();
  return {
    id: `OP-${String(opCounter).padStart(4, '0')}`,
    dataItemId: `DATA-${String(opCounter).padStart(4, '0')}`,
    resolver: 'database',
    action: 'select',
    resourceId: 'res-db-1',
    parameters: {},
    produces: ['runtime.userId'],
    consumes: [],
    cleanupOperationIds: [],
    provenance: [{ source: 'test', step: 'fixture' }],
    confidence: 0.8,
    resolverSpec: spec as unknown as Record<string, unknown>,
    ...overrides,
  };
}

export function minimalContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    mode: 'dry-run',
    policy: minimalPolicy(),
    bindings: new FakeBindingStore(),
    audit: new FakeAuditRecorder(),
    ...overrides,
  };
}

export function minimalPolicy(overrides?: Partial<ExecutionPolicy>): ExecutionPolicy {
  return {
    mode: 'dry-run',
    allowMutation: false,
    allowedResourceIds: ['res-db-1'],
    deniedResourceIds: [],
    allowedExecutorTypes: ['database'],
    requireDryRunFirst: true,
    failFast: true,
    cleanupOnFailure: true,
    rollbackOnFailure: true,
    ...overrides,
  };
}

export function minimalCatalog(): DatabaseCatalog {
  return {
    resourceId: 'res-db-1',
    schemas: [{
      name: 'public',
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', dataType: 'uuid', nullable: false },
          { name: 'username', dataType: 'varchar', nullable: false },
          { name: 'email', dataType: 'varchar', nullable: false },
          { name: 'status', dataType: 'varchar', nullable: true },
          { name: 'password_hash', dataType: 'varchar', nullable: false },
          { name: 'created_at', dataType: 'timestamp', nullable: false },
        ],
        primaryKey: ['id'],
        uniqueConstraints: [['username'], ['email']],
      }, {
        name: 'sessions',
        columns: [
          { name: 'id', dataType: 'uuid', nullable: false },
          { name: 'user_id', dataType: 'uuid', nullable: false },
          { name: 'token', dataType: 'varchar', nullable: false },
          { name: 'expires_at', dataType: 'timestamp', nullable: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [{
          columns: ['user_id'],
          referencedTable: 'users',
          referencedColumns: ['id'],
        }],
      }],
    }],
  };
}

export function minimalMapping(): ResourceMapping {
  return {
    logicalEntity: 'users',
    resourceId: 'res-db-1',
    fieldMappings: {
      '__table': 'users',
      '__schema': 'public',
    },
  };
}

export function minimalConnectionConfig(): DatabaseConnectionConfig {
  return {
    resourceId: 'res-db-1',
    dialect: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    userSecretRef: 'db-user',
    passwordSecretRef: 'db-password',
  };
}

// ---- Fake binding store ---------------------------------------------------

export class FakeBindingStore implements RuntimeBindingStore {
  private readonly store = new Map<string, RuntimeBindingResult>();

  produce(binding: RuntimeBindingResult): void {
    this.store.set(binding.name, binding);
  }

  resolve(name: string): RuntimeBindingResult | undefined {
    return this.store.get(name);
  }

  isResolved(name: string): boolean {
    return this.store.has(name);
  }

  all(): RuntimeBindingResult[] {
    return [...this.store.values()];
  }

  sensitiveNames(): Set<string> {
    const result = new Set<string>();
    for (const [name, b] of this.store) {
      if (b.sensitive) result.add(name);
    }
    return result;
  }
}

// ---- Fake audit recorder --------------------------------------------------

export class FakeAuditRecorder implements AuditRecorder {
  private readonly _events: AuditEvent[] = [];
  private seq = 0;

  record(event: Omit<AuditEvent, 'sequence' | 'timestamp'>): void {
    this.seq++;
    this._events.push({
      ...event,
      sequence: this.seq,
      timestamp: new Date().toISOString(),
    });
  }

  events(): AuditEvent[] {
    return [...this._events];
  }
}

// ---- Constraint/value helpers ---------------------------------------------

export function constraint(
  field: string,
  operator: string,
  value: unknown,
): DataConstraint {
  return {
    type: 'value',
    field,
    operator,
    value,
    description: `${field} ${operator} ${value}`,
    provenance: [{ source: 'test', step: 'fixture' }],
  };
}

export function literalValue(value: unknown, field?: string): DataValueExpression {
  return {
    type: 'literal',
    value,
    arguments: field ? [field] : undefined,
  };
}

export function bindingValue(binding: string): DataValueExpression {
  return {
    type: 'binding',
    binding,
  };
}
