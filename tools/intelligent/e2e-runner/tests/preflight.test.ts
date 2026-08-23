// Preflight tests — validates all inputs before execution (spec §22-24).
// Spec §8-15, §95-106, §165-168.

import { describe, it, expect } from 'vitest';
import { runPreflight } from '../src/preflight.js';
import { makeInput, makeProfile, makePolicy, makeMappings, makeDataPlan, makeInputHashes, makeMapping, makeTestCase } from './fixtures.js';

describe('preflight — ready (§95)', () => {
  it('returns ready for valid input', () => {
    const input = makeInput();
    const policy = makePolicy();
    const hashes = makeInputHashes();
    const result = runPreflight(input, policy, hashes);
    expect(result.status).toBe('ready');
    expect(result.blockers).toHaveLength(0);
  });

  it('includes all expected checks', () => {
    const input = makeInput();
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    const checkIds = result.checks.map((c) => c.id);
    expect(checkIds).toContain('profile-valid');
    expect(checkIds).toContain('environment-selected');
    expect(checkIds).toContain('test-cases-present');
    expect(checkIds).toContain('mappings-complete');
    expect(checkIds).toContain('execution-gate');
    expect(checkIds).toContain('no-graph-cycle');
  });
});

describe('preflight — blockers (§96-106)', () => {
  it('blocks on invalid profile (§8)', () => {
    const input = makeInput({ profile: { project: { id: '' } } as any });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_PROFILE_INVALID')).toBe(true);
  });

  it('blocks on missing environment', () => {
    const profile = makeProfile({ environment: { id: '', name: '', safety: 'isolated' } } as any);
    const input = makeInput({ profile });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.blockers.some((b) => b.code === 'RUNNER_ENVIRONMENT_MISSING')).toBe(true);
  });

  it('blocks on empty test cases (§4)', () => {
    const input = makeInput({ testCases: [] });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.blockers.some((b) => b.code === 'RUNNER_TEST_CASES_MISSING')).toBe(true);
  });

  it('blocks on no mappings loaded', () => {
    const input = {
      profile: makeProfile(),
      testCases: [makeTestCase()],
      mappings: undefined as any,
    };
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.blockers.some((b) => b.code === 'RUNNER_MAPPING_INCOMPLETE')).toBe(true);
  });

  it('blocks when no mappings are ready', () => {
    const tc = [makeTestCase()];
    const mappings = makeMappings({
      testMappings: [makeMapping({ testCaseId: tc[0].id, status: 'partial' })],
    });
    const input = makeInput({ testCases: tc, mappings });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.blockers.some((b) => b.code === 'RUNNER_MAPPING_INCOMPLETE')).toBe(true);
  });

  it('blocks production execute (§14, §106)', () => {
    const profile = makeProfile({
      environment: { id: 'prod', name: 'Prod', safety: 'production' },
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const input = makeInput({ profile });
    const result = runPreflight(input, policy, makeInputHashes());
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_PRODUCTION_EXECUTE_DENIED')).toBe(true);
  });

  it('blocks execute without allowExecution (§11)', () => {
    const policy = makePolicy({ mode: 'execute', allowExecution: false });
    const input = makeInput();
    const result = runPreflight(input, policy, makeInputHashes());
    expect(result.status).toBe('blocked');
    expect(result.blockers.some((b) => b.code === 'RUNNER_POLICY_CONFLICT')).toBe(true);
  });
});

describe('preflight — warnings (§9-10)', () => {
  it('warns on partial mappings', () => {
    const tc = [makeTestCase(), makeTestCase({ id: 'TC-X' })];
    const mappings = makeMappings({
      testMappings: [
        makeMapping({ testCaseId: tc[0].id, status: 'ready' }),
        makeMapping({ testCaseId: tc[1].id, status: 'partial' }),
      ],
    });
    const input = makeInput({ testCases: tc, mappings });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.warnings.some((w) => w.code === 'RUNNER_PARTIAL_MAPPING')).toBe(true);
  });

  it('warns on manual test cases', () => {
    const tc = [makeTestCase()];
    const mappings = makeMappings({
      testMappings: [makeMapping({ testCaseId: tc[0].id, status: 'manual' })],
    });
    const input = makeInput({ testCases: tc, mappings });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.warnings.some((w) => w.code === 'RUNNER_MANUAL_TEST_CASES')).toBe(true);
  });

  it('warns on production environment', () => {
    const profile = makeProfile({
      environment: { id: 'prod', name: 'Prod', safety: 'production' },
    });
    const input = makeInput({ profile });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('preflight — graph cycle detection', () => {
  it('passes when no dependency graph', () => {
    const input = makeInput();
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    const cycleCheck = result.checks.find((c) => c.id === 'no-graph-cycle');
    expect(cycleCheck?.status).toBe('passed');
  });

  it('passes for acyclic graph', () => {
    const dataPlan = makeDataPlan({
      dependencyGraph: [
        { id: 'A', sourceDataItemId: 'DI-001', targetDataItemId: 'DI-002', type: 'sequential' },
      ],
    });
    const input = makeInput({ dataPlan });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    const cycleCheck = result.checks.find((c) => c.id === 'no-graph-cycle');
    expect(cycleCheck?.status).toBe('passed');
  });

  it('detects cycle in dependency graph', () => {
    const dataPlan = makeDataPlan({
      dependencyGraph: [
        { id: 'A', sourceDataItemId: 'DI-001', targetDataItemId: 'DI-002', type: 'sequential', dependsOn: ['B'] } as any,
        { id: 'B', sourceDataItemId: 'DI-002', targetDataItemId: 'DI-001', type: 'sequential', dependsOn: ['A'] } as any,
      ],
    });
    const input = makeInput({ dataPlan });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.blockers.some((b) => b.code === 'RUNNER_GRAPH_CYCLE')).toBe(true);
  });
});

describe('preflight — data plan checks', () => {
  it('skips data plan check when no data plan', () => {
    const input = makeInput();
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    const check = result.checks.find((c) => c.id === 'data-plan-fresh');
    expect(check?.status).toBe('skipped');
  });

  it('passes data plan check when data plan present', () => {
    const input = makeInput({ dataPlan: makeDataPlan() });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    const check = result.checks.find((c) => c.id === 'data-plan-fresh');
    expect(check?.status).toBe('passed');
  });
});

describe('preflight — no execution after blocker (§24)', () => {
  it('returns blocked status preventing all execution', () => {
    const input = makeInput({ testCases: [] });
    const result = runPreflight(input, makePolicy(), makeInputHashes());
    expect(result.status).toBe('blocked');
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});

describe('preflight — shared-nonprod warning (§15)', () => {
  it('warns on shared-nonprod with execute mode', () => {
    const profile = makeProfile({
      environment: { id: 'staging', name: 'Staging', safety: 'shared-nonprod' },
    });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const input = makeInput({ profile });
    const result = runPreflight(input, policy, makeInputHashes());
    expect(result.warnings.some((w) => w.code === 'RUNNER_SHARED_NONPROD_MUTATION')).toBe(true);
  });
});
