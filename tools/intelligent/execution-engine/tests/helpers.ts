// ---------------------------------------------------------------------------
// Test helpers – shared builders for execution-engine tests
// ---------------------------------------------------------------------------

import type {
  ExecutableDataPreparationIR,
  PreparationOperation,
  PreparationDependency,
  RuntimeBinding,
  RuntimeBindingResult,
  ResolutionUnresolved,
  ExecutionContext,
  ExecutionPolicy,
  TestProvenance,
} from '../src/models.js';
import { InMemoryBindingStore } from '../src/binding-store.js';
import { DefaultAuditRecorder } from '../src/audit.js';
import { defaultPolicy } from '../src/policy.js';

// ---- Provenance -----------------------------------------------------------

export function provenance(reqId = 'REQ-0001'): TestProvenance {
  return { requirementId: reqId };
}

// ---- Operations -----------------------------------------------------------

let opCounter = 0;

export function minimalOperation(overrides?: Partial<PreparationOperation>): PreparationOperation {
  opCounter++;
  return {
    id: `OP-${String(opCounter).padStart(4, '0')}`,
    dataItemId: `DATA-${String(opCounter).padStart(4, '0')}`,
    resolver: 'database',
    action: 'select',
    resourceId: 'res-1',
    parameters: {},
    consumes: [],
    produces: [],
    cleanupOperationIds: [],
    provenance: [provenance()],
    confidence: 0.7,
    ...overrides,
  };
}

/** Reset the operation counter for deterministic IDs. */
export function resetOpCounter(): void {
  opCounter = 0;
}

// ---- Dependencies ---------------------------------------------------------

let depCounter = 0;

export function minimalDependency(
  source: string,
  target: string,
  overrides?: Partial<PreparationDependency>,
): PreparationDependency {
  depCounter++;
  return {
    id: `DEP-${String(depCounter).padStart(4, '0')}`,
    sourceOperationId: source,
    targetOperationId: target,
    type: 'requires',
    ...overrides,
  };
}

export function resetDepCounter(): void {
  depCounter = 0;
}

// ---- Bindings -------------------------------------------------------------

export function minimalBinding(overrides?: Partial<RuntimeBinding>): RuntimeBinding {
  return {
    id: 'BIND-0001',
    name: 'test-binding',
    producerOperationId: 'OP-0001',
    value: 'test-value',
    sensitive: false,
    ...overrides,
  };
}

export function minimalBindingResult(overrides?: Partial<RuntimeBindingResult>): RuntimeBindingResult {
  return {
    id: 'BIND-0001',
    name: 'test-binding',
    producerOperationId: 'OP-0001',
    value: 'test-value',
    sensitive: false,
    status: 'resolved',
    ...overrides,
  };
}

// ---- Unresolved -----------------------------------------------------------

export function minimalUnresolved(overrides?: Partial<ResolutionUnresolved>): ResolutionUnresolved {
  return {
    id: 'UNRES-0001',
    dataItemId: 'DATA-0001',
    description: 'Unresolved data item',
    reason: 'no-mapping',
    provenance: [provenance()],
    ...overrides,
  };
}

// ---- Executable IR --------------------------------------------------------

export function minimalIR(overrides?: Partial<ExecutableDataPreparationIR>): ExecutableDataPreparationIR {
  return {
    schemaVersion: '1.0',
    operations: [],
    bindings: [],
    dependencies: [],
    unresolved: [],
    ...overrides,
  };
}

// ---- Execution context ----------------------------------------------------

export function minimalContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    mode: 'simulate',
    policy: defaultPolicy(),
    bindings: new InMemoryBindingStore(),
    audit: new DefaultAuditRecorder('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function minimalPolicy(overrides?: Partial<ExecutionPolicy>): ExecutionPolicy {
  return {
    ...defaultPolicy(),
    ...overrides,
  };
}

// ---- Reset all counters ---------------------------------------------------

export function resetCounters(): void {
  resetOpCounter();
  resetDepCounter();
}
