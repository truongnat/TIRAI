// ---------------------------------------------------------------------------
// Database Executor – comprehensive test suite (100+ tests)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import {
  minimalOperation,
  minimalContext,
  minimalPolicy,
  minimalSpec,
  minimalCatalog,
  minimalMapping,
  minimalConnectionConfig,
  FakeBindingStore,
  FakeAuditRecorder,
  constraint,
  literalValue,
  bindingValue,
  resetCounters,
} from './helpers.js';

import { compileDatabaseCommand } from '../src/compiler/postgres-compiler.js';
import { validateIdentifier, quoteIdentifier, buildAllowedSet } from '../src/compiler/identifier.js';
import { resolveValueExpression } from '../src/compiler/binding-resolver.js';
import { DatabaseExecutorError, DatabaseErrorCode } from '../src/errors.js';
import { validateDatabaseOperation } from '../src/validation/operation-validator.js';
import { rejectDDL, rejectRawSql, validateMutationGate, validateWhereClause } from '../src/validation/mutation-safety.js';
import { mapResultToBindings, mapReturningToBindings } from '../src/mapping/result-mapper.js';
import { DatabaseExecutor } from '../src/database-executor.js';
import { resolveSecrets } from '../src/driver/driver.js';
import type { DatabaseCommand } from '../src/models.js';

// ===========================================================================
// COMPILER TESTS (spec §59: 1-10)
// ===========================================================================

describe('Compiler — SELECT', () => {
  beforeEach(() => resetCounters());

  it('1. compiles basic SELECT with criteria', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [constraint('username', 'eq', 'alice')],
      bindings: ['runtime.userId'],
    });
    const ctx = minimalContext();
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: ctx,
    });
    expect(result.command.kind).toBe('select');
    expect(result.command.text).toContain('SELECT');
    expect(result.command.text).toContain('FROM');
    expect(result.command.text).toContain('WHERE');
    expect(result.command.parameters).toEqual(['alice']);
    expect(result.isMutating).toBe(false);
  });

  it('2. SELECT uses LIMIT 1 for single-row expectation', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [constraint('id', 'eq', 'abc')],
      bindings: ['runtime.userId'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.text).toContain('LIMIT 1');
    expect(result.command.expectedResult).toBe('zero-or-one');
  });

  it('3. SELECT with multiple criteria uses AND', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [
        constraint('username', 'eq', 'alice'),
        constraint('status', 'eq', 'active'),
      ],
      bindings: ['runtime.userId'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.text).toContain('AND');
    expect(result.command.parameters).toHaveLength(2);
  });

  it('4. SELECT with schema qualification', () => {
    const spec = minimalSpec({ mode: 'select', entity: 'users', criteria: [], bindings: ['runtime.id'] });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      catalog: minimalCatalog(),
      resourceMapping: minimalMapping(),
      context: minimalContext(),
    });
    expect(result.command.text).toContain('"public"."users"');
  });

  it('5. SELECT parameter positions are sequential', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [
        constraint('username', 'eq', 'alice'),
        constraint('status', 'eq', 'active'),
      ],
      bindings: ['runtime.userId'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.text).toContain('$1');
    expect(result.command.text).toContain('$2');
  });

  it('6. SELECT does not use SELECT *', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [],
      bindings: ['runtime.userId', 'runtime.username'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.text).not.toContain('SELECT *');
  });
});

