// ---------------------------------------------------------------------------
// API Resolver
// ---------------------------------------------------------------------------
// Resolves data items that represent external API interactions: tokens
// returned by authentication APIs, external response data, etc.
// Does NOT make any real HTTP calls.

import type {
  DataResolver,
  ResolverMatch,
  ResolutionResult,
  ResolutionContext,
  TestDataItem,
  PreparationOperation,
  RuntimeBinding,
  ApiPreparationSpec,
  IdempotencyPolicy,
} from '../models.js';

function findApiResource(context: ResolutionContext): string | undefined {
  const apiResources = context.environment.resources.filter(
    (r) => r.type === 'api',
  );
  return apiResources.length >= 1 ? apiResources[0]!.id : undefined;
}

function mapAction(item: TestDataItem): PreparationOperation['action'] {
  switch (item.strategy) {
    case 'select-existing':
    case 'reuse-existing':
      return 'select';
    case 'create-new':
      return 'create';
    case 'generate':
      return item.type === 'token' ? 'generate' : 'mock';
    case 'mock':
    case 'stub':
      return 'mock';
    default:
      return 'unknown';
  }
}

function resolveIdempotency(item: TestDataItem): IdempotencyPolicy {
  if (item.strategy === 'select-existing' || item.strategy === 'reuse-existing') {
    return { mode: 'safe-repeat' };
  }
  if (item.strategy === 'generate' || item.strategy === 'create-new') {
    return { mode: 'unique-per-run' };
  }
  return { mode: 'unknown' };
}

export const apiResolver: DataResolver = {
  type: 'api',

  canResolve(item: TestDataItem, context: ResolutionContext): ResolverMatch {
    // API resolver handles:
    // 1. type === 'external-response'
    // 2. type === 'token' (typically produced by an API call)
    // 3. executorHint === 'api'
    const isApiType = item.type === 'external-response' || item.type === 'token';
    const hasApiHint = item.setup.some((s) => s.executorHint === 'api');

    if (!isApiType && !hasApiHint) {
      return { supported: false, score: 0, reasons: ['No API signal'], resourceIds: [] };
    }

    const apiResource = findApiResource(context);
    if (!apiResource) {
      return {
        supported: false,
        score: 0,
        reasons: ['No API resource in environment'],
        resourceIds: [],
      };
    }

    const reasons: string[] = [`type=${item.type}`, `strategy=${item.strategy}`];
    if (hasApiHint) reasons.push('executorHint=api');

    return {
      supported: true,
      score: isApiType ? 0.85 : 0.6,
      reasons,
      resourceIds: [apiResource],
    };
  },

  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;
    const apiResource = findApiResource(context);
    const action = mapAction(item);

    const apiSpec: ApiPreparationSpec = {
      operationId: item.id,
      resource: apiResource ?? 'unknown',
      methodIntent: action === 'select' ? 'GET' : 'POST',
      requestDataBindings: item.dependencies.map((d) => `runtime.${d}`),
      responseBindings: [`runtime.${item.id}`],
    };

    const consumes: string[] = [];
    for (const depId of item.dependencies) {
      consumes.push(`runtime.${depId}`);
    }

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'api',
      action,
      resourceId: apiResource,
      parameters: {
        resource: apiResource ?? 'unknown',
        methodIntent: apiSpec.methodIntent,
        constraints: item.constraints.map((c) => c.description),
      },
      produces: [`runtime.${item.id}`],
      consumes,
      cleanupOperationIds: [],
      provenance: item.provenance,
      confidence: item.confidence,
      idempotency: resolveIdempotency(item),
      resolverSpec: apiSpec as unknown as Record<string, unknown>,
    };

    const bindings: RuntimeBinding[] = [
      {
        id: `BIND-${item.id}`,
        name: `runtime.${item.id}`,
        producerOperationId: operationId,
        sourcePath: 'response',
        dataType: item.type,
        sensitive: item.type === 'token',
      },
    ];

    const result: ResolutionResult = { operation: op, bindings };

    if (!apiResource) {
      result.unresolved = {
        id: `UNRESOLVED-${item.id}`,
        dataItemId: item.id,
        description: `No API resource available for ${item.type} "${item.name}"`,
        reason: 'resource-not-found',
        provenance: item.provenance,
      };
    }

    return result;
  },
};
