// ---------------------------------------------------------------------------
// Resolution Engine
// ---------------------------------------------------------------------------
// Orchestrates the full resolution pipeline:
// 1. Validate input
// 2. Build resolution context
// 3. Register built-in resolvers
// 4. Resolve each data item via the best matching resolver
// 5. Build operation dependency graph
// 6. Topological sort
// 7. Compute quality metrics
// 8. Return ExecutableDataPreparationIR

import type {
  TestDataPlanIR,
  EnvironmentProfile,
  ResourceMapping,
  ResolutionContext,
  ResolutionOptions,
  ExecutableDataPreparationIR,
  PreparationOperation,
  RuntimeBinding,
  ResolutionUnresolved,
  DataResolverWarning,
  DataResolverManifest,
  DataResolverOptions,
} from './models.js';
import { validateDataPlan, validateEnvironmentProfile, validateMappings } from './validation/input-validator.js';
import { registerResolver, clearRegistry, findBestResolver } from './registry.js';
import {
  databaseResolver,
  apiResolver,
  accountResolver,
  fileResolver,
  configurationResolver,
  stateResolver,
  valueGenerator,
  manualResolver,
} from './resolvers/index.js';
import { buildPreparationDependencies, topologicalSort, detectCycles, countDanglingDependencies } from './graph/topological-sort.js';
import { computeResolutionQuality } from './quality/metrics.js';
import { DataResolverWarningCode } from './warnings.js';

/**
 * Register all built-in resolvers.
 *
 * Order matters for tie-breaking: first registered wins on equal scores.
 * The manual resolver is always last as a universal fallback.
 */
function registerBuiltInResolvers(): void {
  clearRegistry();
  registerResolver(accountResolver);       // highest specificity for account type
  registerResolver(apiResolver);           // tokens, external responses
  registerResolver(databaseResolver);      // database records, DB-hinted items
  registerResolver(configurationResolver); // configuration type
  registerResolver(fileResolver);          // file type
  registerResolver(stateResolver);         // state type
  registerResolver(valueGenerator);        // generated inputs, identifiers
  registerResolver(manualResolver);        // universal fallback (lowest score)
}

/**
 * Build the resolution context from inputs.
 */
function buildContext(
  plan: TestDataPlanIR,
  environment: EnvironmentProfile,
  mappings: ResourceMapping[],
  options: ResolutionOptions,
): ResolutionContext {
  return {
    environment,
    dataItems: plan.dataItems,
    dependencies: plan.dependencyGraph,
    mappings,
    options,
  };
}

/**
 * Main resolution entry point.
 *
 * Converts a Test Data Plan IR + Environment Profile into an
 * Executable Data Preparation IR.
 *
 * This function is entirely deterministic and performs NO side effects.
 */
