// ---------------------------------------------------------------------------
// Database Executor – PostgreSQL compiler
// ---------------------------------------------------------------------------
// Converts canonical DatabasePreparationSpec into parameterized DatabaseCommand.
// All values are parameterized ($1, $2, …).  Identifiers come from validated
// catalogs/mappings only.  No raw SQL from IR is ever executed.

import type {
  DatabasePreparationSpec,
  DatabaseCommand,
  ParameterBinding,
  ResultMappingSpec,
  ResourceMapping,
  DatabaseCatalog,
  ExecutionContext,
  DataConstraint,
  DataValueExpression,
} from '../models.js';

import { DatabaseErrorCode, DatabaseExecutorError } from '../errors.js';
import { validateIdentifier, quoteIdentifier } from './identifier.js';
import { resolveValueExpression } from './binding-resolver.js';

// ---- Compiler options -----------------------------------------------------

export interface CompilerOptions {
  operationId: string;
  resourceId: string;
  catalog?: DatabaseCatalog;
  resourceMapping?: ResourceMapping;
  context: ExecutionContext;
}

// ---- Public compiler entry point ------------------------------------------

/**
 * Compile a DatabasePreparationSpec into a parameterized DatabaseCommand.
 */
export function compileDatabaseCommand(
  spec: DatabasePreparationSpec,
  options: CompilerOptions,
): { command: DatabaseCommand; resultMappings: ResultMappingSpec[]; isMutating: boolean } {
  const { operationId, resourceId, catalog, resourceMapping, context } = options;

  // Resolve table name from mapping or spec entity
  const table = resolveTableName(spec.entity, resourceMapping, catalog);
  const schema = resolveSchemaName(resourceMapping, catalog);

  // Build allowed column set from catalog if available
  const allowedColumns = catalog
    ? getAllowedColumns(catalog, schema, table)
    : undefined;

  switch (spec.mode) {
    case 'select':
      return compileSelect(spec, table, schema, allowedColumns, operationId, resourceId, context);
    case 'insert':
      return compileInsert(spec, table, schema, allowedColumns, operationId, resourceId, context);
    case 'update':
      return compileUpdate(spec, table, schema, allowedColumns, operationId, resourceId, context);
    case 'restore':
      return compileUpdate(spec, table, schema, allowedColumns, operationId, resourceId, context);
    default:
      // derive mode does not produce DB commands
      throw new DatabaseExecutorError({
        code: DatabaseErrorCode.DB_QUERY_FAILED,
        message: `Unsupported database operation mode: ${spec.mode}`,
        operationId,
      });
  }
}

// ---- SELECT ---------------------------------------------------------------

function compileSelect(
  spec: DatabasePreparationSpec,
  table: string,
  schema: string | undefined,
  allowedColumns: Set<string> | undefined,
  operationId: string,
  resourceId: string,
  context: ExecutionContext,
): { command: DatabaseCommand; resultMappings: ResultMappingSpec[]; isMutating: boolean } {
  // Determine which columns to select (spec §20: only required bindings)
  const selectColumns = resolveSelectColumns(spec, allowedColumns);
  const { clause: whereClause, bindings: whereBindings } = compileWhereClause(
    spec.criteria,
    allowedColumns,
    context,
    operationId,
  );

  const qualifiedTable = schema
    ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    : quoteIdentifier(table);

  const columnList = selectColumns.map(c => quoteIdentifier(c)).join(', ');
  let sql = `SELECT ${columnList} FROM ${qualifiedTable}`;

  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
  }

  // Deterministic ordering for single-row expectations
  const expectOne = spec.bindings.length <= 1 || spec.mode === 'select';
  if (expectOne) {
    // Use first criterion column for deterministic ordering, or primary key
    const orderCol = selectColumns[0];
    if (orderCol) {
      sql += ` ORDER BY ${quoteIdentifier(orderCol)} ASC`;
    }
    sql += ' LIMIT 1';
  }

  const parameters = whereBindings.map(b => b.value);
  const resultMappings: ResultMappingSpec[] = spec.bindings.map(b => ({
    sourceColumn: resolveSourceColumn(b, selectColumns),
    targetBinding: b,
    sensitive: isSensitiveBinding(b, context),
  }));

  const command: DatabaseCommand = {
    kind: 'select',
    text: sql,
    parameters,
    expectedResult: expectOne ? 'zero-or-one' : 'many',
    metadata: {
      resourceId,
      schema,
      table,
      columns: selectColumns,
      operationId,
      parameterBindings: whereBindings,
    },
  };

  return { command, resultMappings, isMutating: false };
}

