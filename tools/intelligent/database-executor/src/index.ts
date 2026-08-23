// ---------------------------------------------------------------------------
// Database Executor – barrel export
// ---------------------------------------------------------------------------

// Main executor
export { DatabaseExecutor } from './database-executor.js';

// Compiler
export { compileDatabaseCommand, validateIdentifier, quoteIdentifier, buildAllowedSet, resolveValueExpression } from './compiler/index.js';
export type { CompilerOptions } from './compiler/index.js';

// Driver
export { PostgreSQLDriver, resolveSecrets } from './driver/index.js';
export type { DatabaseDriver, DatabaseSession, DatabaseDialect } from './driver/index.js';

// Mapping
export { mapResultToBindings, mapReturningToBindings } from './mapping/index.js';

// Validation
export { validateDatabaseOperation, rejectDDL, rejectRawSql, validateMutationGate, validateWhereClause } from './validation/index.js';

// Errors
export { DatabaseExecutorError, DatabaseErrorCode } from './errors.js';
export type { DatabaseErrorCodeType } from './errors.js';

// Models
export type {
  DatabaseCommand,
  DatabaseCommandKind,
  DatabaseCommandMetadata,
  ExpectedResult,
  ParameterBinding,
  DatabaseConnectionConfig,
  ResolvedSecrets,
  DatabaseCatalog,
  DatabaseSchemaMetadata,
  DatabaseTableMetadata,
  DatabaseColumnMetadata,
  DatabaseForeignKeyMetadata,
  DatabaseExecutorOptions,
  DatabaseAuditEventType,
  ResultMappingSpec,
  CompiledOperation,
  DatabaseQueryResult,
  HealthCheckResult,
  DatabaseDialect as Dialect,
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
} from './models.js';
