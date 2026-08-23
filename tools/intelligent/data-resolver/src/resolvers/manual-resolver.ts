// ---------------------------------------------------------------------------
// Manual Resolver
// ---------------------------------------------------------------------------
// Fallback resolver for data items that cannot be automatically resolved.
// Produces a manual operation with clear description of what is needed.

import type {
  DataResolver,
  ResolverMatch,
  ResolutionResult,
  ResolutionContext,
  TestDataItem,
  PreparationOperation,
  RuntimeBinding,
} from '../models.js';

export const manualResolver: DataResolver = {
  type: 'manual',

  canResolve(_item: TestDataItem, _context: ResolutionContext): ResolverMatch {
    // Manual resolver always supports — it's the universal fallback.
    // Low score so it only wins when no other resolver matches.
    return {
      supported: true,
      score: 0.01,
      reasons: ['manual fallback'],
      resourceIds: [],
    };
  },

  plan(item: TestDataItem, _context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'manual',
      action: 'manual',
      parameters: {
        description: item.description,
        constraints: item.constraints.map((c) => c.description),
        instruction: `Manually prepare: ${item.name}`,
      },
      produces: [`runtime.${item.id}`],
      consumes: item.dependencies.map((d) => `runtime.${d}`),
      cleanupOperationIds: [],
      provenance: item.provenance,
      confidence: item.confidence,
      idempotency: { mode: 'not-idempotent' },
    };

    const bindings: RuntimeBinding[] = [
      {
        id: `BIND-${item.id}`,
        name: `runtime.${item.id}`,
        producerOperationId: operationId,
        sourcePath: 'manual-result',
        dataType: item.type,
        sensitive: false,
      },
    ];

    return { operation: op, bindings };
  },
};