// ---- INSERT ---------------------------------------------------------------

function compileInsert(
  spec: DatabasePreparationSpec,
  table: string,
  schema: string | undefined,
  allowedColumns: Set<string> | undefined,
  operationId: string,
  resourceId: string,
  context: ExecutionContext,
): { command: DatabaseCommand; resultMappings: ResultMappingSpec[]; isMutating: boolean } {
  const { columns, values } = resolveInsertValues(
    spec,
    allowedColumns,
    context,
    operationId,
  );

  if (columns.length === 0) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_QUERY_FAILED,
      message: 'INSERT requires at least one value',
      operationId,
    });
  }

  const qualifiedTable = schema
    ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    : quoteIdentifier(table);

  const columnList = columns.map(c => quoteIdentifier(c)).join(', ');
  const paramPlaceholders = values.map((_, i) => `$${i + 1}`).join(', ');

  let sql = `INSERT INTO ${qualifiedTable} (${columnList}) VALUES (${paramPlaceholders})`;

  // RETURNING clause for producing bindings (spec §24)
  const returningColumns = spec.bindings.length > 0
    ? spec.bindings.map(b => resolveSourceColumn(b, columns))
    : columns;

  sql += ` RETURNING ${returningColumns.map(c => quoteIdentifier(c)).join(', ')}`;

  const parameterBindings: ParameterBinding[] = values.map((v, i) => ({
    position: i + 1,
    value: v,
    sensitive: false,
  }));

  const resultMappings: ResultMappingSpec[] = spec.bindings.map(b => ({
    sourceColumn: resolveSourceColumn(b, columns),
    targetBinding: b,
    sensitive: isSensitiveBinding(b, context),
  }));

  const command: DatabaseCommand = {
    kind: 'insert',
    text: sql,
    parameters: values,
    expectedResult: 'one',
    metadata: {
      resourceId,
      schema,
      table,
      columns,
      returningColumns,
      operationId,
      parameterBindings,
    },
  };

  return { command, resultMappings, isMutating: true };
}

// ---- UPDATE ---------------------------------------------------------------

function compileUpdate(
  spec: DatabasePreparationSpec,
  table: string,
  schema: string | undefined,
  allowedColumns: Set<string> | undefined,
  operationId: string,
  resourceId: string,
  context: ExecutionContext,
): { command: DatabaseCommand; resultMappings: ResultMappingSpec[]; isMutating: boolean } {
  // spec §34: UPDATE requires explicit criteria
  if (!spec.criteria || spec.criteria.length === 0) {
    throw new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNSAFE_MUTATION,
      message: 'UPDATE without WHERE criteria is rejected',
      operationId,
    });
  }

  const { columns: setColumns, values: setValues } = resolveInsertValues(
    spec,
    allowedColumns,
    context,
    operationId,
  );

  const { clause: whereClause, bindings: whereBindings } = compileWhereClause(
    spec.criteria,
    allowedColumns,
    context,
    operationId,
  );

  const qualifiedTable = schema
    ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    : quoteIdentifier(table);

  // Build SET clause with parameterized values
  const setParts: string[] = [];
  const allParameters: unknown[] = [];
  let paramIndex = 1;

  for (const col of setColumns) {
    setParts.push(`${quoteIdentifier(col)} = $${paramIndex}`);
    allParameters.push(setValues[paramIndex - 1]);
    paramIndex++;
  }

  // WHERE clause parameters follow SET parameters
  for (const wb of whereBindings) {
    allParameters.push(wb.value);
    paramIndex++;
  }

  const sql = `UPDATE ${qualifiedTable} SET ${setParts.join(', ')} WHERE ${whereClause}`;

  const parameterBindings: ParameterBinding[] = allParameters.map((v, i) => ({
    position: i + 1,
    value: v,
    sensitive: false,
  }));

  const command: DatabaseCommand = {
    kind: 'update',
    text: sql,
    parameters: allParameters,
    expectedResult: 'affected-rows',
    metadata: {
      resourceId,
      schema,
      table,
      columns: setColumns,
      operationId,
      parameterBindings,
    },
  };

  const resultMappings: ResultMappingSpec[] = spec.bindings.map(b => ({
    sourceColumn: resolveSourceColumn(b, setColumns),
    targetBinding: b,
    sensitive: isSensitiveBinding(b, context),
  }));

  return { command, resultMappings, isMutating: true };
}