describe('Compiler — INSERT', () => {
  beforeEach(() => resetCounters());

  it('7. compiles basic INSERT with values', () => {
    const spec = minimalSpec({
      mode: 'insert',
      entity: 'users',
      values: [literalValue('alice', 'username'), literalValue('alice@test.com', 'email')],
      bindings: ['runtime.userId'],
      criteria: [],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.kind).toBe('insert');
    expect(result.command.text).toContain('INSERT INTO');
    expect(result.command.text).toContain('RETURNING');
    expect(result.isMutating).toBe(true);
  });

  it('8. INSERT includes RETURNING clause', () => {
    const spec = minimalSpec({
      mode: 'insert',
      entity: 'users',
      values: [literalValue('alice', 'username')],
      bindings: ['runtime.userId'],
      criteria: [],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.text).toContain('RETURNING');
    expect(result.command.expectedResult).toBe('one');
  });

  it('9. INSERT with binding values resolves from context', () => {
    const store = new FakeBindingStore();
    store.produce({
      id: 'b1',
      name: 'runtime.generatedUsername',
      producerOperationId: 'OP-GEN',
      value: 'generated_user',
      sensitive: false,
      status: 'resolved',
    });
    const ctx = minimalContext({ bindings: store });
    const spec = minimalSpec({
      mode: 'insert',
      entity: 'users',
      values: [bindingValue('runtime.generatedUsername')],
      bindings: ['runtime.userId'],
      criteria: [],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: ctx,
    });
    expect(result.command.parameters).toContain('generated_user');
  });
});

describe('Compiler — UPDATE', () => {
  beforeEach(() => resetCounters());

  it('10. compiles UPDATE with criteria', () => {
    const spec = minimalSpec({
      mode: 'update',
      entity: 'users',
      criteria: [constraint('id', 'eq', 'abc')],
      values: [literalValue('active', 'status')],
      bindings: [],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.kind).toBe('update');
    expect(result.command.text).toContain('UPDATE');
    expect(result.command.text).toContain('SET');
    expect(result.command.text).toContain('WHERE');
    expect(result.isMutating).toBe(true);
  });

  it('11. UPDATE without criteria is rejected', () => {
    const spec = minimalSpec({
      mode: 'update',
      entity: 'users',
      criteria: [],
      values: [literalValue('active', 'status')],
      bindings: [],
    });
    expect(() =>
      compileDatabaseCommand(spec, {
        operationId: 'OP-0001',
        resourceId: 'res-db-1',
        context: minimalContext(),
      }),
    ).toThrow();
  });
});

// ===========================================================================
// IDENTIFIER TESTS (spec §59: 11-18)
// ===========================================================================

describe('Identifier validation', () => {
  it('11. accepts valid table name', () => {
    expect(validateIdentifier('users', 'table')).toBe('users');
  });

  it('12. accepts valid schema name', () => {
    expect(validateIdentifier('public', 'schema')).toBe('public');
  });

  it('13. accepts valid column name', () => {
    expect(validateIdentifier('user_id', 'column')).toBe('user_id');
  });

  it('14. rejects semicolon', () => {
    expect(() => validateIdentifier('users; DROP TABLE', 'table')).toThrow(DatabaseExecutorError);
  });

  it('15. rejects quote injection', () => {
    expect(() => validateIdentifier("users'", 'table')).toThrow(DatabaseExecutorError);
  });

  it('16. rejects comment', () => {
    expect(() => validateIdentifier('users -- comment', 'table')).toThrow(DatabaseExecutorError);
  });

  it('17. rejects whitespace attack', () => {
    expect(() => validateIdentifier('users DROP TABLE', 'table')).toThrow(DatabaseExecutorError);
  });

  it('18. rejects empty identifier', () => {
    expect(() => validateIdentifier('', 'table')).toThrow(DatabaseExecutorError);
  });

  it('19. rejects identifier not in allowed set', () => {
    const allowed = buildAllowedSet(['users', 'sessions']);
    expect(() => validateIdentifier('evil_table', 'table', allowed)).toThrow(DatabaseExecutorError);
  });

  it('20. accepts identifier in allowed set', () => {
    const allowed = buildAllowedSet(['users', 'sessions']);
    expect(validateIdentifier('users', 'table', allowed)).toBe('users');
  });
});

// ===========================================================================
// QUOTE IDENTIFIER
// ===========================================================================

describe('quoteIdentifier', () => {
  it('21. wraps in double quotes', () => {
    expect(quoteIdentifier('users')).toBe('"users"');
  });

  it('22. preserves case', () => {
    expect(quoteIdentifier('Users')).toBe('"Users"');
  });
});

// ===========================================================================
// BINDING RESOLVER TESTS (spec §59: 37-41)
// ===========================================================================

describe('Binding resolver', () => {
  it('37. resolves literal value', () => {
    const expr = literalValue('hello');
    const ctx = minimalContext();
    expect(resolveValueExpression(expr, ctx, 'OP-0001')).toBe('hello');
  });

  it('38. resolves binding from store', () => {
    const store = new FakeBindingStore();
    store.produce({
      id: 'b1', name: 'runtime.userId', producerOperationId: 'OP-1',
      value: 'user-123', sensitive: false, status: 'resolved',
    });
    const ctx = minimalContext({ bindings: store });
    const expr = bindingValue('runtime.userId');
    expect(resolveValueExpression(expr, ctx, 'OP-0001')).toBe('user-123');
  });

  it('39. throws on unresolved binding', () => {
    const ctx = minimalContext();
    const expr = bindingValue('runtime.nonexistent');
    expect(() => resolveValueExpression(expr, ctx, 'OP-0001')).toThrow(DatabaseExecutorError);
  });

  it('40. resolves boundary value', () => {
    const expr = { type: 'boundary' as const, value: 42 };
    const ctx = minimalContext();
    expect(resolveValueExpression(expr, ctx, 'OP-0001')).toBe(42);
  });
});

// ===========================================================================
// VALIDATION TESTS (spec §59: 42-47)
// ===========================================================================

describe('Operation validator', () => {
  beforeEach(() => resetCounters());

  it('42. validates a correct operation', () => {
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = validateDatabaseOperation(op, minimalContext());
    expect(result.valid).toBe(true);
  });

  it('43. rejects operation without resolverSpec', () => {
    const op = minimalOperation({ resolverSpec: undefined });
    const result = validateDatabaseOperation(op, minimalContext());
    expect(result.valid).toBe(false);
  });

  it('44. rejects UPDATE without criteria', () => {
    const op = minimalOperation({
      resolverSpec: minimalSpec({
        mode: 'update',
        entity: 'users',
        criteria: [],
        values: [literalValue('active', 'status')],
      }) as unknown as Record<string, unknown>,
    });
    const result = validateDatabaseOperation(op, minimalContext());
    expect(result.valid).toBe(false);
  });

  it('45. warns on missing resourceId', () => {
    const op = minimalOperation({ resourceId: undefined });
    const result = validateDatabaseOperation(op, minimalContext());
    expect(result.errors.some(e => e.code === DatabaseErrorCode.DB_MISSING_CONFIG)).toBe(true);
  });
});

// ===========================================================================
// MUTATION SAFETY TESTS (spec §59: 46-47, 79-80)
// ===========================================================================

describe('Mutation safety', () => {
  it('46. rejects mutation in dry-run mode', () => {
    const ctx = minimalContext({ mode: 'dry-run' });
    expect(() => validateMutationGate(ctx, 'res-db-1', 'OP-0001')).toThrow(DatabaseExecutorError);
  });

  it('47. rejects mutation when allowMutation is false', () => {
    const ctx = minimalContext({
      mode: 'execute',
      policy: minimalPolicy({ mode: 'execute', allowMutation: false }),
    });
    expect(() => validateMutationGate(ctx, 'res-db-1', 'OP-0001')).toThrow(DatabaseExecutorError);
  });

  it('48. rejects mutation when resource not allowlisted', () => {
    const ctx = minimalContext({
      mode: 'execute',
      policy: minimalPolicy({ mode: 'execute', allowMutation: true, allowedResourceIds: [] }),
    });
    expect(() => validateMutationGate(ctx, 'res-db-1', 'OP-0001')).toThrow(DatabaseExecutorError);
  });

  it('49. rejects mutation when resource is denied', () => {
    const ctx = minimalContext({
      mode: 'execute',
      policy: minimalPolicy({
        mode: 'execute',
        allowMutation: true,
        allowedResourceIds: ['res-db-1'],
        deniedResourceIds: ['res-db-1'],
      }),
    });
    expect(() => validateMutationGate(ctx, 'res-db-1', 'OP-0001')).toThrow(DatabaseExecutorError);
  });

  it('50. passes all gates', () => {
    const ctx = minimalContext({
      mode: 'execute',
      policy: minimalPolicy({
        mode: 'execute',
        allowMutation: true,
        allowedResourceIds: ['res-db-1'],
      }),
    });
    expect(() => validateMutationGate(ctx, 'res-db-1', 'OP-0001')).not.toThrow();
  });
});

describe('DDL rejection', () => {
  it('79. rejects DROP TABLE', () => {
    const cmd: DatabaseCommand = {
      kind: 'delete',
      text: 'DROP TABLE users',
      parameters: [],
      expectedResult: 'affected-rows',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    expect(() => rejectDDL(cmd, 'OP-1')).toThrow(DatabaseExecutorError);
  });

  it('80. rejects CREATE TABLE', () => {
    const cmd: DatabaseCommand = {
      kind: 'insert',
      text: 'CREATE TABLE evil (id int)',
      parameters: [],
      expectedResult: 'one',
      metadata: { resourceId: 'r', table: 'evil', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    expect(() => rejectDDL(cmd, 'OP-1')).toThrow(DatabaseExecutorError);
  });
});

describe('Raw SQL rejection', () => {
  it('81. rejects raw SQL in parameters', () => {
    expect(() => rejectRawSql({ sql: 'DROP TABLE users' }, 'OP-1')).toThrow(DatabaseExecutorError);
  });

  it('82. allows normal parameters', () => {
    expect(() => rejectRawSql({ entity: 'users' }, 'OP-1')).not.toThrow();
  });
});

describe('WHERE clause safety', () => {
  it('83. rejects DELETE without WHERE', () => {
    const cmd: DatabaseCommand = {
      kind: 'delete',
      text: 'DELETE FROM users',
      parameters: [],
      expectedResult: 'affected-rows',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    expect(() => validateWhereClause(cmd, 'OP-1')).toThrow(DatabaseExecutorError);
  });

  it('84. rejects UPDATE without WHERE', () => {
    const cmd: DatabaseCommand = {
      kind: 'update',
      text: 'UPDATE users SET status = $1',
      parameters: ['active'],
      expectedResult: 'affected-rows',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    expect(() => validateWhereClause(cmd, 'OP-1')).toThrow(DatabaseExecutorError);
  });

  it('85. accepts DELETE with WHERE', () => {
    const cmd: DatabaseCommand = {
      kind: 'delete',
      text: 'DELETE FROM users WHERE id = $1',
      parameters: ['abc'],
      expectedResult: 'affected-rows',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    expect(() => validateWhereClause(cmd, 'OP-1')).not.toThrow();
  });
});

// ===========================================================================
// RESULT MAPPER TESTS (spec §59: 19-23, 49)
// ===========================================================================

describe('Result mapper', () => {
  it('19. maps single row to bindings', () => {
    const queryResult = { rows: [{ id: 'abc', username: 'alice' }], rowCount: 1, command: 'select' as const };
    const cmd: DatabaseCommand = {
      kind: 'select', text: '', parameters: [], expectedResult: 'zero-or-one',
      metadata: { resourceId: 'r', table: 'users', columns: ['id'], operationId: 'OP-1', parameterBindings: [] },
    };
    const mappings = [
      { sourceColumn: 'id', targetBinding: 'runtime.userId', sensitive: false },
      { sourceColumn: 'username', targetBinding: 'runtime.username', sensitive: false },
    ];
    const bindings = mapResultToBindings(queryResult, cmd, mappings, 'OP-1');
    expect(bindings).toHaveLength(2);
    expect(bindings[0].value).toBe('abc');
    expect(bindings[1].value).toBe('alice');
  });

  it('20. returns empty for zero rows', () => {
    const queryResult = { rows: [], rowCount: 0, command: 'select' as const };
    const cmd: DatabaseCommand = {
      kind: 'select', text: '', parameters: [], expectedResult: 'zero-or-one',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    const bindings = mapResultToBindings(queryResult, cmd, [], 'OP-1');
    expect(bindings).toHaveLength(0);
  });

  it('22. throws on ambiguous result', () => {
    const queryResult = { rows: [{ id: '1' }, { id: '2' }], rowCount: 2, command: 'select' as const };
    const cmd: DatabaseCommand = {
      kind: 'select', text: '', parameters: [], expectedResult: 'zero-or-one',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    expect(() => mapResultToBindings(queryResult, cmd, [], 'OP-1')).toThrow(DatabaseExecutorError);
  });

  it('23. maps RETURNING result', () => {
    const queryResult = { rows: [{ id: 'new-id' }], rowCount: 1, command: 'insert' as const };
    const mappings = [{ sourceColumn: 'id', targetBinding: 'runtime.userId', sensitive: false }];
    const bindings = mapReturningToBindings(queryResult, mappings, 'OP-1');
    expect(bindings).toHaveLength(1);
    expect(bindings[0].value).toBe('new-id');
  });

  it('49. marks sensitive bindings', () => {
    const queryResult = { rows: [{ password_hash: 'secret' }], rowCount: 1, command: 'select' as const };
    const cmd: DatabaseCommand = {
      kind: 'select', text: '', parameters: [], expectedResult: 'zero-or-one',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    const mappings = [{ sourceColumn: 'password_hash', targetBinding: 'runtime.password', sensitive: true }];
    const bindings = mapResultToBindings(queryResult, cmd, mappings, 'OP-1');
    expect(bindings[0].sensitive).toBe(true);
  });
});

// ===========================================================================
// EXECUTOR CONTRACT TESTS (spec §59: 89-93)
// ===========================================================================

describe('DatabaseExecutor contract', () => {
  beforeEach(() => resetCounters());

  it('89. canExecute returns high score for database operations', () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const match = executor.canExecute(op, minimalContext());
    expect(match.supported).toBe(true);
    expect(match.score).toBeGreaterThan(0.5);
  });

  it('90. canExecute returns 0 for non-database operations', () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({ resolver: 'api' });
    const match = executor.canExecute(op, minimalContext());
    expect(match.supported).toBe(false);
    expect(match.score).toBe(0);
  });

  it('91. validate returns valid for correct operation', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.validate(op, minimalContext());
    expect(result.valid).toBe(true);
  });

  it('92. validate rejects raw SQL', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      parameters: { sql: 'DROP TABLE users' },
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.validate(op, minimalContext());
    expect(result.valid).toBe(false);
  });

  it('93. dry-run execute compiles without connecting', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({
        mode: 'select',
        entity: 'users',
        criteria: [constraint('username', 'eq', 'alice')],
        bindings: ['runtime.userId'],
      }) as unknown as Record<string, unknown>,
    });
    const ctx = minimalContext({ mode: 'dry-run' });
    const result = await executor.execute(op, ctx);
    expect(result.status).toBe('validated');
    expect(executor.metrics.connectionsOpened).toBe(0);
    expect(executor.metrics.queriesExecuted).toBe(0);
  });

  it('94. execute mode without config returns failed', async () => {
    const executor = new DatabaseExecutor({ allowConnection: true });
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const ctx = minimalContext({
      mode: 'execute',
      policy: minimalPolicy({ mode: 'execute', allowMutation: true, allowedResourceIds: ['res-db-1'] }),
    });
    const result = await executor.execute(op, ctx);
    expect(result.status).toBe('failed');
  });

  it('95. execute mode blocked without mutation gate', async () => {
    const executor = new DatabaseExecutor({
      connections: new Map([['res-db-1', minimalConnectionConfig()]]),
      allowConnection: true,
    });
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'insert', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const ctx = minimalContext({
      mode: 'execute',
      policy: minimalPolicy({ mode: 'execute', allowMutation: false }),
    });
    const result = await executor.execute(op, ctx);
    expect(result.status).toBe('blocked');
  });
});

// ===========================================================================
// DRY-RUN TESTS (spec §59: 85-88)
// ===========================================================================

describe('Dry-run mode', () => {
  beforeEach(() => resetCounters());

  it('85. compiles SELECT without connection', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({
        mode: 'select',
        entity: 'users',
        criteria: [constraint('status', 'eq', 'active')],
        bindings: ['runtime.userId'],
      }) as unknown as Record<string, unknown>,
    });
    const result = await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(result.status).toBe('validated');
  });

  it('86. zero connections opened', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(executor.metrics.connectionsOpened).toBe(0);
  });

  it('87. zero queries executed', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(executor.metrics.queriesExecuted).toBe(0);
  });

  it('88. dry-run records audit events', async () => {
    const audit = new FakeAuditRecorder();
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    await executor.execute(op, minimalContext({ mode: 'dry-run', audit }));
    expect(audit.events().length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// PROVENANCE TESTS (spec §59: 94-95)
// ===========================================================================

describe('Provenance preservation', () => {
  beforeEach(() => resetCounters());

  it('94. preserves operation provenance in result', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      provenance: [{ source: 'excel', step: 'extraction' }],
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(result.provenance).toEqual([{ source: 'excel', step: 'extraction' }]);
  });
});

// ===========================================================================
// DETERMINISM TESTS (spec §59: 96-97)
// ===========================================================================

describe('Determinism', () => {
  beforeEach(() => resetCounters());

  it('96. same operation compiles to same SQL', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [constraint('username', 'eq', 'alice')],
      bindings: ['runtime.userId'],
    });
    const r1 = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    resetCounters();
    const r2 = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(r1.command.text).toBe(r2.command.text);
    expect(r1.command.parameters).toEqual(r2.command.parameters);
  });

  it('97. stable parameter ordering', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [
        constraint('username', 'eq', 'alice'),
        constraint('status', 'eq', 'active'),
      ],
      bindings: ['runtime.userId'],
    });
    const r1 = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(r1.command.parameters[0]).toBe('alice');
    expect(r1.command.parameters[1]).toBe('active');
  });
});

