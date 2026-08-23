// ---------------------------------------------------------------------------
// Configuration Resolver
// ---------------------------------------------------------------------------
// Plans configuration-related data preparation: set temporary config,
// reuse existing config, restore config.  Does NOT mutate any environment.

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

function findConfigResource(context: ResolutionContext): string | undefined {
  const configResources = context.environment.resources.filter(
    (r) => r.type === 'configuration',
  );
  if (configResources.length >= 1) return configResources[0]!.id;

  // Configuration items can also be backed by a database resource
  const dbResources = context.environment.resources.filter(
    (r) => r.type === 'database',
  );
  return dbResources.length >= 1 ? dbResources[0]!.id : undefined;
}

export const configurationResolver: DataResolver = {
  type: 'configuration',

  canResolve(item: TestDataItem, context: ResolutionContext): ResolverMatch {
    if (item.type !== 'configuration') {
      return { supported: false, score: 0, reasons: ['Not a configuration type'], resourceIds: [] };
    }

    const resource = findConfigResource(context);
    if (!resource) {
      return {
        supported: false,
        score: 0,
        reasons: ['No configuration or database resource in environment'],
        resourceIds: [],
      };
    }

    return {
      supported: true,
      score: 0.85,
      reasons: [`type=configuration`, `strategy=${item.strategy}`],
      resourceIds: [resource],
    };
  },

  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;
    const resource = findConfigResource(context);

    const action: PreparationOperation['action'] =
      item.strategy === 'configure'
        ? 'configure'
        : item.strategy === 'create-new'
          ? 'configure'
          : 'select';

    const idempotency: IdempotencyPolicy =
      action === 'select' ? { mode: 'safe-repeat' } : { mode: 'check-before-create' };

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'configuration',
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
        sourcePath: 'config',
        dataType: 'configuration',
        sensitive: false,
      },
    ];

    const result: ResolutionResult = { operation: op, bindings };

    if (!resource) {
      result.unresolved = {
        id: `UNRESOLVED-${item.id}`,
        dataItemId: item.id,
        description: `No configuration resource for "${item.name}"`,
        reason: 'resource-not-found',
        provenance: item.provenance,
      };
    }

    return result;
  },
};