// ---- Helpers --------------------------------------------------------------

function resolveTableName(
  entity: string,
  mapping?: ResourceMapping,
  catalog?: DatabaseCatalog,
): string {
  // Prefer explicit field mapping from resource mapping
  if (mapping?.fieldMappings?.['__table']) {
    return validateIdentifier(mapping.fieldMappings['__table'], 'table');
  }
  // Fall back to entity name (validated)
  const allowed = catalog
    ? new Set(catalog.schemas.flatMap(s => s.tables.map(t => t.name)))
    : undefined;
  return validateIdentifier(entity, 'table', allowed);
}

function resolveSchemaName(
  mapping?: ResourceMapping,
  catalog?: DatabaseCatalog,
): string | undefined {
  if (mapping?.fieldMappings?.['__schema']) {
    return validateIdentifier(mapping.fieldMappings['__schema'], 'schema');
  }
  if (catalog && catalog.schemas.length === 1) {
    return validateIdentifier(catalog.schemas[0].name, 'schema');
  }
  return undefined;
}

function getAllowedColumns(
  catalog: DatabaseCatalog,
  schema: string | undefined,
  table: string,
): Set<string> {
  const schemaName = schema ?? catalog.schemas[0]?.name;
  const schemaMeta = catalog.schemas.find(s => s.name === schemaName);
  if (!schemaMeta) return new Set();
  const tableMeta = schemaMeta.tables.find(t => t.name === table);
  if (!tableMeta) return new Set();
  return new Set(tableMeta.columns.map(c => c.name));
}

function resolveSelectColumns(
  spec: DatabasePreparationSpec,
  allowedColumns?: Set<string>,
): string[] {
  // spec §20: only select fields required for bindings
  const columns = spec.bindings.map(b => resolveSourceColumn(b, allowedColumns ? [...allowedColumns] : []));
  // Validate each column
  for (const col of columns) {
    validateIdentifier(col, 'column', allowedColumns);
  }
  // Deduplicate
  return [...new Set(columns)];
}

function resolveSourceColumn(bindingName: string, availableColumns: string[] | Set<string>): string {
  // Convention: binding "runtime.userId" → column "user_id" or "userId"
  // Try exact match first
  const cols = availableColumns instanceof Set ? [...availableColumns] : availableColumns;

  if (cols.includes(bindingName)) return bindingName;

  // Try snake_case conversion: "userId" → "user_id"
  const snakeCase = toSnakeCase(bindingName);
  if (cols.includes(snakeCase)) return snakeCase;

  // Try last segment after dot: "runtime.userId" → "userId" → "user_id"
  const lastDot = bindingName.lastIndexOf('.');
  if (lastDot >= 0) {
    const shortName = bindingName.slice(lastDot + 1);
    if (cols.includes(shortName)) return shortName;
    const shortSnake = toSnakeCase(shortName);
    if (cols.includes(shortSnake)) return shortSnake;
  }

  // If no available columns to check against, use the snake_case of the short name
  if (cols.length === 0) {
    const shortName = lastDot >= 0 ? bindingName.slice(lastDot + 1) : bindingName;
    return toSnakeCase(shortName);
  }

  // Fallback: use the short name as-is
  return lastDot >= 0 ? bindingName.slice(lastDot + 1) : bindingName;
}

