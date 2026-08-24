// ---------------------------------------------------------------------------
// Agentic Phase 2B — data need coordinator
// ---------------------------------------------------------------------------

import {
  resolveDataPlan,
  type ExecutableDataPreparationIR,
  type PreparationOperation,
  type ResourceMapping,
} from 'data-resolver';
import type {
  DataDependency,
  TestDataItem,
  TestDataPlanIR,
  TestDataQualityMetrics,
} from 'test-data-planner';
import type {
  RuntimeBindingStore,
  SecretProvider,
} from 'execution-engine';
import {
  classifyDataNeed,
  isSensitiveDataItem,
} from './data-resolver.js';
import {
  buildPlanningEnvironment,
  type RuntimeCapabilityInventory,
  type RuntimeDiscoveryRequest,
  type RuntimeDiscoveryResult,
} from './runtime-capability-inventory.js';
import { RuntimePreparationError, RuntimePreparationExecutor } from './preparation-executor.js';
import { RuntimeDataStore } from './runtime-data-store.js';
import type {
  DataNeedStatus,
  DataResolutionEvidence,
  DataResolutionMetrics,
  DataResolutionResult,
} from '../models.js';

export interface DataNeedCoordinatorContext {
  inputs?: Array<{ name: string; value?: unknown; valueStrategy?: string }>;
  bindings?: RuntimeBindingStore;
  secretProvider?: SecretProvider;
}

export interface DataNeedCoordinatorOptions {
  inventory: RuntimeCapabilityInventory;
  generationSeed?: string;
}

export interface DataNeedCoordinationResult {
  status: 'ready' | 'blocked';
  resolutions: DataResolutionResult[];
  runtimeData: RuntimeDataStore;
  plan: ExecutableDataPreparationIR;
  planWarnings: Array<{ code: string; message: string; dataItemId?: string; operationId?: string }>;
  metrics: DataResolutionMetrics;
}

export class DataNeedCoordinatorError extends Error {
  readonly dataItemId: string;

  constructor(dataItemId: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DataNeedCoordinatorError';
    this.dataItemId = dataItemId;
  }
}

export class DataNeedCoordinator {
  private readonly inventory: RuntimeCapabilityInventory;
  private readonly generationSeed: string;
  private readonly preparationExecutor = new RuntimePreparationExecutor();

  constructor(options: DataNeedCoordinatorOptions) {
    this.inventory = options.inventory;
    this.generationSeed = options.generationSeed ?? 'tirai-phase2b';
  }

  async resolve(
    items: TestDataItem[],
    context: DataNeedCoordinatorContext = {},
  ): Promise<DataNeedCoordinationResult> {
    const planInput = buildPhase2BPlan(items);
    const environment = buildPlanningEnvironment(this.inventory);
    const mappings = mergeMappings(this.inventory);
    const planned = resolveDataPlan(planInput, environment, {
      mappings,
      manualFallback: false,
      generationSeed: this.generationSeed,
    });
    const operationByItem = new Map(
      planned.ir.operations.map((operation) => [operation.dataItemId, operation]),
    );
    const resolutions: DataResolutionResult[] = [];
    const runtimeData = new RuntimeDataStore();
    const metrics = emptyDataResolutionMetrics(items.length);

    for (const item of topologicalItemOrder(items)) {
      const direct = await this.resolveDirect(item, context, runtimeData);
      if (direct) {
        this.recordResolution(metrics, direct);
        resolutions.push(direct);
        if (direct.resolved) continue;
        // An explicitly supplied secret reference is authoritative. Missing
        // secret capability must not silently fall through to generation.
        if (direct.source === 'secret' || direct.status === 'BLOCKED') break;
      }

      const dependencyBlock = this.checkDependencies(item, runtimeData);
      if (dependencyBlock) {
        const blocked = unresolvedResolution(
          item,
          'BLOCKED',
          dependencyBlock,
          undefined,
          [{ kind: 'binding', description: 'Required runtime dependency is unresolved.' }],
        );
        this.recordResolution(metrics, blocked);
        resolutions.push(blocked);
        break;
      }

      const operation = operationByItem.get(item.id);
      const resolution = classifyDataNeed(item) === 'EXISTENCE_REQUIRED'
        ? await this.discoverExisting(item, operation, environment, mappings, runtimeData, metrics)
        : await this.generateSynthetic(item, operation, runtimeData);

      this.recordResolution(metrics, resolution);
      resolutions.push(resolution);
      if (!resolution.resolved) break;
    }

    return {
      status: resolutions.every((resolution) => resolution.resolved) ? 'ready' : 'blocked',
      resolutions,
      runtimeData,
      plan: planned.ir,
      planWarnings: planned.warnings,
      metrics,
    };
  }