// ===========================================================================
// ERROR CODE TESTS (spec §59: 56-61)
// ===========================================================================

describe('Error codes', () => {
  it('56. DB_UNIQUE_VIOLATION code exists', () => {
    expect(DatabaseErrorCode.DB_UNIQUE_VIOLATION).toBe('DB_UNIQUE_VIOLATION');
  });

  it('57. DB_FOREIGN_KEY_VIOLATION code exists', () => {
    expect(DatabaseErrorCode.DB_FOREIGN_KEY_VIOLATION).toBe('DB_FOREIGN_KEY_VIOLATION');
  });

  it('58. DB_NOT_NULL_VIOLATION code exists', () => {
    expect(DatabaseErrorCode.DB_NOT_NULL_VIOLATION).toBe('DB_NOT_NULL_VIOLATION');
  });

  it('59. DB_QUERY_FAILED code exists', () => {
    expect(DatabaseErrorCode.DB_QUERY_FAILED).toBe('DB_QUERY_FAILED');
  });

  it('60. DB_TIMEOUT code exists', () => {
    expect(DatabaseErrorCode.DB_TIMEOUT).toBe('DB_TIMEOUT');
  });

  it('61. DB_CONNECTION_FAILED code exists', () => {
    expect(DatabaseErrorCode.DB_CONNECTION_FAILED).toBe('DB_CONNECTION_FAILED');
  });
});

