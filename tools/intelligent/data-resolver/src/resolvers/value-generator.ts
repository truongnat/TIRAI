// ---------------------------------------------------------------------------
// Value Generator
// ---------------------------------------------------------------------------
// Handles data items that can be produced without external resources:
// generated inputs, identifiers, boundary values, etc.  Produces value
// expressions rather than concrete values — the future executor evaluates
// them.

import type {
  DataResolver,
  ResolverMatch,
  ResolutionResult,
  ResolutionContext,
  TestDataItem,
  PreparationOperation,
  RuntimeBinding,
  DataValueExpression,
} from '../models.js';

/**
 * Determine the generator type from constraint descriptions.
 *
 * Deterministic pattern matching against constraint text to produce
 * the most appropriate generator expression.
 */
function inferGenerator(item: TestDataItem): string {
  const desc = item.description.toLowerCase();
  const constraintText = item.constraints.map((c) => c.description.toLowerCase()).join(' ');
  const combined = `${desc} ${constraintText}`;

  if (combined.includes('uuid')) return 'GENERATE_UUID';
  if (combined.includes('unique')) return 'GENERATE_UNIQUE_STRING';
  if (combined.includes('null')) return 'GENERATE_NULL';
  if (combined.includes('boundary') || combined.includes('min')) return 'BOUNDARY_MIN';
  if (combined.includes('max')) return 'BOUNDARY_MAX_PLUS_ONE';

  // Default: generic generated value
  return 'GENERATE_VALUE';
}

/**
 * Build value expressions for a generated data item.
 */
function buildExpressions(item: TestDataItem): DataValueExpression[] {
  const generator = inferGenerator(item);

  // If the item depends on another item's value, produce a derived expression
  if (item.strategy === 'derive' && item.dependencies.length > 0) {
    return [
      {
        type: 'derived',
        generator: 'COPY_BINDING',
        binding: `runtime.${item.dependencies[0]}`,
      },
    ];
  }

  return [{ type: 'generated', generator }];
}

export const valueGenerator: DataResolver = {
  type: 'value-generator',

  canResolve(item: TestDataItem, _context: ResolutionContext): ResolverMatch {
    // Value generator handles:
    // 1. type === 'input' with strategy === 'generate'
    // 2. type === 'identifier'
    // 3. type === 'input' with strategy === 'derive' (when no other resolver fits better)
    const isGeneratedInput =
      item.type === 'input' &&
      (item.strategy === 'generate' || item.strategy === 'derive');
    const isIdentifier = item.type === 'identifier';

    if (!isGeneratedInput && !isIdentifier) {
      return { supported: false, score: 0, reasons: ['Not a generatable type'], resourceIds: [] };
    }

    // Value generator doesn't need environment resources
    const reasons: string[] = [`type=${item.type}`, `strategy=${item.strategy}`];
    const score = isIdentifier ? 0.9 : item.strategy === 'generate' ? 0.75 : 0.5;

    return {
      supported: true,
      score,
      reasons,
      resourceIds: [],
    };
  },

  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult {
    const operationId = `OP-${item.id}`;
    const expressions = buildExpressions(item);

    const consumes: string[] = [];
    for (const depId of item.dependencies) {
      consumes.push(`runtime.${depId}`);
    }

    const op: PreparationOperation = {
      id: operationId,
      dataItemId: item.id,
      resolver: 'value-generator',
      action: item.strategy === 'derive' ? 'derive' : 'generate',
      parameters: {
        expressions,
        constraints: item.constraints.map((c) => c.description),
        seed: context.options.generationSeed
          ? `${context.options.generationSeed}:${item.id}`
          : undefined,
      },
      produces: [`runtime.${item.id}`],
      consumes,
      cleanupOperationIds: [],
      provenance: item.provenance,
      confidence: item.confidence,
      idempotency: { mode: 'unique-per-run' },
    };

    const bindings: RuntimeBinding[] = [
      {
        id: `BIND-${item.id}`,
        name: `runtime.${item.id}`,
        producerOperationId: operationId,
        sourcePath: 'generated',
        dataType: item.type,
        sensitive: false,
      },
    ];

    return { operation: op, bindings };
  },
};
