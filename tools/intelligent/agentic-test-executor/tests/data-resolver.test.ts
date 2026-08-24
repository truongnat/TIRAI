// ---------------------------------------------------------------------------
// Data resolver tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { resolveDataItem } from '../src/data/data-resolver.js';
import type { TestDataItem } from 'test-data-planner';

function makeDataItem(overrides: Partial<TestDataItem> = {}): TestDataItem {
  return {
    id: 'DATA-001',
    name: 'test-user',
    description: 'Test user account',
    type: 'account',
    lifecycle: 'test-scoped',
    strategy: 'create-new',
    constraints: [],
    dependencies: [],
    relatedTestCaseIds: [],
    relatedRequirementIds: [],
    relatedEntityIds: [],
    setup: [],
    cleanup: [],
    provenance: [],
    confidence: 0.9,
    ...overrides,
  } as TestDataItem;
}

describe('resolveDataItem', () => {
  it('resolves from input value', () => {
    const item = makeDataItem({ id: 'DATA-001', name: 'username' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'username', value: 'demo' }],
    });
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('demo');
  });

  it('resolves secret reference from input', () => {
    const item = makeDataItem({ id: 'DATA-002', name: 'password' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'password', value: 'secret://login/password' }],
      secrets: { 'login/password': 'test-password' },
    });
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('test-password');
    expect(result.secretRef).toBe('login/password');
  });

  it('returns unresolved when secret not found', () => {
    const item = makeDataItem({ id: 'DATA-002', name: 'password' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'password', value: 'secret://login/password' }],
      secrets: {},
    });
    expect(result.resolved).toBe(false);
    expect(result.unresolvedReason).toContain('Secret not found');
  });

  it('resolves from bindings', () => {
    const item = makeDataItem({ id: 'DATA-003', name: 'token' });
    const bindings = new Map([['DATA-003', 'abc-123']]);
    const result = resolveDataItem(item, { bindings });
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('abc-123');
  });

  it('generates deterministic value for account type', () => {
    const item = makeDataItem({ id: 'DATA-004', name: 'user-email', description: 'User email address', type: 'account' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('test-DATA-004@example.com');
  });

  it('generates deterministic password', () => {
    const item = makeDataItem({ id: 'DATA-005', name: 'pwd', description: 'Account password', type: 'account' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('TestPass123!');
  });

  it('generates deterministic username', () => {
    const item = makeDataItem({ id: 'DATA-006', name: 'user', description: 'Test username', type: 'account' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('user_DATA-006');
  });

  it('returns unresolved for unknown data item', () => {
    const item = makeDataItem({ id: 'DATA-007', name: 'mystery', description: 'Unknown thing', type: 'configuration', strategy: 'create-new' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(false);
    expect(result.unresolvedReason).toContain('No resolution path');
  });

  it('resolves by matching item id in inputs', () => {
    const item = makeDataItem({ id: 'DATA-008', name: 'something' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'DATA-008', value: 'matched-by-id' }],
    });
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('matched-by-id');
  });

  it('resolves reuse-existing strategy with deterministic value', () => {
    const item = makeDataItem({ id: 'DATA-009', name: 'acct', description: 'Account name', strategy: 'reuse-existing' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('Test DATA-009');
  });
});
