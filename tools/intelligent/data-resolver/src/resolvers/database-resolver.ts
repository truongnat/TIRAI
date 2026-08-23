// ---------------------------------------------------------------------------
// Database Resolver
// ---------------------------------------------------------------------------
// Resolves database-record, and data items with executorHint=database into
// abstract database preparation intent.  Does NOT generate SQL or connect
// to any database.

import type {
  DataResolver,
  ResolverMatch,
  ResolutionResult,
  ResolutionContext,
  TestDataItem,
  PreparationOperation,
  RuntimeBinding,
  DatabasePreparationSpec,
  DataValueExpression,
  IdempotencyPolicy,
} from '../models.js';

/**
 * Determine the database operation mode from the data item's strategy.
 *
 * The mapping is deterministic:
 * - select-existing / reuse-existing → 'select'
 * - create-new → 'insert'
 * - derive → 'derive'
 * - unknown strategy with existing lifecycle → 'select'
 */
function resolveDbMode(item: TestDataItem): DatabasePreparationSpec['mode'] {
  switch (item.strategy) {
    case 'select-existing':
    case 'reuse-existing':
      return 'select';
    case 'create-new':
      return 'insert';
    case 'derive':
      return 'derive';
    case 'mock':
    case 'stub':
      return 'select';
    default:
      return item.lifecycle === 'existing' ? 'select' : 'insert';
  }
}

/**
 * Build value expressions from data item constraints.
 *
 * Only constraints with a concrete value produce literal expressions.
 * Other constraints remain as selection criteria.
 */
function buildValueExpressions(item: TestDataItem): DataValueExpression[] {
  const expressions: DataValueExpression[] = [];
  for (const c of item.constraints) {
    if (c.value !== undefined && c.value !== null) {
      expressions.push({ type: 'literal', value: c.value });
    }
  }
  return expressions;
}

/**
 * Find the best matching database resource from the environment profile.
 *
 * Returns the resource ID if exactly one database resource is available,
 * or undefined if zero or multiple are found (ambiguous).
 */
function findDatabaseResource(
  candidate: TestDataItem,
  context: ResolutionContext,
): {
  resourceId?: string;
  ambiguous: boolean;
} {
  const dbResources = context.environment.resources.filter(
    (r) => r.type === 'database',
  );

  if (dbResources.length === 0) {
    return { resourceId: undefined, ambiguous: false };
  }
  if (dbResources.length === 1) {
    return { resourceId: dbResources[0]!.id, ambiguous: false };
  }

  // Multiple DB resources — check if a mapping narrows it down
  const mapping = context.mappings.find(
    (m) =>
      m.logicalEntity.toLowerCase() === itemToEntity(candidate).toLowerCase(),
  );
  if (mapping) {
    return { resourceId: mapping.resourceId, ambiguous: false };
  }

  return { resourceId: undefined, ambiguous: true };
}

/**
 * Derive a logical entity name from the data item.
 *
 * Uses explicit mapping if available; otherwise extracts from description
 * using a deterministic heuristic.  Never guesses a table name.
 */
function itemToEntity(item: TestDataItem): string {
  // If the item has relatedEntityIds, use the first one
  if (item.relatedEntityIds.length > 0) {
    return item.relatedEntityIds[0]!;
  }
  // Fall back to a generic logical name derived from the item ID
  return `entity:${item.id}`;
}

/**
 * Build runtime bindings produced by a database operation.
 *
 * Each data item that resolves to a database operation may produce
 * bindings for downstream consumers.
 */
function buildProducedBindings(
  operationId: string,
  item: TestDataItem,
): RuntimeBinding[] {
  const bindings: RuntimeBinding[] = [];
  const entity = itemToEntity(item);

  // Primary record binding
  bindings.push({
    id: `BIND-${item.id}`,
    name: `runtime.${item.id}`,
    producerOperationId: operationId,
    sourcePath: 'result',
    dataType: entity,
    sensitive: false,
  });

  return bindings;
}

/**
 * Determine idempotency policy for a database operation.
 */
function resolveIdempotency(item: TestDataItem): IdempotencyPolicy {
  switch (item.strategy) {
    case 'select-existing':
    case 'reuse-existing':
      return { mode: 'safe-repeat' };
    case 'create-new':
      return { mode: 'unique-per-run' };
    case 'derive':
      return { mode: 'safe-repeat' };
    default:
      return { mode: 'unknown' };
  }
}

