// Test Execution Orchestrator v1 — Test helpers.

import type {
  TestCase,
  TestExecutionContext,
  TestRunPolicy,
  RuntimeBindingStore,
  SecretProvider,
  SecretValue,
} from '../src/models.js';
import { defaultTestRunPolicy } from '../src/policy.js';
import { FixedClock } from '../src/clock.js';
import { InMemoryEvidenceCollector } from '../src/evidence/index.js';
import { InMemoryTestRunAuditRecorder } from '../src/audit.js';

// ---- Fake binding store ---------------------------------------------------

export class FakeBindingStore implements RuntimeBindingStore {
  private bindings = new Map<string, { id: string; name: string; producerOperationId: string; value: unknown; sensitive: boolean; status: 'resolved' | 'unresolved' | 'invalid' }>();

  produce(binding: { id: string; name: string; producerOperationId: string; value: unknown; sensitive: boolean; status: 'resolved' | 'unresolved' | 'invalid' }): void {
    this.bindings.set(binding.name, binding);
  }
  resolve(name: string) { return this.bindings.get(name); }
  isResolved(name: string): boolean { return this.bindings.has(name); }
  all() { return Array.from(this.bindings.values()); }
  sensitiveNames(): Set<string> {
    const s = new Set<string>();
    for (const [name, b] of this.bindings) { if (b.sensitive) s.add(name); }
    return s;
  }
}

// ---- Fake secret provider -------------------------------------------------

export class FakeSecretProvider implements SecretProvider {
  private secrets = new Map<string, string>();
  constructor(secrets?: Record<string, string>) {
    for (const [k, v] of Object.entries(secrets ?? {})) this.secrets.set(k, v);
  }
  async resolve(secretRef: string): Promise<SecretValue> {
    const v = this.secrets.get(secretRef);
    if (!v) throw new Error(`Secret '${secretRef}' not found`);
    return { value: v, redacted: '***REDACTED***' };
  }
}

// ---- Minimal builders -----------------------------------------------------

export function minimalTestCase(overrides?: Partial<TestCase>): TestCase {
  return {
    id: 'TC-0001',
    scenarioId: 'SCN-0001',
    requirementIds: ['REQ-0001'],
    title: 'Test case',
    objective: 'Test objective',
    type: 'ui',
    priority: 'medium',
    preconditions: [],
    inputs: [],
    dataNeeds: [],
    steps: [{ order: 1, action: 'Do something' }],
    expectedResults: [{ description: 'Something happened', verificationType: 'ui' }],
    cleanup: [],
    automation: { status: 'ready', reasons: [] },
    provenance: [{ requirementId: 'REQ-0001' }],
    confidence: 0.9,
    ...overrides,
  };
}

export function minimalContext(overrides?: Partial<TestExecutionContext>): TestExecutionContext {
  return {
    mode: 'simulate',
    policy: defaultTestRunPolicy({ mode: 'simulate' }),
    bindings: new FakeBindingStore(),
    secrets: new FakeSecretProvider(),
    evidence: new InMemoryEvidenceCollector(),
    audit: new InMemoryTestRunAuditRecorder(),
    clock: new FixedClock('2025-01-01T00:00:00.000Z'),
    runId: 'RUN-0001',
    testCaseId: 'TC-0001',
    environmentId: 'test',
    ...overrides,
  };
}

export function minimalPolicy(overrides?: Partial<TestRunPolicy>): TestRunPolicy {
  return defaultTestRunPolicy(overrides);
}