  private async resolveDirect(
    item: TestDataItem,
    context: DataNeedCoordinatorContext,
    runtimeData: RuntimeDataStore,
  ): Promise<DataResolutionResult | undefined> {
    const input = context.inputs?.find(
      (candidate) => candidate.name === item.name || candidate.name === item.id,
    );

    if (input?.value !== undefined) {
      if (typeof input.value === 'string' && input.value.startsWith('secret://')) {
        const secretRef = input.value.slice('secret://'.length);
        if (!context.secretProvider) {
          return unresolvedResolution(
            item,
            'NEEDS_CAPABILITY',
            'A secret provider is required for this secret reference.',
            'secret',
            [{ kind: 'secret', description: 'Secret reference supplied without a resolver.', reference: secretRef }],
          );
        }
        try {
          const secret = await context.secretProvider.resolve(secretRef);
          return this.bindResolved(item, secret.value, 'secret', runtimeData, [
            { kind: 'secret', description: 'Value resolved from a supplied secret reference.', reference: secretRef, sensitive: true },
          ], { secretRef });
        } catch {
          return unresolvedResolution(
            item,
            'NEEDS_CAPABILITY',
            'Secret reference could not be resolved by the supplied secret capability.',
            'secret',
            [{ kind: 'secret', description: 'Secret reference resolution failed.', reference: secretRef, sensitive: true }],
            { secretRef, sensitive: true },
          );
        }
      }

      return this.bindResolved(item, input.value, 'supplied-input', runtimeData, [
        { kind: 'supplied', description: 'Value supplied by the TestCase input.' },
      ]);
    }

    if (context.bindings && typeof context.bindings.resolve === 'function') {
      for (const name of [item.id, item.name, `runtime.${item.id}`]) {
        const binding = context.bindings.resolve(name);
        if (binding?.status === 'resolved' && binding.value !== undefined) {
          return this.bindResolved(item, binding.value, 'runtime-binding', runtimeData, [
            { kind: 'binding', description: 'Value reused from an existing runtime binding.', reference: name },
          ], { bindingRef: name, sensitive: binding.sensitive });
        }
      }
    }

    return undefined;
  }

  private async discoverExisting(
    item: TestDataItem,
    operation: PreparationOperation | undefined,
    environment: ReturnType<typeof buildPlanningEnvironment>,
    mappings: ResourceMapping[],
    runtimeData: RuntimeDataStore,
    metrics: DataResolutionMetrics,
  ): Promise<DataResolutionResult> {
    const request: RuntimeDiscoveryRequest = { item, operation, environment };

    if (
      this.inventory.browser.available &&
      this.inventory.browser.discoverRuntimeState &&
      this.inventory.browser.discovery
    ) {
      metrics.browserDiscoveryRounds++;
      const discovered = await this.callDiscovery(item, this.inventory.browser.discovery, request);
      if (discovered) {
        return this.bindDiscovered(item, discovered, 'browser', runtimeData);
      }
    }

    if (
      this.inventory.database.available &&
      this.inventory.database.readable &&
      this.inventory.database.discovery &&
      operation &&
      isDatabaseDiscoveryGrounded(item, operation, mappings)
    ) {
      metrics.databaseDiscoveryCalls++;
      const discovered = await this.callDiscovery(item, this.inventory.database.discovery, request);
      if (discovered) {
        return this.bindDiscovered(item, discovered, 'database', runtimeData);
      }
      return unresolvedResolution(
        item,
        'BLOCKED',
        'Database discovery returned no matching existing data.',
        'database',
        [{ kind: 'database', description: 'Grounded database discovery returned no matching record.' }],
      );
    }

    if (
      this.inventory.api.available &&
      this.inventory.api.readable &&
      this.inventory.api.discovery &&
      operation &&
      isApiDiscoveryGrounded(operation, this.inventory.api)
    ) {
      metrics.apiDiscoveryCalls++;
      const discovered = await this.callDiscovery(item, this.inventory.api.discovery, request);
      if (discovered) {
        return this.bindDiscovered(item, discovered, 'api', runtimeData);
      }
      return unresolvedResolution(
        item,
        'BLOCKED',
        'API discovery returned no matching existing data.',
        'api',
        [{ kind: 'api', description: 'Grounded API discovery returned no matching resource.' }],
      );
    }

    return unresolvedResolution(
      item,
      'NEEDS_CAPABILITY',
      'Existing data requires a supplied value, runtime binding, or an explicit read-only discovery capability.',
      undefined,
      [{ kind: 'binding', description: 'No permitted capability can prove this existing data item.' }],
    );
  }