export const databaseResolver: DataResolver = {
  type: 'database',

  canResolve(
    candidate: TestDataItem,
    context: ResolutionContext,
  ): ResolverMatch {
    // Database resolver handles:
    // 1. type === 'database-record'
    // 2. type === 'reference-data' with executorHint === 'database'
    // 3. Any type with executorHint === 'database'
    const hasDbHint = candidate.setup.some((s) => s.executorHint === 'database');
    const isDbType =
      candidate.type === 'database-record' ||
      candidate.type === 'reference-data';

    if (!hasDbHint && !isDbType) {
      return { supported: false, score: 0, reasons: ['No database signal'], resourceIds: [] };
    }

    const dbResources = context.environment.resources.filter(
      (r) => r.type === 'database',
    );

    if (dbResources.length === 0) {
      return {
        supported: false,
        score: 0,
        reasons: ['No database resource in environment'],
        resourceIds: [],
      };
    }

    // Check if there's a mapping for this item's entity
    const entity = itemToEntity(candidate);
    const hasMapping = context.mappings.some(
      (m) => m.logicalEntity.toLowerCase() === entity.toLowerCase(),
    );

    const reasons: string[] = [`type=${candidate.type}`, `strategy=${candidate.strategy}`];
    if (hasDbHint) reasons.push('executorHint=database');
    if (hasMapping) reasons.push('explicit mapping found');

    // Score: higher if we have an explicit mapping
    const score = hasMapping ? 0.9 : dbResources.length === 1 ? 0.7 : 0.4;

    return {
      supported: true,
      score,
      reasons,
      resourceIds: dbResources.map((r) => r.id),
    };
  },

  plan(candidate: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${candidate.id}`;
    const { resourceId, ambiguous } = findDatabaseResource(candidate, context);
    const entity = itemToEntity(candidate);
    const mode = resolveDbMode(candidate);
    const values = buildValueExpressions(candidate);

    const dbSpec: DatabasePreparationSpec = {
      mode,
      entity,
      criteria: candidate.constraints,
      values,
      bindings: [`runtime.${candidate.id}`],
    };

    const produces = [`runtime.${candidate.id}`];

    // Determine consumes from dependencies
    const consumes: string[] = [];
    for (const depId of candidate.dependencies) {
      consumes.push(`runtime.${depId}`);
    }

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: candidate.id,
      resolver: 'database',
      action: mapStrategyToAction(candidate),
      resourceId: ambiguous ? undefined : resourceId,
      parameters: {
        entity,
        mode,
        constraints: candidate.constraints.map((c) => c.description),
      },
      produces,
      consumes,
      cleanupOperationIds: [],
      provenance: candidate.provenance,
      confidence: candidate.confidence,
      idempotency: resolveIdempotency(candidate),
      resolverSpec: dbSpec as unknown as Record<string, unknown>,
    };

    const bindings = buildProducedBindings(operationId, candidate);

    const result: ResolutionResult = { operation: op, bindings };

    // If no database resource found or ambiguous without mapping, add unresolved
    if (!resourceId && ambiguous) {
      result.unresolved = {
        id: `UNRESOLVED-${candidate.id}`,
        dataItemId: candidate.id,
        description: `Ambiguous database resource for entity "${entity}"`,
        reason: 'ambiguous-resource',
        provenance: candidate.provenance,
      };
    } else if (!resourceId) {
      result.unresolved = {
        id: `UNRESOLVED-${candidate.id}`,
        dataItemId: candidate.id,
        description: `No database resource available for entity "${entity}"`,
        reason: 'resource-not-found',
        provenance: candidate.provenance,
      };
    }

    return result;
  },
};

function mapStrategyToAction(item: TestDataItem): PreparationOperation['action'] {
  switch (item.strategy) {
    case 'select-existing':
    case 'reuse-existing':
      return 'select';
    case 'create-new':
      return 'create';
    case 'derive':
      return 'derive';
    case 'mock':
    case 'stub':
      return 'mock';
    default:
      return item.lifecycle === 'existing' ? 'select' : 'create';
  }
}
