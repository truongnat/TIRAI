// ---------------------------------------------------------------------------
// State Resolver
// ---------------------------------------------------------------------------
// Handles state-type data items: system state, application state, etc.

import type {
  DataResolver,
  ResolverMatch,
  ResolutionResult,
  ResolutionContext,
  TestDataItem,
  PreparationOperation,
  RuntimeBinding,
  IdempotencyPolicy,
} from '../models.js';

function findStateResource(context: ResolutionContext): string | undefined {
  const stateResources = context.environment.resources.filter(
    (r) => r.type === 'state-store',
  );
  if (stateResources.length >= 1) return stateResources[0]!.id;

  // State can also be backed by API or database
  const apiResources = context.environment.resources.filter(
    (r) => r.type === 'api',
  );
  if (apiResources.length >= 1) return apiResources[0]!.id;

  return undefined;
}

export const stateResolver: DataResolver = {
  type: 'state',

  canResolve(item: TestDataItem, context: ResolutionContext): ResolverMatch {
    if (item.type !== 'state') {
      return { supported: false, score: 0, reasons: ['Not a state type'], resourceIds: [] };
    }

    const resource = findStateResource(context);
    if (!resource) {
      return {
        supported: false,
        score: 0,
        reasons: ['No state-store or API resource in environment'],
        resourceIds: [],
      };
    }

    return {
      supported: true,
      score: 0.8,
      reasons: [`type=state`, `strategy=${item.strategy}`],
      resourceIds: [resource],
    };
  },

  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;
    const resource = findStateResource(context);

    const action: PreparationOperation['action'] =
      item.strategy === 'select-existing' || item.strategy === 'reuse-existing'
        ? 'select'
        : item.strategy === 'create-new'
          ? 'create'
          : 'select';

    const idempotency: IdempotencyPolicy =
      action === 'select' ? { mode: 'safe-repeat' } : { mode: 'unique-per-run' };

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'state',
      action,
      resourceId: resource,
      parameters: {
        constraints: item.constraints.map((c) => c.description),
      },
      produces: [`runtime.${item.id}`],
      consumes: item.dependencies.map((d) => `runtime.${d}`),
      cleanupOperationIds: [],
      provenance: item.provenance,
      confidence: item.confidence,
      idempotency,
    };

    const bindings: RuntimeBinding[] = [
      {
        id: `BIND-${item.id}`,
        name: `runtime.${item.id}`,
        producerOperationId: operationId,
        sourcePath: 'state',
        dataType: 'state',
        sensitive: false,
      },
    ];

    const result: ResolutionResult = { operation: op, bindings };

    if (!resource) {
      result.unresolved = {
        id: `UNRESOLVED-${item.id}`,
        dataItemId: item.id,
        description: `No state resource for "${item.name}"`,
        reason: 'resource-not-found',
        provenance: item.provenance,
      };
    }

    return result;
  },
};