export function resolveDataPlan(
  plan: TestDataPlanIR,
  environment: EnvironmentProfile,
  options?: DataResolverOptions,
): {
  ir: ExecutableDataPreparationIR;
  warnings: DataResolverWarning[];
} {
  // Validate inputs
  validateDataPlan(plan);
  validateEnvironmentProfile(environment);

  const mappings = options?.mappings ?? [];
  validateMappings(mappings);

  const resolutionOptions: ResolutionOptions = {
    manualFallback: options?.manualFallback ?? true,
    generationSeed: options?.generationSeed,
  };

  const context = buildContext(plan, environment, mappings, resolutionOptions);

  // Register built-in resolvers
  registerBuiltInResolvers();

  const allOperations: PreparationOperation[] = [];
  const allBindings: RuntimeBinding[] = [];
  const allUnresolved: ResolutionUnresolved[] = [];
  const warnings: DataResolverWarning[] = [];

  // Resolve each data item
  for (const item of plan.dataItems) {
    const best = findBestResolver(item, context);

    if (!best || best.match.score < 0.1) {
      // No resolver matched — create unresolved entry
      if (resolutionOptions.manualFallback) {
        // Fall back to manual resolver
        const manualResult = manualResolver.plan(item, context);
        allOperations.push(manualResult.operation);
        allBindings.push(...manualResult.bindings);
        warnings.push({
          code: DataResolverWarningCode.MANUAL_FALLBACK,
          message: `No automated resolver for "${item.id}" — using manual fallback`,
          dataItemId: item.id,
          operationId: manualResult.operation.id,
        });
      } else {
        allUnresolved.push({
          id: `UNRESOLVED-${item.id}`,
          dataItemId: item.id,
          description: `No compatible resolver for "${item.name}"`,
          reason: 'no-compatible-resolver',
          provenance: item.provenance,
        });
        warnings.push({
          code: DataResolverWarningCode.NO_COMPATIBLE_RESOLVER,
          message: `No compatible resolver for "${item.id}"`,
          dataItemId: item.id,
        });
      }
      continue;
    }

    const result = best.resolver.plan(item, context);
    allOperations.push(result.operation);
    allBindings.push(...result.bindings);

    if (result.unresolved) {
      allUnresolved.push(result.unresolved);
      warnings.push({
        code: DataResolverWarningCode.RESOURCE_NOT_FOUND,
        message: result.unresolved.description,
        dataItemId: item.id,
        operationId: result.operation.id,
      });
    }

    if (best.match.score < 0.5) {
      warnings.push({
        code: DataResolverWarningCode.AMBIGUOUS_RESOURCE,
        message: `Low-confidence resolution for "${item.id}" (score: ${best.match.score})`,
        dataItemId: item.id,
        operationId: result.operation.id,
      });
    }
  }

  // Propagate existing unresolved items from the data plan
  for (const u of plan.unresolved) {
    allUnresolved.push({
      id: `INHERITED-${u.id}`,
      dataItemId: u.id,
      description: u.description,
      reason: 'missing-mapping',
      provenance: u.provenance,
    });
  }

  // Build operation dependencies from data dependencies
  const prepDependencies = buildPreparationDependencies(plan.dependencyGraph);

  // Validate graph
  const cycles = detectCycles(allOperations, prepDependencies);
  const _dangling = countDanglingDependencies(allOperations, prepDependencies);

  if (cycles > 0) {
    warnings.push({
      code: 'RESOLVER_CYCLE_DETECTED',
      message: `${cycles} cyclic dependencies detected in operation graph`,
    });
  }

  // Topological sort (only if acyclic)
  let sortedOps = allOperations;
  if (cycles === 0) {
    try {
      const order = topologicalSort(allOperations, prepDependencies);
      const opMap = new Map(allOperations.map((o) => [o.id, o]));
      sortedOps = order.map((id) => opMap.get(id)!).filter(Boolean);
    } catch {
      // If sort fails, keep original order
      warnings.push({
        code: 'RESOLVER_SORT_FAILED',
        message: 'Topological sort failed — operations in original order',
      });
    }
  }

  // Compute quality metrics
  const quality = computeResolutionQuality(
    plan.dataItems.length,
    allOperations,
    allBindings,
    prepDependencies,
    allUnresolved,
  );

  const ir: ExecutableDataPreparationIR = {
    schemaVersion: '1.0',
    environmentProfileId: environment.id,
    operations: sortedOps,
    bindings: allBindings,
    dependencies: prepDependencies,
    unresolved: allUnresolved,
    quality,
  };

  return { ir, warnings };
}

/**
 * Build a manifest for the resolution output.
 */
export function buildManifest(
  sourcePath: string,
  environmentProfileId: string,
  ir: ExecutableDataPreparationIR,
  warnings: DataResolverWarning[],
): DataResolverManifest {
  return {
    schemaVersion: '1.0',
    source: {
      testDataPlanIR: sourcePath,
    },
    environmentProfileId,
    stats: {
      dataItemsTotal: ir.quality.dataItemsTotal,
      resolved: ir.quality.resolved,
      partiallyResolved: ir.quality.partiallyResolved,
      unresolved: ir.quality.unresolved,
      operations: ir.quality.operations,
      automatedOperations: ir.quality.automatedOperations,
      manualOperations: ir.quality.manualOperations,
      bindings: ir.quality.bindings,
      dependencies: ir.quality.dependencyEdges,
    },
    warnings,
  };
}
