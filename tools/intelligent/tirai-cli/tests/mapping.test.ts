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
    expect(errors.join(' ')).toContain('mutating SQL');
    expect(errors.join(' ')).toContain('approved');
  });
});
