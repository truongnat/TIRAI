// ---------------------------------------------------------------------------
// File Resolver
// ---------------------------------------------------------------------------
// Plans file-related data preparation: reuse fixture, copy template,
// generate file intent.  Does NOT perform actual file operations.

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

function findFileResource(context: ResolutionContext): string | undefined {
  const fsResources = context.environment.resources.filter(
    (r) => r.type === 'filesystem',
  );
  return fsResources.length >= 1 ? fsResources[0]!.id : undefined;
}

export const fileResolver: DataResolver = {
  type: 'file',

  canResolve(item: TestDataItem, context: ResolutionContext): ResolverMatch {
    if (item.type !== 'file') {
      return { supported: false, score: 0, reasons: ['Not a file type'], resourceIds: [] };
    }

    const resource = findFileResource(context);
    if (!resource) {
      return {
        supported: false,
        score: 0,
        reasons: ['No filesystem resource in environment'],
        resourceIds: [],
      };
    }

    return {
      supported: true,
      score: 0.85,
      reasons: [`type=file`, `strategy=${item.strategy}`],
      resourceIds: [resource],
    };
  },

  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;
    const resource = findFileResource(context);

    const action: PreparationOperation['action'] =
      item.strategy === 'reuse-existing' || item.strategy === 'select-existing'
        ? 'copy'
        : item.strategy === 'generate'
          ? 'generate'
          : 'copy';

    const idempotency: IdempotencyPolicy =
      action === 'copy' ? { mode: 'safe-repeat' } : { mode: 'unique-per-run' };

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'file',
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
        sourcePath: 'filePath',
        dataType: 'file',
        sensitive: false,
      },
    ];

    const result: ResolutionResult = { operation: op, bindings };

    if (!resource) {
      result.unresolved = {
        id: `UNRESOLVED-${item.id}`,
        dataItemId: item.id,
        description: `No filesystem resource for "${item.name}"`,
        reason: 'resource-not-found',
        provenance: item.provenance,
      };
    }

    return result;
  },
};
