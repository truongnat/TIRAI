// ---------------------------------------------------------------------------
// Execution Engine – executor registry
// ---------------------------------------------------------------------------
// Pluggable registry for preparation executors.  Adding a new executor
// requires only registration — no modification of engine logic.

import type { PreparationExecutor, ExecutorType, PreparationOperation, ExecutionContext, ExecutorMatch } from './models.js';

const registry = new Map<ExecutorType, PreparationExecutor>();

/** Register an executor for a given type. */
export function registerExecutor(executor: PreparationExecutor): void {
  registry.set(executor.type, executor);
}

/** Retrieve a registered executor by type. */
export function getExecutor(type: ExecutorType): PreparationExecutor | undefined {
  return registry.get(type);
}

/** List all registered executor types. */
export function listExecutors(): ExecutorType[] {
  return [...registry.keys()];
}

/**
 * Find the best executor for an operation.  Iterates all registered
 * executors and returns the one with the highest match score.
 */
export function findBestExecutor(
  operation: PreparationOperation,
  context: ExecutionContext,
): { executor: PreparationExecutor; match: ExecutorMatch } | undefined {
  let best: { executor: PreparationExecutor; match: ExecutorMatch } | undefined;

  for (const executor of registry.values()) {
    const match = executor.canExecute(operation, context);
    if (!match.supported) continue;
    if (!best || match.score > best.match.score) {
      best = { executor, match };
    }
  }

  return best;
}

/** Remove all registered executors (useful for testing). */
export function clearRegistry(): void {
  registry.clear();
}