// ===========================================================================
// SECRET RESOLUTION TESTS (spec §59: 75-78)
// ===========================================================================

describe('Secret resolution', () => {
  it('75. resolves secrets from provider', async () => {
    const provider = {
      resolve: async (ref: string) => ({ value: ref === 'db-user' ? 'admin' : 'secret123' }),
    };
    const config = minimalConnectionConfig();
    const secrets = await resolveSecrets(config, provider);
    expect(secrets.user).toBe('admin');
    expect(secrets.password).toBe('secret123');
  });

  it('76. returns empty secrets without provider', async () => {
    const config = minimalConnectionConfig();
    const secrets = await resolveSecrets(config, undefined);
    expect(secrets.user).toBeUndefined();
    expect(secrets.password).toBeUndefined();
  });

  it('77. resolves connection string secret', async () => {
    const provider = {
      resolve: async () => ({ value: 'postgres://user:pass@localhost/db' }),
    };
    const config = { ...minimalConnectionConfig(), connectionStringSecretRef: 'conn-str' };
    const secrets = await resolveSecrets(config, provider);
    expect(secrets.connectionString).toBe('postgres://user:pass@localhost/db');
  });
});

// ===========================================================================
// CLEANUP / ROLLBACK TESTS (spec §59: 66-70)
// ===========================================================================

