// API Executor v1 — Test helpers.

import {
  DEFAULT_NETWORK_POLICY,
  type ExecutionContext,
  type ExecutionPolicy,
  type RuntimeBindingStore,
  type RuntimeBindingResult,
  type AuditRecorder,
  type AuditEvent,
  type SecretProvider,
  type SecretValue,
  type ResourceMapping,
  type ApiPreparationSpec,
  type PreparationOperation,
  type NetworkPolicy,
  type DataValueExpression,
  type TestProvenance,
} from '../src/models.js';
import { ApiErrorCode, ApiExecutorError } from '../src/errors.js';
// ---- Fake binding store ---------------------------------------------------

export class FakeBindingStore implements RuntimeBindingStore {
  private bindings = new Map<string, RuntimeBindingResult>();

  produce(binding: RuntimeBindingResult): void {
    this.bindings.set(binding.name, binding);
  }

  resolve(name: string): RuntimeBindingResult | undefined {
    return this.bindings.get(name);
  }

  isResolved(name: string): boolean {
    return this.bindings.has(name);
  }

  all(): RuntimeBindingResult[] {
    return Array.from(this.bindings.values());
  }

  sensitiveNames(): Set<string> {
    const sensitive = new Set<string>();
    for (const [name, binding] of this.bindings) {
      if (binding.sensitive) sensitive.add(name);
    }
    return sensitive;
  }
}

// ---- Fake audit recorder --------------------------------------------------

export class FakeAuditRecorder implements AuditRecorder {
  private _events: AuditEvent[] = [];
  private sequence = 0;

  record(event: Omit<AuditEvent, 'sequence' | 'timestamp'>): void {
    this.sequence++;
    this._events.push({
      ...event,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
    });
  }

  events(): AuditEvent[] {
    return this._events;
  }
}

// ---- Fake secret provider -------------------------------------------------

export class FakeSecretProvider implements SecretProvider {
  private secrets = new Map<string, string>();

  constructor(secrets?: Record<string, string>) {
    if (secrets) {
      for (const [key, value] of Object.entries(secrets)) {
        this.secrets.set(key, value);
      }
    }
  }

  async resolve(secretRef: string): Promise<SecretValue> {
    const value = this.secrets.get(secretRef);
    if (!value) {
      throw new ApiExecutorError(
        ApiErrorCode.API_SECRET_MISSING,
        `Secret '${secretRef}' not found`,
      );
    }
    return { value, redacted: '***REDACTED***' };
  }
}

// ---- Minimal builders -----------------------------------------------------

export function minimalContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    mode: 'dry-run',
    policy: minimalPolicy(),
    bindings: new FakeBindingStore(),
    audit: new FakeAuditRecorder(),
    ...overrides,
  };
}

export function minimalPolicy(overrides?: Partial<ExecutionPolicy>): ExecutionPolicy {
  return {
    mode: 'dry-run',
    allowMutation: false,
    allowedResourceIds: ['test-resource'],
    deniedResourceIds: [],
    allowedExecutorTypes: ['api', 'database', 'fake'],
    requireDryRunFirst: false,
    failFast: true,
    cleanupOnFailure: false,
    rollbackOnFailure: false,
    ...overrides,
  };
}

export function minimalMapping(overrides?: Partial<ResourceMapping>): ResourceMapping {
  return {
    logicalEntity: 'test-resource',
    resourceId: 'test-resource',
    resourceName: 'Test Resource',
    fieldMappings: {
      baseUrl: 'https://api.test.local',
    },
    ...overrides,
  };
}

export function minimalSpec(overrides?: Partial<ApiPreparationSpec>): ApiPreparationSpec {
  return {
    operationId: 'test-op',
    resource: 'test-resource',
    methodIntent: 'GET',
    requestDataBindings: [],
    responseBindings: [],
    ...overrides,
  };
}

export function minimalOperation(
  spec: ApiPreparationSpec,
  overrides?: Partial<PreparationOperation>,
): PreparationOperation {
  return {
    id: spec.operationId,
    dataItemId: 'test-data-item',
    resolver: 'api',
    action: 'create',
    resourceId: spec.resource,
    parameters: {},
    produces: [],
    consumes: [],
    cleanupOperationIds: [],
    provenance: [{ source: 'test', timestamp: new Date().toISOString() }],
    confidence: 1.0,
    resolverSpec: spec as unknown as Record<string, unknown>,
    ...overrides,
  };
}

export function minimalNetworkPolicy(overrides?: Partial<NetworkPolicy>): NetworkPolicy {
  return {
    ...DEFAULT_NETWORK_POLICY,
    ...overrides,
  };
}

export function literalValue(value: unknown): DataValueExpression {
  return { type: 'literal', value };
}

export function bindingValue(name: string): DataValueExpression {
  return { type: 'binding', binding: name };
}

export function provenance(): TestProvenance {
  return { source: 'test', timestamp: new Date().toISOString() };
}
