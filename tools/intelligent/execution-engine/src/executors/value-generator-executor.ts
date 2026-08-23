// ---------------------------------------------------------------------------
// Execution Engine – value generator executor
// ---------------------------------------------------------------------------
// Deterministic value generator that supports UUID, unique string,
// boundary expressions, binding copy, and literal values.  Uses a
// seeded hash for reproducibility — no external dependencies.

import type {
  PreparationExecutor,
  PreparationOperation,
  ExecutionContext,
  ExecutorMatch,
  ValidationResult,
  OperationExecutionResult,
  RuntimeBindingResult,
} from '../models.js';

/**
 * Deterministic value generator executor.  Produces values from
 * expressions without any side effects.  Supports seeded generation
 * for reproducible test runs.
 */
export class ValueGeneratorExecutor implements PreparationExecutor {
  readonly type = 'value-generator' as const;

  canExecute(
    operation: PreparationOperation,
    _context: ExecutionContext,
  ): ExecutorMatch {
    if (operation.resolver !== 'value-generator' && operation.action !== 'generate' && operation.action !== 'derive') {
      return { supported: false, score: 0, reasons: ['not-value-generator'] };
    }
    return { supported: true, score: 0.9, reasons: ['value-generator'] };
  }

  async validate(
    _operation: PreparationOperation,
    _context: ExecutionContext,
  ): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async execute(
    operation: PreparationOperation,
    context: ExecutionContext,
  ): Promise<OperationExecutionResult> {
    const seed = context.seed ?? 'default';
    const expressions = (operation.parameters.expressions ?? []) as Array<{
      type: string;
      value?: unknown;
      generator?: string;
      binding?: string;
    }>;

    const value = this.evaluateExpressions(expressions, operation, seed, context);

    const binding: RuntimeBindingResult = {
      id: `BIND-${operation.id}`,
      name: `runtime.${operation.dataItemId}`,
      producerOperationId: operation.id,
      value,
      sensitive: false,
      status: 'resolved',
    };

    return {
      operationId: operation.id,
      dataItemId: operation.dataItemId,
      status: 'succeeded',
      executorType: 'value-generator',
      action: operation.action,
      producedBindings: [binding],
      warnings: [],
      provenance: operation.provenance,
      retryCount: 0,
    };
  }

  private evaluateExpressions(
    expressions: Array<{ type: string; value?: unknown; generator?: string; binding?: string }>,
    operation: PreparationOperation,
    seed: string,
    context: ExecutionContext,
  ): unknown {
    if (expressions.length === 0) {
      // Default: generate a deterministic value
      return this.generateDefault(operation, seed);
    }

    const expr = expressions[0]!;
    switch (expr.type) {
      case 'literal':
        return expr.value;
      case 'generated':
        return this.generateValue(expr.generator ?? 'uuid', operation, seed);
      case 'binding':
        if (expr.binding) {
          const resolved = context.bindings.resolve(expr.binding);
          return resolved?.value ?? null;
        }
        return null;
      case 'derived':
        if (expr.binding) {
          const resolved = context.bindings.resolve(expr.binding);
          return resolved?.value ?? null;
        }
        return null;
      case 'boundary':
        return this.evaluateBoundary(expr, operation);
      default:
        return this.generateDefault(operation, seed);
    }
  }

  private generateDefault(operation: PreparationOperation, seed: string): string {
    return deterministicHash(`${seed}:${operation.dataItemId}`);
  }

  private generateValue(
    generator: string,
    operation: PreparationOperation,
    seed: string,
  ): string {
    const input = `${seed}:${operation.dataItemId}:${generator}`;
    switch (generator) {
      case 'uuid':
        return deterministicUuid(input);
      case 'unique-string':
        return `val-${deterministicHash(input).slice(0, 12)}`;
      default:
        return deterministicHash(input);
    }
  }

  private evaluateBoundary(
    expr: { value?: unknown },
    _operation: PreparationOperation,
  ): unknown {
    // Boundary expressions return the literal value
    return expr.value ?? 0;
  }
}

// ---- Deterministic hash utilities -----------------------------------------

function deterministicHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function deterministicUuid(input: string): string {
  const h = deterministicHash(input);
  const h2 = deterministicHash(`${input}:salt`);
  return `${h.slice(0, 8)}-${h2.slice(0, 4)}-4${h.slice(4, 7)}-${h2.slice(4, 7)}-${h}${h2.slice(0, 4)}`.slice(0, 36);
}
