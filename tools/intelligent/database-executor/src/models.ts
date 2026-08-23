// ---------------------------------------------------------------------------
// Database Executor – canonical data model
// ---------------------------------------------------------------------------
// Converts database preparation operations into safe, parameterized database
// actions.  Implements the existing PreparationExecutor contract from
// Execution Engine.  PostgreSQL is the first supported dialect.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
  RuntimeBindingResult,
  ExecutionErrorResult,
  ExecutionWarning,
  AuditRecorder,
  SecretProvider,
} from 'execution-engine';

import type {
  DatabasePreparationSpec,
  DatabaseOperationMode,
  DataValueExpression,
  ResourceMapping,
  EnvironmentProfile,
} from 'data-resolver';

import type {
  DataConstraint,
} from 'test-data-planner';

// Re-export upstream types consumed by downstream code
export type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
  RuntimeBindingResult,
  ExecutionErrorResult,
  ExecutionWarning,
  AuditRecorder,
  SecretProvider,
  DatabasePreparationSpec,
  DatabaseOperationMode,
  DataConstraint,
  DataValueExpression,
  ResourceMapping,
  EnvironmentProfile,
};

// ---- Database dialect (spec §12) ------------------------------------------

export type DatabaseDialect = 'postgresql';

// ---- Database command (spec §7) -------------------------------------------

export type DatabaseCommandKind = 'select' | 'insert' | 'update' | 'delete';

export type ExpectedResult = 'zero-or-one' | 'one' | 'many' | 'affected-rows';

export interface DatabaseCommand {
  kind: DatabaseCommandKind;
  text: string;
  parameters: unknown[];
  expectedResult: ExpectedResult;
  metadata: DatabaseCommandMetadata;
}

export interface DatabaseCommandMetadata {
  resourceId: string;
  schema?: string;
  table: string;
  columns: string[];
  returningColumns?: string[];
  operationId: string;
  parameterBindings: ParameterBinding[];
}

export interface ParameterBinding {
  position: number;
  bindingName?: string;
  value: unknown;
  sensitive: boolean;
}

// ---- Database driver contract (spec §13) ----------------------------------

export interface DatabaseDriver {
  readonly dialect: DatabaseDialect;
  connect(config: DatabaseConnectionConfig, secrets: ResolvedSecrets): Promise<DatabaseSession>;
  healthCheck(config: DatabaseConnectionConfig, secrets: ResolvedSecrets): Promise<HealthCheckResult>;
}

export interface DatabaseSession {
  query(command: DatabaseCommand): Promise<DatabaseQueryResult>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  command: DatabaseCommandKind;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

// ---- Connection configuration (spec §14) ----------------------------------

export interface DatabaseConnectionConfig {
  resourceId: string;
  dialect: DatabaseDialect;
  host?: string;
  port?: number;
  database?: string;
  userSecretRef?: string;
  passwordSecretRef?: string;
  connectionStringSecretRef?: string;
  ssl?: boolean;
  queryTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export interface ResolvedSecrets {
  user?: string;
  password?: string;
  connectionString?: string;
}

// ---- Database catalog (spec §37) ------------------------------------------

export interface DatabaseCatalog {
  resourceId: string;
  schemas: DatabaseSchemaMetadata[];
}

export interface DatabaseSchemaMetadata {
  name: string;
  tables: DatabaseTableMetadata[];
}

export interface DatabaseTableMetadata {
  name: string;
  columns: DatabaseColumnMetadata[];
  primaryKey?: string[];
  uniqueConstraints?: string[][];
  foreignKeys?: DatabaseForeignKeyMetadata[];
}

export interface DatabaseColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
}

export interface DatabaseForeignKeyMetadata {
  columns: string[];
  referencedSchema?: string;
  referencedTable: string;
  referencedColumns: string[];
}

// ---- Database executor options --------------------------------------------

export interface DatabaseExecutorOptions {
  /** Connection configurations keyed by resourceId. */
  connections?: Map<string, DatabaseConnectionConfig>;
  /** Secret provider for resolving credential references. */
  secretProvider?: SecretProvider;
  /** Database catalogs for identifier validation. */
  catalogs?: Map<string, DatabaseCatalog>;
  /** Resource mappings for entity→table resolution. */
  resourceMappings?: ResourceMapping[];
  /** Environment profile for resource resolution. */
  environment?: EnvironmentProfile;
  /** Whether to allow real database connections in execute mode. */
  allowConnection?: boolean;
  /** Query timeout override in ms. */
  queryTimeoutMs?: number;
  /** Connection timeout override in ms. */
  connectionTimeoutMs?: number;
  /** Whether to log full SQL text (default: false for safety). */
  logSql?: boolean;
}

// ---- Database audit event types -------------------------------------------

export type DatabaseAuditEventType =
  | 'db-validation'
  | 'db-connection-opened'
  | 'db-transaction-begin'
  | 'db-command-executed'
  | 'db-rows-affected'
  | 'db-binding-produced'
  | 'db-transaction-commit'
  | 'db-transaction-rollback'
  | 'db-connection-closed'
  | 'db-connection-failed';

// ---- Result mapper types (spec §49) ---------------------------------------

export interface ResultMappingSpec {
  /** Column name in the database result. */
  sourceColumn: string;
  /** Binding name to produce (e.g. runtime.userId). */
  targetBinding: string;
  /** Whether this field is sensitive. */
  sensitive?: boolean;
}

// ---- Compiled operation (internal) ----------------------------------------

export interface CompiledOperation {
  command: DatabaseCommand;
  spec: DatabasePreparationSpec;
  resultMappings: ResultMappingSpec[];
  isMutating: boolean;
}