  private async generateSynthetic(
    item: TestDataItem,
    operation: PreparationOperation | undefined,
    runtimeData: RuntimeDataStore,
  ): Promise<DataResolutionResult> {
    if (!operation || operation.resolver !== 'value-generator') {
      return unresolvedResolution(
        item,
        'BLOCKED',
        'Synthetic generation is not supported by a grounded value-generator operation for this item.',
        'generator',
        [{ kind: 'generator', description: 'No safe value-generator preparation operation was planned.' }],
      );
    }

    try {
      const value = await this.preparationExecutor.generate(
        item,
        operation,
        runtimeData,
        this.generationSeed,
      );
      return this.bindResolved(item, value, 'generator', runtimeData, [
        { kind: 'generator', description: 'Value generated by the existing deterministic value-generator executor.' },
      ], { status: 'GENERATED' });
    } catch (error) {
      if (error instanceof RuntimePreparationError) {
        return unresolvedResolution(item, 'BLOCKED', error.message, 'generator', [
          { kind: 'generator', description: 'Safe generation failed.' },
        ]);
      }
      throw error;
    }
  }

  private async callDiscovery(
    item: TestDataItem,
    adapter: (request: RuntimeDiscoveryRequest) => Promise<RuntimeDiscoveryResult | undefined>,
    request: RuntimeDiscoveryRequest,
  ): Promise<RuntimeDiscoveryResult | undefined> {
    try {
      return await adapter(request);
    } catch (error) {
      throw new DataNeedCoordinatorError(
        item.id,
        `Runtime ${request.operation?.resolver ?? 'discovery'} capability failed.`,
        error,
      );
    }
  }

  private bindDiscovered(
    item: TestDataItem,
    discovered: RuntimeDiscoveryResult,
    source: 'browser' | 'database' | 'api',
    runtimeData: RuntimeDataStore,
  ): DataResolutionResult {
    const evidence = discovered.evidence.length > 0
      ? discovered.evidence
      : [{ kind: source, description: `Existing value discovered through the ${source} capability.` } satisfies DataResolutionEvidence];
    return this.bindResolved(item, discovered.value, source, runtimeData, evidence, {
      status: 'DISCOVERED',
      bindingRef: discovered.bindingRef,
      sensitive: discovered.sensitive,
    });
  }

  private bindResolved(
    item: TestDataItem,
    value: unknown,
    source: DataResolutionResult['source'],
    runtimeData: RuntimeDataStore,
    evidenceDetails: DataResolutionEvidence[],
    options: {
      status?: Extract<DataNeedStatus, 'RESOLVED' | 'GENERATED' | 'DISCOVERED'>;
      bindingRef?: string;
      secretRef?: string;
      sensitive?: boolean;
    } = {},
  ): DataResolutionResult {
    const bindingRef = options.bindingRef ?? `runtime.${item.id}`;
    const sensitive = options.sensitive ?? isSensitiveDataItem(item);
    runtimeData.bind({
      dataItemId: item.id,
      bindingRef,
      value,
      source: source ?? 'environment',
      sensitive,
      evidence: evidenceDetails,
    });
    return {
      dataItemId: item.id,
      status: options.status ?? 'RESOLVED',
      semantics: classifyDataNeed(item),
      source,
      bindingRef,
      sensitive,
      evidence: evidenceDetails.map((evidence) => evidence.description),
      evidenceDetails,
      value: sensitive ? undefined : toStringValue(value),
      secretRef: options.secretRef,
      resolved: true,
    };
  }

  private checkDependencies(item: TestDataItem, runtimeData: RuntimeDataStore): string | undefined {
    for (const dependency of item.dependencies) {
      if (runtimeData.get(dependency) === undefined) {
        return `Data dependency ${dependency} was not resolved before ${item.id}.`;
      }
    }
    return undefined;
  }

  private recordResolution(metrics: DataResolutionMetrics, resolution: DataResolutionResult): void {
    if (resolution.status === 'RESOLVED') metrics.resolvedDataNeeds++;
    if (resolution.status === 'GENERATED') metrics.generatedDataNeeds++;
    if (resolution.status === 'DISCOVERED') metrics.discoveredDataNeeds++;
    if (resolution.status === 'NEEDS_CAPABILITY') metrics.needsCapability++;
    if (resolution.status === 'BLOCKED') metrics.blockedDataNeeds++;
  }
}

