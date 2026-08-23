// Project Adapter — public API barrel.
//
// Re-exports canonical models, adapter contract, registry, JSON adapter,
// loader, validator, fingerprint, readiness, selectors, and persistence.

// Models
export type {
  ProjectAdapter,
  ProjectAdapterSource,
  ProjectAdapterMatch,
  ProjectAdapterLoadOptions,
  ProjectExecutionProfile,
  ProjectIdentity,
  ProjectEnvironmentDefinition,
  EnvironmentSafety,
  UIProjectProfile,
  APIProjectProfile,
  APIResourceDefinition,
  APIOperationDefinition,
  APIResourceMapping,
  APIAuthStrategyRef,
  DatabaseProjectProfile,
  DatabaseResourceDefinition,
  RuntimeBindingCatalog,
  RuntimeBindingDefinition,
  SecretReferenceCatalog,
  SecretReferenceDefinition,
  ProjectCommandCatalog,
  ProjectCommandDefinition,
  ProjectCommandPurpose,
  ProjectCapabilities,
  ProjectProfileProvenance,
  TenantResolutionStrategy,
  TenantProfile,
  ProjectAdapterConfig,
  ProjectAdapterValidationResult,
  ProjectAdapterError as ModelError,
  ProjectAdapterWarning,
  ProjectAdapterErrorCode,
  ProjectAdapterWarningCode,
  ProjectReadiness,
  ProjectReadinessBlocker,
  ProjectProfileQuality,
  ProjectValidationReport,
  ProjectAdapterBuilderOptions,
  ProjectAdapterResult,
} from './models.js';

// Re-export upstream types
export type {
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UIEnvironmentConfig,
  UIActionType,
  UIAssertionType,
  UILocatorStrategy,
  DatabaseCatalog,
  DatabaseSchemaMetadata,
  DatabaseTableMetadata,
  DatabaseColumnMetadata,
  DatabaseForeignKeyMetadata,
  DatabaseConnectionConfig,
  DatabaseDialect,
  EnvironmentProfile,
  ResourceMapping,
  TestProvenance,
} from './models.js';

// Error class
export { ProjectAdapterError } from './errors.js';

// Warning helper
export { createWarning } from './warnings.js';

// Registry
export { ProjectAdapterRegistry } from './registry.js';

// JSON adapter
export { JsonProjectAdapter, validateTenantId } from './adapters/json-project-adapter.js';

// Loader
export {
  loadConfig,
  resolveConfigPath,
  assertWithinRoot,
  safeReadFile,
  loadCatalogJson,
} from './loader.js';

// Validator
export { validateProfile } from './validator.js';

// Fingerprint
export { computeProfileFingerprint, computeFingerprintFromProfile } from './fingerprint.js';

// Readiness
export { deriveReadiness, deriveQuality } from './readiness.js';

// Selectors
export {
  getUIProfile,
  getAPIProfile,
  getDatabaseProfile,
  getEnvironment,
  getBinding,
  getSecretRef,
  getCommand,
} from './selectors.js';

// Persistence
export { writeProfileOutput } from './persistence/writer.js';
