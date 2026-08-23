// ---------------------------------------------------------------------------
// Execution Engine – dependency scheduler
// ---------------------------------------------------------------------------
// Computes deterministic execution order from the operation dependency
// graph using topological sort (Kahn's algorithm).  Detects cycles and
// resolves blocked operations when predecessors fail.

import type { PreparationOperation, PreparationDependency } from './models.js';
import { ExecutionEngineError, ExecutionErrorCode } from './errors.js';

/**
 * Compute a deterministic topological execution order.  Operations at
 * the same dependency level are sorted lexicographically by ID for
 * stability.
 */
export function topologicalExecutionOrder(
  operations: PreparationOperation[],
  dependencies: PreparationDependency[],
): string[] {
  const opIds = new Set(operations.map((o) => o.id));

  // Build adjacency list and in-degree map
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of opIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const dep of dependencies) {
    if (!opIds.has(dep.sourceOperationId) || !opIds.has(dep.targetOperationId)) {
      continue; // skip dangling edges
    }
    adjacency.get(dep.sourceOperationId)!.push(dep.targetOperationId);
    inDegree.set(dep.targetOperationId, (inDegree.get(dep.targetOperationId) ?? 0) + 1);
  }

  // Kahn's algorithm with deterministic tie-breaking
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }
  queue.sort(); // deterministic initial order

  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
        queue.sort(); // maintain deterministic order
      }
    }
  }

  if (result.length !== opIds.size) {
    throw new ExecutionEngineError(
      ExecutionErrorCode.CYCLE_DETECTED,
      `Cycle detected: processed ${result.length} of ${opIds.size} operations`,
    );
  }

  return result;
}

/**
 * Detect cycles in the operation graph.  Returns the number of operations
 * that could not be processed (0 = acyclic).
 */
export function detectExecutionCycles(
  operations: PreparationOperation[],
  dependencies: PreparationDependency[],
): number {
  const opIds = new Set(operations.map((o) => o.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of opIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const dep of dependencies) {
    if (!opIds.has(dep.sourceOperationId) || !opIds.has(dep.targetOperationId)) continue;
    adjacency.get(dep.sourceOperationId)!.push(dep.targetOperationId);
    inDegree.set(dep.targetOperationId, (inDegree.get(dep.targetOperationId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [, degree] of inDegree) {
    if (degree === 0) queue.push('x');
  }

  // Simple count — we only need the number of unprocessed nodes
  let processed = 0;
  const tempInDegree = new Map(inDegree);
  const tempAdj = adjacency;

  // Reset queue with actual IDs
  const realQueue: string[] = [];
  for (const [id, degree] of tempInDegree) {
    if (degree === 0) realQueue.push(id);
  }
  realQueue.sort();

  while (realQueue.length > 0) {
    const current = realQueue.shift()!;
    processed++;
    for (const neighbor of tempAdj.get(current) ?? []) {
      const d = (tempInDegree.get(neighbor) ?? 1) - 1;
      tempInDegree.set(neighbor, d);
      if (d === 0) {
        realQueue.push(neighbor);
        realQueue.sort();
      }
    }
  }

  return opIds.size - processed;
}

/**
 * Get the set of operation IDs that depend (directly or transitively) on
 * a given failed operation.  Used for dependency blocking.
 */
export function getDependents(
  failedOpId: string,
  dependencies: PreparationDependency[],
): Set<string> {
  const dependents = new Set<string>();
  const queue = [failedOpId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dep of dependencies) {
      if (dep.sourceOperationId === current && !dependents.has(dep.targetOperationId)) {
        dependents.add(dep.targetOperationId);
        queue.push(dep.targetOperationId);
      }
    }
  }

  return dependents;
}

/**
 * Get direct predecessors of an operation (operations it depends on).
 */
export function getPredecessors(
  operationId: string,
  dependencies: PreparationDependency[],
): string[] {
  return dependencies
    .filter((d) => d.targetOperationId === operationId)
    .map((d) => d.sourceOperationId);
}
