// ---------------------------------------------------------------------------
// Quality – resolution quality metrics
// ---------------------------------------------------------------------------

import type {
  PreparationOperation,
  RuntimeBinding,
  PreparationDependency,
  ResolutionUnresolved,
  ResolutionQualityMetrics,
} from '../models.js';
import { detectCycles } from '../graph/topological-sort.js';

/**
 * Compute resolution quality metrics from the resolved output.
 *
 * All metrics are deterministic and computed from the IR itself.
 */
export function computeResolutionQuality(
  dataItemsTotal: number,
  operations: PreparationOperation[],
  bindings: RuntimeBinding[],
  dependencies: PreparationDependency[],
  unresolved: ResolutionUnresolved[],
): ResolutionQualityMetrics {
  const automated = operations.filter(
    (o) => o.resolver !== 'manual' && o.resolver !== 'unknown',
  ).length;
  const manual = operations.filter(
    (o) => o.resolver === 'manual' || o.resolver === 'unknown',
  ).length;

  const resolved = operations.filter((o) => o.resolver !== 'unknown').length;
  const partiallyResolved = operations.filter(
    (o) => o.resolver !== 'unknown' && o.resourceId === undefined && o.resolver !== 'value-generator' && o.resolver !== 'manual',
  ).length;

  const unresolvedCount = unresolved.length;

  // Provenance coverage: fraction of operations with non-empty provenance
  const withProvenance = operations.filter((o) => o.provenance.length > 0).length;
  const provenanceCoverage = operations.length > 0 ? withProvenance / operations.length : 0;

  const cyclicDependencies = detectCycles(operations, dependencies);

  return {
    dataItemsTotal,
    resolved,
    partiallyResolved,
    unresolved: unresolvedCount,
    operations: operations.length,
    automatedOperations: automated,
    manualOperations: manual,
    bindings: bindings.length,
    dependencyEdges: dependencies.length,
    cyclicDependencies,
    provenanceCoverage,
  };
}
