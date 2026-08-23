// ---------------------------------------------------------------------------
// Account Resolver
// ---------------------------------------------------------------------------
// Handles account-type data items.  May delegate to database or API
// resolvers based on environment capabilities, but produces account-specific
// preparation intent.

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

function findAccountResource(context: ResolutionContext): string | undefined {
  const accountStores = context.environment.resources.filter(
    (r) => r.type === 'account-store',
  );
  if (accountStores.length >= 1) return accountStores[0]!.id;

  // Fall back to database resource for account storage
  const dbResources = context.environment.resources.filter(
    (r) => r.type === 'database',
  );
  return dbResources.length >= 1 ? dbResources[0]!.id : undefined;
}

function resolveIdempotency(item: TestDataItem): IdempotencyPolicy {
  if (item.strategy === 'select-existing' || item.strategy === 'reuse-existing') {
    return { mode: 'safe-repeat' };
  }
  return { mode: 'unique-per-run' };
}

export const accountResolver: DataResolver = {
  type: 'account',

  canResolve(item: TestDataItem, context: ResolutionContext): ResolverMatch {
    if (item.type !== 'account') {
      return { supported: false, score: 0, reasons: ['Not an account type'], resourceIds: [] };
    }

    const resource = findAccountResource(context);
    if (!resource) {
      return {
        supported: false,
        score: 0,
        reasons: ['No account store or database resource in environment'],
        resourceIds: [],
      };
    }

    return {
      supported: true,
      score: 0.9,
      reasons: [`type=account`, `strategy=${item.strategy}`],
      resourceIds: [resource],
    };
  },

  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;
    const resource = findAccountResource(context);

    const action: PreparationOperation['action'] =
      item.strategy === 'select-existing' || item.strategy === 'reuse-existing'
        ? 'select'
        : item.strategy === 'create-new'
          ? 'create'
          : 'select';

    const consumes: string[] = [];
    for (const depId of item.dependencies) {
      consumes.push(`runtime.${depId}`);
    }

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'account',
      action,
      resourceId: resource,
      parameters: {
        constraints: item.constraints.map((c) => c.description),
      },
      produces: [`runtime.${item.id}`],
      consumes,
      cleanupOperationIds: [],
      provenance: item.provenance,
      confidence: item.confidence,
      idempotency: resolveIdempotency(item),
    };

    const bindings: RuntimeBinding[] = [
      {
        id: `BIND-${item.id}`,
        name: `runtime.${item.id}`,
        producerOperationId: operationId,
        sourcePath: 'result',
        dataType: 'account',
        sensitive: true,
      },
    ];

    const result: ResolutionResult = { operation: op, bindings };

    if (!resource) {
      result.unresolved = {
        id: `UNRESOLVED-${item.id}`,
        dataItemId: item.id,
        description: `No account resource available for "${item.name}"`,
        reason: 'resource-not-found',
        provenance: item.provenance,
      };
    }

    return result;
  },
};
