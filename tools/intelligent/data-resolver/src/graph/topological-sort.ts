// ---------------------------------------------------------------------------
// Graph – topological sort and cycle detection
// ---------------------------------------------------------------------------
// Deterministic topological ordering for preparation operations.
// Detects cycles and dangling references.

import type { DataDependency, PreparationOperation, PreparationDependency } from '../models.js';

/**
 * Convert data-item-level dependencies into operation-level dependencies.
 *
 * Each data item maps to exactly one operation (OP-{dataItemId}).
 * Data dependency edges become operation dependency edges.
 */
export function buildPreparationDependencies(
  dataDependencies: DataDependency[],
): PreparationDependency[] {
  return dataDependencies.map((dep) => ({
    id: `PDEP-${dep.id}`,
    sourceOperationId: `OP-${dep.sourceDataItemId}`,
    targetOperationId: `OP-${dep.targetDataItemId}`,
    type: mapDepType(dep.type),
  }));
}

function mapDepType(
  type: DataDependency['type'],
): PreparationDependency['type'] {
  switch (type) {
    case 'requires':
      return 'requires';
    case 'derived-from':
      return 'derived-from';
    case 'cleanup-after':
      return 'cleanup-after';
    case 'must-exist-before':
    case 'created-after':
    case 'references':
      return 'produces-before';
    default:
      return 'requires';
  }
}

/**
 * Detect cycles in the operation dependency graph.
 *
 * Uses Kahn's algorithm — returns the number of nodes remaining after
 * topological processing (0 = acyclic).
 */
export function detectCycles(
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
    if (!opIds.has(dep.sourceOperationId) || !opIds.has(dep.targetOperationId)) {
      continue;
    }
    adjacency.get(dep.sourceOperationId)!.push(dep.targetOperationId);
    inDegree.set(dep.targetOperationId, (inDegree.get(dep.targetOperationId) ?? 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    processed++;
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return opIds.size - processed;
}

/**
 * Deterministic topological sort of operations.
 *
 * Returns operation IDs in execution order.  Ties are broken by
 * lexicographic order of operation IDs for determinism.
 *
 * Throws if a cycle is detected.
 */
export function topologicalSort(
  operations: PreparationOperation[],
  dependencies: PreparationDependency[],
): string[] {
  const opIds = new Set(operations.map((o) => o.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of opIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const dep of dependencies) {
    if (!opIds.has(dep.sourceOperationId) || !opIds.has(dep.targetOperationId)) {
      continue;
    }
    adjacency.get(dep.sourceOperationId)!.push(dep.targetOperationId);
    inDegree.set(dep.targetOperationId, (inDegree.get(dep.targetOperationId) ?? 0) + 1);
  }

  // Kahn's algorithm with deterministic tie-breaking
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort();

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
        queue.sort();
      }
    }
  }

  if (result.length !== opIds.size) {
    throw new Error(
      `Cycle detected: sorted ${result.length} of ${opIds.size} operations`,
    );
  }

  return result;
}

/**
 * Check for dangling dependency references.
 *
 * Returns the number of edges that reference non-existent operation IDs.
 */
export function countDanglingDependencies(
  operations: PreparationOperation[],
  dependencies: PreparationDependency[],
): number {
  const opIds = new Set(operations.map((o) => o.id));
  let dangling = 0;

  for (const dep of dependencies) {
    if (!opIds.has(dep.sourceOperationId)) dangling++;
    if (!opIds.has(dep.targetOperationId)) dangling++;
  }

  return dangling;
}