function toSnakeCase(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, '');
}

function compileWhereClause(
  criteria: DataConstraint[],
  allowedColumns: Set<string> | undefined,
  context: ExecutionContext,
  operationId: string,
): { clause: string; bindings: ParameterBinding[] } {
  if (!criteria || criteria.length === 0) {
    return { clause: '', bindings: [] };
  }

  const parts: string[] = [];
  const bindings: ParameterBinding[] = [];
  let paramIndex = 1;

  for (const constraint of criteria) {
    const field = constraint.field;
    if (!field) continue;

    const column = validateIdentifier(field, 'column', allowedColumns);
    const op = normalizeOperator(constraint.operator ?? 'eq');

    if (op === 'is_null' || op === 'exists') {
      if (op === 'is_null') {
        parts.push(`${quoteIdentifier(column)} IS NULL`);
      } else {
        parts.push(`${quoteIdentifier(column)} IS NOT NULL`);
      }
      continue;
    }

    const value = resolveConstraintValue(constraint, context, operationId);
    parts.push(`${quoteIdentifier(column)} ${op} $${paramIndex}`);
    bindings.push({
      position: paramIndex,
      bindingName: constraint.field,
      value,
      sensitive: false,
    });
    paramIndex++;
  }

  return { clause: parts.join(' AND '), bindings };
}

function normalizeOperator(op: string): string {
  switch (op) {
    case 'eq': case '=': case 'equals': return '=';
    case 'ne': case '!=': case 'not_equals': return '!=';
    case 'gt': case '>': return '>';
    case 'gte': case '>=': return '>=';
    case 'lt': case '<': return '<';
    case 'lte': case '<=': return '<=';
    case 'like': return 'LIKE';
    case 'in': return 'IN';
    case 'is_null': return 'is_null';
    case 'exists': return 'exists';
    default: return '=';
  }
}

function resolveConstraintValue(
  constraint: DataConstraint,
  context: ExecutionContext,
  operationId: string,
): unknown {
  // If constraint has a direct value, use it
  if (constraint.value !== undefined) {
    return constraint.value;
  }

  // If constraint references a binding, resolve it
  if (constraint.description) {
    const resolved = context.bindings.resolve(constraint.description);
    if (resolved) return resolved.value;
  }

  throw new DatabaseExecutorError({
    code: DatabaseErrorCode.DB_BINDING_MISSING,
    message: `Cannot resolve value for constraint on field "${constraint.field}"`,
    operationId,
  });
}

function resolveInsertValues(
  spec: DatabasePreparationSpec,
  allowedColumns: Set<string> | undefined,
  context: ExecutionContext,
  operationId: string,
): { columns: string[]; values: unknown[]; bindings: string[] } {
  const columns: string[] = [];
  const values: unknown[] = [];

  for (const ve of spec.values) {
    const fieldName = resolveFieldName(ve, allowedColumns);
    if (!fieldName) continue;

    validateIdentifier(fieldName, 'column', allowedColumns);
    const value = resolveValueExpression(ve, context, operationId);
    columns.push(fieldName);
    values.push(value);
  }

  return { columns, values, bindings: spec.bindings };
}

function resolveFieldName(
  ve: DataValueExpression,
  _allowedColumns?: Set<string>,
): string | undefined {
  // Value expressions may carry a field hint in arguments or binding name
  if (ve.binding) {
    const lastDot = ve.binding.lastIndexOf('.');
    const short = lastDot >= 0 ? ve.binding.slice(lastDot + 1) : ve.binding;
    return toSnakeCase(short);
  }
  if (ve.arguments && ve.arguments.length > 0 && typeof ve.arguments[0] === 'string') {
    return ve.arguments[0] as string;
  }
  return undefined;
}

function isSensitiveBinding(bindingName: string, context: ExecutionContext): boolean {
  // Check if binding is marked sensitive in the binding store
  return context.bindings.sensitiveNames().has(bindingName) ||
    /password|token|secret|credential|api[_-]?key/i.test(bindingName);
}
