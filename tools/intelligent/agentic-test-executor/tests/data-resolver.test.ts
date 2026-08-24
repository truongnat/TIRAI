// ---------------------------------------------------------------------------
// Data resolver tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { resolveDataItem, resolveDataItems } from '../src/data/data-resolver.js';
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
    expect(result.status).toBe('RESOLVED');
    expect(result.source).toBe('supplied-input');
    expect(result.value).toBe('demo');
  });

  it('resolves secret reference from input', () => {
    const item = makeDataItem({ id: 'DATA-002', name: 'password' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'password', value: 'secret://login/password' }],
      secrets: { 'login/password': 'test-password' },
    });
    expect(result.resolved).toBe(true);
    expect(result.status).toBe('RESOLVED');
    expect(result.source).toBe('secret');
    expect(result.sensitive).toBe(true);
    expect(result.value).toBe('test-password');
    expect(result.secretRef).toBe('login/password');
  });

  it('resolves a supplied value for an existence-required account', () => {
    const item = makeDataItem({
      id: 'DATA-EXISTING-001',
      name: 'valid-username',
      description: 'Valid existing username',
      strategy: 'reuse-existing',
      lifecycle: 'existing',
    });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'valid-username', value: 'demo' }],
    });
    expect(result.status).toBe('RESOLVED');
    expect(result.semantics).toBe('EXISTENCE_REQUIRED');
    expect(result.source).toBe('supplied-input');
    expect(result.value).toBe('demo');
  });

  it('returns unresolved when secret not found', () => {
    const item = makeDataItem({ id: 'DATA-002', name: 'password' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'password', value: 'secret://login/password' }],
      secrets: {},
    });
    expect(result.resolved).toBe(false);
    expect(result.status).toBe('NEEDS_CAPABILITY');
    expect(result.unresolvedReason).toContain('Secret reference could not be resolved');
  });

  it('resolves from bindings', () => {
    const item = makeDataItem({ id: 'DATA-003', name: 'token' });
    const bindings = new Map([['DATA-003', 'abc-123']]);
    const result = resolveDataItem(item, { bindings });
    expect(result.resolved).toBe(true);
    expect(result.status).toBe('RESOLVED');
    expect(result.source).toBe('runtime-binding');
    expect(result.value).toBe('abc-123');
  });

  it('generates deterministic value for account type', () => {
    const item = makeDataItem({ id: 'DATA-004', name: 'user-email', description: 'User email address', type: 'account' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.status).toBe('GENERATED');
    expect(result.semantics).toBe('SYNTHETIC_ALLOWED');
    expect(result.source).toBe('generator');
    expect(result.value).toBe('test-DATA-004@example.com');
  });

  it('generates deterministic password', () => {
    const item = makeDataItem({ id: 'DATA-005', name: 'pwd', description: 'Account password', type: 'account' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.status).toBe('GENERATED');
    expect(result.sensitive).toBe(true);
    expect(result.value).toBe('TestPass123!');
  });

  it('allows generation for an explicitly invalid password', () => {
    const item = makeDataItem({
      id: 'DATA-INVALID-PASSWORD',
      name: 'invalid-password',
      description: 'Invalid password for a negative login test',
      strategy: 'generate',
      lifecycle: 'generated',
    });
    const result = resolveDataItem(item, {});
    expect(result.status).toBe('GENERATED');
    expect(result.semantics).toBe('SYNTHETIC_ALLOWED');
    expect(result.source).toBe('generator');
  });

  it('generates deterministic username', () => {
    const item = makeDataItem({ id: 'DATA-006', name: 'user', description: 'Test username', type: 'account' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(true);
    expect(result.status).toBe('GENERATED');
    expect(result.value).toBe('user_DATA-006');
  });

  it('returns unresolved for unknown data item', () => {
    const item = makeDataItem({ id: 'DATA-007', name: 'mystery', description: 'Unknown thing', type: 'configuration', strategy: 'create-new' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.unresolvedReason).toContain('No safe synthetic generation path');
  });

  it('resolves by matching item id in inputs', () => {
    const item = makeDataItem({ id: 'DATA-008', name: 'something' });
    const result = resolveDataItem(item, {
      inputs: [{ name: 'DATA-008', value: 'matched-by-id' }],
    });
    expect(result.resolved).toBe(true);
    expect(result.value).toBe('matched-by-id');
  });

  it('blocks reuse-existing strategy without an existing value or capability', () => {
    const item = makeDataItem({ id: 'DATA-009', name: 'acct', description: 'Account name', strategy: 'reuse-existing' });
    const result = resolveDataItem(item, {});
    expect(result.resolved).toBe(false);
    expect(result.status).toBe('NEEDS_CAPABILITY');
    expect(result.semantics).toBe('EXISTENCE_REQUIRED');
    expect(result.value).toBeUndefined();
    expect(result.reason).toContain('no value was invented');
  });

  it('blocks a valid existing account even when the item strategy is incomplete', () => {
    const item = makeDataItem({
      id: 'DATA-010',
      name: 'valid-username',
      description: 'Valid existing username for the login account',
      strategy: 'unknown',
    });
    const result = resolveDataItem(item, {});
    expect(result.status).toBe('NEEDS_CAPABILITY');
    expect(result.semantics).toBe('EXISTENCE_REQUIRED');
    expect(result.value).toBeUndefined();
    expect(result.value).not.toBe('user_DATA-010');
  });

  it('resolves a secret through the async execution context', async () => {
    const item = makeDataItem({ id: 'DATA-011', name: 'username', description: 'Valid username' });
    const results = await resolveDataItems([item], {
      inputs: [{ name: 'username', value: 'secret://login/username' }],
      secretResolver: async (secretRef) => secretRef === 'login/username' ? 'demo' : undefined,
    });
    expect(results[0].status).toBe('RESOLVED');
    expect(results[0].source).toBe('secret');
    expect(results[0].secretRef).toBe('login/username');
    expect(results[0].value).toBe('demo');
  });
});