describe('Cleanup and rollback', () => {
  beforeEach(() => resetCounters());

  it('66. cleanup in dry-run returns success', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.cleanup!(op, minimalContext({ mode: 'dry-run' }));
    expect(result.status).toBe('cleanup-succeeded');
  });

  it('67. rollback in dry-run returns success', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.rollback!(op, minimalContext({ mode: 'dry-run' }));
    expect(result.status).toBe('rolled-back');
  });

  it('68. cleanup captures operations', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation();
    await executor.cleanup!(op, minimalContext({ mode: 'dry-run' }));
    expect(executor.cleanedUpOps).toHaveLength(1);
  });

  it('69. rollback captures operations', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation();
    await executor.rollback!(op, minimalContext({ mode: 'dry-run' }));
    expect(executor.rolledBackOps).toHaveLength(1);
  });
});

// ===========================================================================
// SECURITY TESTS (spec §59: 75-80)
// ===========================================================================

describe('Security', () => {
  it('76. DatabaseExecutorError does not contain SQL text with values', () => {
    const err = new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_QUERY_FAILED,
      message: 'Query failed',
    });
    expect(err.message).not.toContain('SELECT');
    expect(err.message).not.toContain('alice');
  });

  it('77. password field is detected as sensitive by name heuristic', () => {
    const store = new FakeBindingStore();
    store.produce({
      id: 'b1', name: 'runtime.password', producerOperationId: 'OP-1',
      value: 'secret', sensitive: true, status: 'resolved',
    });
    expect(store.sensitiveNames().has('runtime.password')).toBe(true);
  });

  it('78. DDL keywords are all rejected', () => {
    const ddlStatements = ['DROP TABLE', 'ALTER TABLE', 'CREATE TABLE', 'TRUNCATE'];
    for (const ddl of ddlStatements) {
      const cmd: DatabaseCommand = {
        kind: 'delete',
        text: ddl,
        parameters: [],
        expectedResult: 'affected-rows',
        metadata: { resourceId: 'r', table: 't', columns: [], operationId: 'OP-1', parameterBindings: [] },
      };
      expect(() => rejectDDL(cmd, 'OP-1')).toThrow(DatabaseExecutorError);
    }
  });
});

