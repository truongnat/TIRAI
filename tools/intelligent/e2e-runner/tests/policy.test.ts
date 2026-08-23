// Policy tests — safety gates, execution controls, mode validation.
// Spec §6-16, §21-28, §124.

import { describe, it, expect } from 'vitest';
import {
  defaultPolicy,
  checkExecutionGate,
  checkDatabaseMutationGate,
  checkApiMutationGate,
  checkBrowserGate,
  checkCommandGate,
  isValidMode,
  isSharedNonprodRestricted,
  enforceMaxTests,
} from '../src/policy.js';

describe('policy — defaultPolicy', () => {
  it('returns dry-run mode by default (§6)', () => {
    const p = defaultPolicy();
    expect(p.mode).toBe('dry-run');
  });

  it('disallows execution by default (§11)', () => {
    const p = defaultPolicy();
    expect(p.allowExecution).toBe(false);
    expect(p.allowDatabaseMutation).toBe(false);
    expect(p.allowApiMutation).toBe(false);
    expect(p.allowBrowserExecution).toBe(false);
    expect(p.allowCommands).toBe(false);
  });

  it('sets maxConcurrency=1 by default (§79)', () => {
    const p = defaultPolicy();
    expect(p.maxConcurrency).toBe(1);
  });

  it('enables cleanup by default (§40)', () => {
    const p = defaultPolicy();
    expect(p.cleanupAfterRun).toBe(true);
    expect(p.cleanupOnFailure).toBe(true);
  });

  it('enables evidence collection by default', () => {
    const p = defaultPolicy();
    expect(p.collectEvidence).toBe(true);
  });

  it('accepts overrides', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, maxTests: 10 });
    expect(p.mode).toBe('execute');
    expect(p.allowExecution).toBe(true);
    expect(p.maxTests).toBe(10);
  });

  it('disables failFast by default', () => {
    const p = defaultPolicy();
    expect(p.failFast).toBe(false);
  });

  it('has empty environmentAllowlist by default', () => {
    const p = defaultPolicy();
    expect(p.environmentAllowlist).toEqual([]);
  });
});

describe('policy — checkExecutionGate (§11, §14)', () => {
  it('denies execute on production (§14)', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true });
    const blocker = checkExecutionGate(p, 'production');
    expect(blocker).not.toBeNull();
    expect(blocker!.code).toBe('RUNNER_PRODUCTION_EXECUTE_DENIED');
  });

  it('denies execute when allowExecution=false (§11)', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: false });
    const blocker = checkExecutionGate(p, 'isolated');
    expect(blocker).not.toBeNull();
    expect(blocker!.code).toBe('RUNNER_POLICY_CONFLICT');
  });

  it('allows execute on isolated with allowExecution=true (§16)', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true });
    const blocker = checkExecutionGate(p, 'isolated');
    expect(blocker).toBeNull();
  });

  it('returns null for non-execute modes', () => {
    const p = defaultPolicy({ mode: 'dry-run' });
    expect(checkExecutionGate(p, 'production')).toBeNull();
    expect(checkExecutionGate(p, 'isolated')).toBeNull();
  });

  it('returns null for validate mode on production', () => {
    const p = defaultPolicy({ mode: 'validate' });
    expect(checkExecutionGate(p, 'production')).toBeNull();
  });

  it('returns null for simulate mode', () => {
    const p = defaultPolicy({ mode: 'simulate' });
    expect(checkExecutionGate(p, 'isolated')).toBeNull();
  });
});

describe('policy — mutation gates (§12)', () => {
  it('blocks DB mutation in execute mode without flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowDatabaseMutation: false });
    const b = checkDatabaseMutationGate(p);
    expect(b).not.toBeNull();
    expect(b!.code).toBe('RUNNER_POLICY_CONFLICT');
  });

  it('allows DB mutation in execute mode with flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowDatabaseMutation: true });
    expect(checkDatabaseMutationGate(p)).toBeNull();
  });

  it('does not block DB mutation in non-execute modes', () => {
    const p = defaultPolicy({ mode: 'dry-run', allowDatabaseMutation: false });
    expect(checkDatabaseMutationGate(p)).toBeNull();
  });

  it('blocks API mutation in execute mode without flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowApiMutation: false });
    expect(checkApiMutationGate(p)).not.toBeNull();
  });

  it('allows API mutation in execute mode with flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowApiMutation: true });
    expect(checkApiMutationGate(p)).toBeNull();
  });

  it('blocks browser in execute mode without flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowBrowserExecution: false });
    expect(checkBrowserGate(p)).not.toBeNull();
  });

  it('allows browser in execute mode with flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowBrowserExecution: true });
    expect(checkBrowserGate(p)).toBeNull();
  });

  it('blocks commands in execute mode without flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowCommands: false });
    expect(checkCommandGate(p)).not.toBeNull();
  });

  it('allows commands in execute mode with flag', () => {
    const p = defaultPolicy({ mode: 'execute', allowExecution: true, allowCommands: true });
    expect(checkCommandGate(p)).toBeNull();
  });
});

describe('policy — isValidMode (§6)', () => {
  it('accepts validate', () => expect(isValidMode('validate')).toBe(true));
  it('accepts dry-run', () => expect(isValidMode('dry-run')).toBe(true));
  it('accepts simulate', () => expect(isValidMode('simulate')).toBe(true));
  it('accepts execute', () => expect(isValidMode('execute')).toBe(true));
  it('rejects unknown mode', () => expect(isValidMode('deploy')).toBe(false));
  it('rejects empty string', () => expect(isValidMode('')).toBe(false));
});

describe('policy — isSharedNonprodRestricted (§15)', () => {
  it('returns true for shared-nonprod', () => {
    expect(isSharedNonprodRestricted('shared-nonprod')).toBe(true);
  });
  it('returns false for isolated', () => {
    expect(isSharedNonprodRestricted('isolated')).toBe(false);
  });
  it('returns false for production', () => {
    expect(isSharedNonprodRestricted('production')).toBe(false);
  });
});

describe('policy — enforceMaxTests (§27)', () => {
  it('returns undefined when both are undefined', () => {
    expect(enforceMaxTests(undefined, undefined)).toBeUndefined();
  });
  it('returns policy max when CLI is undefined', () => {
    expect(enforceMaxTests(10, undefined)).toBe(10);
  });
  it('returns CLI max when policy is undefined', () => {
    expect(enforceMaxTests(undefined, 5)).toBe(5);
  });
  it('returns minimum of both', () => {
    expect(enforceMaxTests(10, 5)).toBe(5);
    expect(enforceMaxTests(5, 10)).toBe(5);
  });
  it('CLI cannot exceed policy max', () => {
    expect(enforceMaxTests(3, 100)).toBe(3);
  });
});
