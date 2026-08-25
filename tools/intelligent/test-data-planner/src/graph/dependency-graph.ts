// ---------------------------------------------------------------------------
// Test Data Planner – dependency graph builder and cycle detector
// ---------------------------------------------------------------------------

import type { DataDependency, DataDependencyType } from '../models.js';

/**
 * Build a deterministic dependency graph from dependency candidates.
 * Returns the final dependency list with deterministic IDs and detects cycles.
 */
export function buildDependencyGraph(
  candidates: Array<{
    sourceDataItemId: string;
    targetDataItemId: string;
    type: DataDependencyType;
    description?: string;
  }>,
): { dependencies: DataDependency[]; cycles: string[][] } {
  // A data item can never depend on itself. Providers occasionally emit this
  // malformed edge when near-duplicate candidates normalize to one final
  // item; retaining it would make runtime resolution block forever.
  const validCandidates = candidates.filter(
    (candidate) => candidate.sourceDataItemId !== candidate.targetDataItemId,
  );

  // Detect cycles using DFS
  const adj = new Map<string, string[]>();
  for (const c of validCandidates) {
    const edges = adj.get(c.sourceDataItemId) ?? [];
    edges.push(c.targetDataItemId);
    adj.set(c.sourceDataItemId, edges);
  }

  const cycles = detectCycles(adj);

  // Assign deterministic IDs
  const dependencies: DataDependency[] = validCandidates.map((c, i) => ({
    id: `DEP-${String(i + 1).padStart(4, '0')}`,
    sourceDataItemId: c.sourceDataItemId,
    targetDataItemId: c.targetDataItemId,
    type: c.type,
    description: c.description,
  }));

  return { dependencies, cycles };
}

/**
 * Detect cycles in a directed graph using DFS.
 * Returns an array of cycles (each cycle is an array of node IDs).
 */
export function detectCycles(adj: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (inStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      dfs(neighbor);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of adj.keys()) {
    dfs(node);
  }

  return cycles;
}

/**
 * Validate that all dependency references point to valid data item IDs.
 * Returns dangling reference IDs.
 */
export function findDanglingReferences(
  dependencies: DataDependency[],
  validDataItemIds: Set<string>,
): string[] {
  const dangling: string[] = [];
  for (const dep of dependencies) {
    if (!validDataItemIds.has(dep.sourceDataItemId)) {
      dangling.push(dep.sourceDataItemId);
    }
    if (!validDataItemIds.has(dep.targetDataItemId)) {
      dangling.push(dep.targetDataItemId);
    }
  }
  return [...new Set(dangling)];
}