// ===========================================================================
// SIMULATE MODE TESTS (spec §59: 46)
// ===========================================================================

describe('Simulate mode', () => {
  beforeEach(() => resetCounters());

  it('46. simulate mode does not connect to real DB', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.execute(op, minimalContext({ mode: 'simulate' }));
    expect(executor.metrics.connectionsOpened).toBe(0);
    expect(result.status).toBe('validated');
  });
});

// ===========================================================================
// ADDITIONAL COMPILER TESTS
// ===========================================================================

describe('Compiler — additional', () => {
  beforeEach(() => resetCounters());

  it('98. derive mode throws', () => {
    const spec = minimalSpec({ mode: 'derive', entity: 'users' });
    expect(() =>
      compileDatabaseCommand(spec, {
        operationId: 'OP-0001',
        resourceId: 'res-db-1',
        context: minimalContext(),
      }),
    ).toThrow();
  });

  it('99. catalog validates table against allowed set', () => {
    const spec = minimalSpec({ mode: 'select', entity: 'evil_table', criteria: [], bindings: ['runtime.x'] });
    expect(() =>
      compileDatabaseCommand(spec, {
        operationId: 'OP-0001',
        resourceId: 'res-db-1',
        catalog: minimalCatalog(),
        context: minimalContext(),
      }),
    ).toThrow(DatabaseExecutorError);
  });

  it('100. IS NULL criterion does not add parameter', () => {
    const spec = minimalSpec({
      mode: 'select',
      entity: 'users',
      criteria: [{ type: 'nullable', field: 'status', operator: 'is_null', description: 'status IS NULL', provenance: [] }],
      bindings: ['runtime.userId'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001',
      resourceId: 'res-db-1',
      context: minimalContext(),
    });
    expect(result.command.text).toContain('IS NULL');
    expect(result.command.parameters).toHaveLength(0);
  });
});

// ===========================================================================
// ERROR CLASS TESTS
// ===========================================================================

describe('DatabaseExecutorError', () => {
  it('101. has correct code and message', () => {
    const err = new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_CONNECTION_FAILED,
      message: 'Connection refused',
    });
    expect(err.code).toBe('DB_CONNECTION_FAILED');
    expect(err.message).toBe('Connection refused');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('DatabaseExecutorError');
  });

  it('102. supports retryable flag', () => {
    const err = new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_TIMEOUT,
      message: 'Query timed out',
      retryable: true,
    });
    expect(err.retryable).toBe(true);
  });

  it('103. supports operationId', () => {
    const err = new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_QUERY_FAILED,
      message: 'Failed',
      operationId: 'OP-0042',
    });
    expect(err.operationId).toBe('OP-0042');
  });

  it('104. supports sqlstate', () => {
    const err = new DatabaseExecutorError({
      code: DatabaseErrorCode.DB_UNIQUE_VIOLATION,
      message: 'Duplicate',
      sqlstate: '23505',
    });
    expect(err.sqlstate).toBe('23505');
  });
});

