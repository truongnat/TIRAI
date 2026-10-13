import { describe, expect, it } from 'vitest';
import { validateMappingItems } from '../src/commands/mapping.js';

describe('execution mapping validation', () => {
  it('accepts an explicit API operation', () => {
    expect(validateMappingItems([{ id: 'get-users', method: 'GET', endpoint: '/users' }], 'api')).toEqual([]);
  });

  it('rejects incomplete and duplicate API mappings', () => {
    const errors = validateMappingItems([{ id: 'same' }, { id: 'same', method: 'GET', endpoint: '/users' }], 'api');
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toContain('requires method and endpoint');
    expect(errors.join(' ')).toContain('unique');
  });

  it('rejects mutating or unapproved database mappings', () => {
    const errors = validateMappingItems([{ id: 'write', query: 'DELETE FROM users', readOnly: false, approved: false }], 'database');
    expect(errors.join(' ')).toContain('read-only');
    expect(errors.join(' ')).toContain('read-only SELECT');
    expect(errors.join(' ')).toContain('approved');
  });

  it('accepts an approved single-statement read-only SELECT', () => {
    expect(validateMappingItems([{ id: 'list', query: 'SELECT id FROM users WHERE active = $1;', readOnly: true, approved: true }], 'database')).toEqual([]);
  });

  it('rejects CALL/EXEC and multi-statement queries even with readOnly true', () => {
    const calls = validateMappingItems([{ id: 'call', query: 'CALL mutate_data()', readOnly: true, approved: true }], 'database');
    expect(calls.join(' ')).toContain('read-only SELECT');
    const chained = validateMappingItems([{ id: 'chain', query: 'SELECT 1; DELETE FROM users', readOnly: true, approved: true }], 'database');
    expect(chained.join(' ')).toContain('single statement');
    const commented = validateMappingItems([{ id: 'cmt', query: 'SELECT 1 -- bypass\nDELETE FROM users', readOnly: true, approved: true }], 'database');
    expect(commented.join(' ')).toContain('without comments');
  });
});