function isDatabaseDiscoveryGrounded(
  item: TestDataItem,
  operation: PreparationOperation,
  mappings: ResourceMapping[],
): boolean {
  if (operation.resolver !== 'database' && operation.resolver !== 'account') return false;
  if (!operation.resourceId) return false;
  const spec = operation.resolverSpec as { entity?: string } | undefined;
  const logicalEntity = spec?.entity ?? item.relatedEntityIds[0];
  if (!logicalEntity) return false;
  return mappings.some(
    (mapping) => mapping.resourceId === operation.resourceId &&
      mapping.logicalEntity.toLowerCase() === logicalEntity.toLowerCase(),
  );
}

function isApiDiscoveryGrounded(
  operation: PreparationOperation,
  capability: RuntimeCapabilityInventory['api'],
): boolean {
  return operation.resolver === 'api' &&
    Boolean(operation.resourceId) &&
    Boolean(capability.allowedOperationIds?.includes(operation.id));
}

function unresolvedResolution(
  item: TestDataItem,
  status: Extract<DataNeedStatus, 'NEEDS_CAPABILITY' | 'BLOCKED'>,
  reason: string,
  source: DataResolutionResult['source'],
  evidenceDetails: DataResolutionEvidence[],
  options: { secretRef?: string; sensitive?: boolean } = {},
): DataResolutionResult {
  return {
    dataItemId: item.id,
    status,
    semantics: classifyDataNeed(item),
    source,
    sensitive: options.sensitive ?? isSensitiveDataItem(item),
    evidence: evidenceDetails.map((evidence) => evidence.description),
    evidenceDetails,
    secretRef: options.secretRef,
    resolved: false,
    reason,
    unresolvedReason: reason,
  };
}

function topologicalItemOrder(items: TestDataItem[]): TestDataItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pending = new Set(items.map((item) => item.id));
  const ordered: TestDataItem[] = [];

  while (pending.size > 0) {
    const ready = [...pending].filter((id) =>
      (byId.get(id)?.dependencies ?? []).every((dependency) => !pending.has(dependency)),
    );
    if (ready.length === 0) return items;
    for (const id of ready) {
      pending.delete(id);
      ordered.push(byId.get(id)!);
    }
  }
  return ordered;
}

function mergeMappings(inventory: RuntimeCapabilityInventory): ResourceMapping[] {
  return [
    ...inventory.resourceMappings,
    ...(inventory.database.mappings ?? []),
  ];
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function emptyDataResolutionMetrics(dataNeeds: number): DataResolutionMetrics {
  return {
    dataNeeds,
    resolvedDataNeeds: 0,
    generatedDataNeeds: 0,
    discoveredDataNeeds: 0,
    needsCapability: 0,
    blockedDataNeeds: 0,
    databaseDiscoveryCalls: 0,
    apiDiscoveryCalls: 0,
    browserDiscoveryRounds: 0,
  };
}

function buildPhase2BPlan(items: TestDataItem[]): TestDataPlanIR {
  const dependencies: DataDependency[] = items.flatMap((item) =>
    item.dependencies.map((dependency, index) => ({
      id: `PHASE2B-DEP-${item.id}-${index}`,
      sourceDataItemId: dependency,
      targetDataItemId: item.id,
      type: 'requires' as const,
      description: `Runtime data dependency for ${item.id}`,
    })),
  );
  const testCaseIds = [...new Set(items.flatMap((item) => item.relatedTestCaseIds))];
  const quality: TestDataQualityMetrics = {
    testCasesTotal: testCaseIds.length,
    testCasesWithCompleteDataPlan: testCaseIds.length,
    testCasesPartiallyPlanned: 0,
    dataItems: items.length,
    reusableDataSets: 0,
    dependencies: dependencies.length,
    unresolved: 0,
    cyclicDependencies: 0,
    provenanceCoverage: items.length === 0 ? 1 : items.filter((item) => item.provenance.length > 0).length / items.length,
    strategyCoverage: items.length === 0 ? 1 : items.filter((item) => item.strategy !== 'unknown').length / items.length,
    testsRequiringData: testCaseIds.length,
    testsCoveredByData: testCaseIds.length,
    coverageRate: testCaseIds.length > 0 ? 1 : 0,
    unresolvedDataRequirements: 0,
  };
  return {
    schemaVersion: '1.0',
    testCases: testCaseIds.map((testCaseId) => ({
      testCaseId,
      requiredDataItemIds: items.filter((item) => item.relatedTestCaseIds.includes(testCaseId)).map((item) => item.id),
      setupItemIds: [],
      cleanupItemIds: [],
      reusableDataSetIds: [],
      unresolvedIds: [],
    })),
    dataItems: items,
    dependencyGraph: dependencies,
    reusableSets: [],
    unresolved: [],
    quality,
  };
}
