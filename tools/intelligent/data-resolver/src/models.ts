// ---------------------------------------------------------------------------
// Data Resolver – canonical data model
// ---------------------------------------------------------------------------
// Converts Test Data Plan IR into an executor-ready Executable Data
// Preparation IR.  Describes HOW data could be prepared in a specific
// environment, without performing any side effects.

import type {
  TestDataPlanIR,
  TestDataItem,
  DataDependency,
  DataConstraint,
  TestProvenance,
  TestDataUnresolved,
} from 'test-data-planner';

// Re-export upstream types consumed by downstream code
export type {
  TestDataPlanIR,
  TestDataItem,
  DataDependency,
  DataConstraint,
  TestProvenance,
  TestDataUnresolved,
};

// ---- Environment profile (spec §7-9) --------------------------------------

export type EnvironmentResourceType =
  | 'database'
  | 'api'
  | 'account-store'
  | 'filesystem'
  | 'configuration'
  | 'state-store'
  | 'generator'
  | 'other';

export interface EnvironmentResource {
  id: string;
  type: EnvironmentResourceType;
  name: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface EnvironmentCapability {
  id: string;
  name: string;
  description: string;
}

export interface EnvironmentProfile {
  id: string;
  resources: EnvironmentResource[];
  capabilities: EnvironmentCapability[];
  metadata?: Record<string, unknown>;
}

// ---- Resource mapping (spec §44) ------------------------------------------

export interface ResourceMapping {
  logicalEntity: string;
  resourceId: string;
  resourceName?: string;
  fieldMappings?: Record<string, string>;
}

// ---- Resolver types (spec §12-13) -----------------------------------------

export type ResolverType =
  | 'database'
  | 'api'
  | 'account'
  | 'file'
  | 'configuration'
  | 'state'
  | 'value-generator'
  | 'manual'
  | 'unknown';

export type PreparationAction =
  | 'select'
  | 'create'
  | 'generate'
  | 'derive'
  | 'configure'
  | 'mock'
  | 'copy'
  | 'restore'
  | 'none'
  | 'manual'
  | 'unknown';

// ---- Value expressions (spec §34-35) --------------------------------------

export type ValueExpressionType =
  | 'literal'
  | 'generated'
  | 'binding'
  | 'derived'
  | 'boundary';

export interface DataValueExpression {
  type: ValueExpressionType;
  value?: unknown;
  generator?: string;
  binding?: string;
  arguments?: unknown[];
}

// ---- Idempotency (spec §39) -----------------------------------------------

export type IdempotencyMode =
  | 'safe-repeat'
  | 'check-before-create'
  | 'unique-per-run'
  | 'not-idempotent'
  | 'unknown';

export interface IdempotencyPolicy {
  mode: IdempotencyMode;
}

// ---- Preparation operation (spec §11) -------------------------------------

export interface PreparationOperation {
  id: string;
  dataItemId: string;
  resolver: ResolverType;
  action: PreparationAction;
  resourceId?: string;
  parameters: Record<string, unknown>;
  produces: string[];
  consumes: string[];
  cleanupOperationIds: string[];
  provenance: TestProvenance[];
  confidence: number;
  idempotency?: IdempotencyPolicy;
  /** Resolver-specific sub-spec (e.g. DatabasePreparationSpec). */
  resolverSpec?: Record<string, unknown>;
}

// ---- Database preparation spec (spec §25) ---------------------------------

export type DatabaseOperationMode = 'select' | 'insert' | 'derive' | 'update' | 'restore';

export interface DatabasePreparationSpec {
  mode: DatabaseOperationMode;
  entity: string;
  criteria: DataConstraint[];
  values: DataValueExpression[];
  bindings: string[];
}

// ---- API preparation spec (spec §27) --------------------------------------

export interface ApiPreparationSpec {
  operationId: string;
  resource: string;
  methodIntent: string;
  requestDataBindings: string[];
  responseBindings: string[];
  cleanupIntent?: string;
}

// ---- Runtime binding (spec §15-16) ----------------------------------------

export interface RuntimeBinding {
  id: string;
  name: string;
  producerOperationId: string;
  sourcePath?: string;
  dataType?: string;
  sensitive: boolean;
}

// ---- Preparation dependency (spec §17) ------------------------------------

export interface PreparationDependency {
  id: string;
  sourceOperationId: string;
  targetOperationId: string;
  type: 'requires' | 'produces-before' | 'derived-from' | 'cleanup-after';
}

// ---- Unresolved (spec §42) ------------------------------------------------

export type ResolutionUnresolvedReason =
  | 'no-compatible-resolver'
  | 'resource-not-found'
  | 'ambiguous-resource'
  | 'missing-mapping'
  | 'missing-constraint'
  | 'unsupported-strategy'
  | 'other';

export interface ResolutionUnresolved {
  id: string;
  dataItemId: string;
  description: string;
  reason: ResolutionUnresolvedReason;
  provenance: TestProvenance[];
}

// ---- Quality metrics (spec §50) -------------------------------------------

export interface ResolutionQualityMetrics {
  dataItemsTotal: number;
  resolved: number;
  partiallyResolved: number;
  unresolved: number;
  operations: number;
  automatedOperations: number;
  manualOperations: number;
  bindings: number;
  dependencyEdges: number;
  cyclicDependencies: number;
  provenanceCoverage: number;
}

// ---- Top-level IR (spec §10) ----------------------------------------------

export interface ExecutableDataPreparationIR {
  schemaVersion: '1.0';
  environmentProfileId: string;
  operations: PreparationOperation[];
  bindings: RuntimeBinding[];
  dependencies: PreparationDependency[];
  unresolved: ResolutionUnresolved[];
  quality: ResolutionQualityMetrics;
}

// ---- Resolution context (spec §47) ----------------------------------------

export interface ResolutionOptions {
  /** When true, items with no matching resolver fall back to manual. */
  manualFallback: boolean;
  /** Seed for deterministic value generation expressions. */
  generationSeed?: string;
}

export interface ResolutionContext {
  environment: EnvironmentProfile;
  dataItems: TestDataItem[];
  dependencies: DataDependency[];
  mappings: ResourceMapping[];
  options: ResolutionOptions;
}

// ---- Resolver contract (spec §19-20) --------------------------------------

export interface ResolverMatch {
  supported: boolean;
  score: number;
  reasons: string[];
  resourceIds: string[];
}

export interface ResolutionResult {
  operation: PreparationOperation;
  bindings: RuntimeBinding[];
  unresolved?: ResolutionUnresolved;
}

export interface DataResolver {
  readonly type: ResolverType;
  canResolve(item: TestDataItem, context: ResolutionContext): ResolverMatch;
  plan(item: TestDataItem, context: ResolutionContext): ResolutionResult;
}

// ---- Manifest -------------------------------------------------------------

export interface DataResolverWarning {
  code: string;
  message: string;
  dataItemId?: string;
  operationId?: string;
}

export interface DataResolverManifest {
  schemaVersion: '1.0';
  source: {
    testDataPlanIR: string;
  };
  environmentProfileId: string;
  stats: {
    dataItemsTotal: number;
    resolved: number;
    partiallyResolved: number;
    unresolved: number;
    operations: number;
    automatedOperations: number;
    manualOperations: number;
    bindings: number;
    dependencies: number;
  };
  warnings: DataResolverWarning[];
}

// ---- Builder options ------------------------------------------------------

export interface DataResolverOptions {
  outputDir?: string;
  environmentProfile?: EnvironmentProfile;
  mappings?: ResourceMapping[];
  manualFallback?: boolean;
  generationSeed?: string;
}
