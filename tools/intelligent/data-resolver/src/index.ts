// ---------------------------------------------------------------------------
// Data Resolver – barrel export
// ---------------------------------------------------------------------------

// Core engine
export { resolveDataPlan, buildManifest } from './resolver-engine.js';

// Registry
export { registerResolver, getResolver, listResolvers, findBestResolver, clearRegistry } from './registry.js';

// Models
export type {
  ExecutableDataPreparationIR,
  PreparationOperation,
  RuntimeBinding,
  PreparationDependency,
  ResolutionUnresolved,
  ResolutionQualityMetrics,
  EnvironmentProfile,
  EnvironmentResource,
  EnvironmentCapability,
  ResourceMapping,
  ResolutionContext,
  ResolutionOptions,
  DataResolver,
  ResolverMatch,
  ResolutionResult,
  ResolverType,
  PreparationAction,
  DataValueExpression,
  IdempotencyPolicy,
  DatabasePreparationSpec,
  DatabaseOperationMode,
  ApiPreparationSpec,
  DataResolverManifest,
  DataResolverWarning,
  DataResolverOptions,
} from './models.js';

// Errors
export { DataResolverError, DataResolverErrorCode } from './errors.js';

// Warnings
export { DataResolverWarningCode } from './warnings.js';

// Resolvers
export {
  databaseResolver,
  apiResolver,
  accountResolver,
  fileResolver,
  configurationResolver,
  stateResolver,
  valueGenerator,
  manualResolver,
} from './resolvers/index.js';

// Graph
export { topologicalSort, detectCycles, buildPreparationDependencies, countDanglingDependencies } from './graph/topological-sort.js';

// Quality
export { computeResolutionQuality } from './quality/metrics.js';

// Validation
export { validateDataPlan, validateEnvironmentProfile, validateMappings } from './validation/input-validator.js';

// Persistence
export { writeOutput, loadOutput } from './persistence/output-writer.js';