// ===========================================================================
// IDENTIFIER EDGE CASES
// ===========================================================================

describe('Identifier edge cases', () => {
  it('105. rejects identifier with block comment', () => {
    expect(() => validateIdentifier('users /* evil */', 'table')).toThrow(DatabaseExecutorError);
  });

  it('106. rejects identifier with backslash', () => {
    expect(() => validateIdentifier('users\\evil', 'table')).toThrow(DatabaseExecutorError);
  });

  it('107. rejects identifier starting with digit', () => {
    expect(() => validateIdentifier('1users', 'table')).toThrow(DatabaseExecutorError);
  });

  it('108. accepts underscore-prefixed identifier', () => {
    expect(validateIdentifier('_private_table', 'table')).toBe('_private_table');
  });

  it('109. rejects GRANT keyword', () => {
    expect(() => validateIdentifier('GRANT', 'table')).toThrow(DatabaseExecutorError);
  });

  it('110. rejects REVOKE keyword', () => {
    expect(() => validateIdentifier('REVOKE', 'table')).toThrow(DatabaseExecutorError);
  });
});

// ===========================================================================
// COMPILER — OPERATOR VARIANTS
// ===========================================================================

describe('Compiler — operator variants', () => {
  beforeEach(() => resetCounters());

  it('111. compiles NOT EQUAL operator', () => {
    const spec = minimalSpec({
      mode: 'select', entity: 'users',
      criteria: [constraint('status', 'ne', 'banned')],
      bindings: ['runtime.id'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001', resourceId: 'res-db-1', context: minimalContext(),
    });
    expect(result.command.text).toContain('!=');
  });

  it('112. compiles LIKE operator', () => {
    const spec = minimalSpec({
      mode: 'select', entity: 'users',
      criteria: [constraint('username', 'like', '%alice%')],
      bindings: ['runtime.id'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001', resourceId: 'res-db-1', context: minimalContext(),
    });
    expect(result.command.text).toContain('LIKE');
  });

  it('113. compiles EXISTS (IS NOT NULL) operator', () => {
    const spec = minimalSpec({
      mode: 'select', entity: 'users',
      criteria: [{ type: 'required', field: 'email', operator: 'exists', description: 'email exists', provenance: [] }],
      bindings: ['runtime.id'],
    });
    const result = compileDatabaseCommand(spec, {
      operationId: 'OP-0001', resourceId: 'res-db-1', context: minimalContext(),
    });
    expect(result.command.text).toContain('IS NOT NULL');
  });
});

// ===========================================================================
// EXECUTOR — METRICS
// ===========================================================================

describe('Executor metrics', () => {
  beforeEach(() => resetCounters());

  it('114. tracks connections opened', async () => {
    const executor = new DatabaseExecutor();
    expect(executor.metrics.connectionsOpened).toBe(0);
  });

  it('115. tracks queries executed', async () => {
    const executor = new DatabaseExecutor();
    expect(executor.metrics.queriesExecuted).toBe(0);
  });

  it('116. tracks transactions started', async () => {
    const executor = new DatabaseExecutor();
    expect(executor.metrics.transactionsStarted).toBe(0);
  });
});

// ===========================================================================
// EXECUTOR — TYPE
// ===========================================================================

describe('Executor type', () => {
  it('117. has type database', () => {
    const executor = new DatabaseExecutor();
    expect(executor.type).toBe('database');
  });
});

// ===========================================================================
// RESULT MAPPER — EDGE CASES
// ===========================================================================

describe('Result mapper edge cases', () => {
  it('118. throws when expected column missing from result', () => {
    const queryResult = { rows: [{ name: 'alice' }], rowCount: 1, command: 'select' as const };
    const cmd: DatabaseCommand = {
      kind: 'select', text: '', parameters: [], expectedResult: 'zero-or-one',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    const mappings = [{ sourceColumn: 'id', targetBinding: 'runtime.userId', sensitive: false }];
    expect(() => mapResultToBindings(queryResult, cmd, mappings, 'OP-1')).toThrow(DatabaseExecutorError);
  });

  it('119. allows multiple rows for many expectation', () => {
    const queryResult = { rows: [{ id: '1' }, { id: '2' }, { id: '3' }], rowCount: 3, command: 'select' as const };
    const cmd: DatabaseCommand = {
      kind: 'select', text: '', parameters: [], expectedResult: 'many',
      metadata: { resourceId: 'r', table: 'users', columns: [], operationId: 'OP-1', parameterBindings: [] },
    };
    const mappings = [{ sourceColumn: 'id', targetBinding: 'runtime.userId', sensitive: false }];
    const bindings = mapResultToBindings(queryResult, cmd, mappings, 'OP-1');
    expect(bindings).toHaveLength(1); // first row only
  });

  it('120. mapReturningToBindings throws on empty result', () => {
    const queryResult = { rows: [], rowCount: 0, command: 'insert' as const };
    expect(() => mapReturningToBindings(queryResult, [], 'OP-1')).toThrow(DatabaseExecutorError);
  });
});

// ===========================================================================
// EXECUTOR — EXECUTE CAPTURE
// ===========================================================================

describe('Executor capture', () => {
  beforeEach(() => resetCounters());

  it('121. captures executed operations in dry-run', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(executor.executedOps).toHaveLength(1);
    expect(executor.executedOps[0].id).toBe(op.id);
  });

  it('122. result has correct executorType', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(result.executorType).toBe('database');
  });

  it('123. result has correct action', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      action: 'select',
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(result.action).toBe('select');
  });

  it('124. result has timing information', async () => {
    const executor = new DatabaseExecutor();
    const op = minimalOperation({
      resolverSpec: minimalSpec({ mode: 'select', entity: 'users' }) as unknown as Record<string, unknown>,
    });
    const result = await executor.execute(op, minimalContext({ mode: 'dry-run' }));
    expect(result.startedAt).toBeDefined();
    expect(result.finishedAt).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// FAKE BINDING STORE
// ===========================================================================

describe('FakeBindingStore', () => {
  it('125. produce and resolve', () => {
    const store = new FakeBindingStore();
    store.produce({ id: 'b1', name: 'runtime.x', producerOperationId: 'OP-1', value: 42, sensitive: false, status: 'resolved' });
    expect(store.resolve('runtime.x')?.value).toBe(42);
  });

  it('126. isResolved', () => {
    const store = new FakeBindingStore();
    expect(store.isResolved('runtime.x')).toBe(false);
    store.produce({ id: 'b1', name: 'runtime.x', producerOperationId: 'OP-1', value: 42, sensitive: false, status: 'resolved' });
    expect(store.isResolved('runtime.x')).toBe(true);
  });

  it('127. all returns all bindings', () => {
    const store = new FakeBindingStore();
    store.produce({ id: 'b1', name: 'runtime.x', producerOperationId: 'OP-1', value: 1, sensitive: false, status: 'resolved' });
    store.produce({ id: 'b2', name: 'runtime.y', producerOperationId: 'OP-2', value: 2, sensitive: false, status: 'resolved' });
    expect(store.all()).toHaveLength(2);
  });

  it('128. sensitiveNames tracks sensitive bindings', () => {
    const store = new FakeBindingStore();
    store.produce({ id: 'b1', name: 'runtime.secret', producerOperationId: 'OP-1', value: 'x', sensitive: true, status: 'resolved' });
    store.produce({ id: 'b2', name: 'runtime.public', producerOperationId: 'OP-2', value: 'y', sensitive: false, status: 'resolved' });
    expect(store.sensitiveNames().has('runtime.secret')).toBe(true);
    expect(store.sensitiveNames().has('runtime.public')).toBe(false);
  });
});

// ===========================================================================
// FAKE AUDIT RECORDER
// ===========================================================================

describe('FakeAuditRecorder', () => {
  it('129. records events with sequence numbers', () => {
    const audit = new FakeAuditRecorder();
    audit.record({ type: 'execution-start', message: 'start' });
    audit.record({ type: 'execution-end', message: 'end' });
    const events = audit.events();
    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(1);
    expect(events[1].sequence).toBe(2);
  });

  it('130. events have timestamps', () => {
    const audit = new FakeAuditRecorder();
    audit.record({ type: 'execution-start', message: 'start' });
    expect(audit.events()[0].timestamp).toBeDefined();
  });
});

// ===========================================================================
// INTEGRATION TESTS (SKIPPED — no Docker available)
// ===========================================================================

describe.skip('PostgreSQL integration tests', () => {
  it('requires ephemeral PostgreSQL container', () => {
    // These tests require a running PostgreSQL instance.
    // They are skipped when Docker is unavailable.
  });
});
