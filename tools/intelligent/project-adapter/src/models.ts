// Project Adapter Architecture v1 — Canonical data model.
//
// Converts project-specific metadata into canonical TIRAI catalogs and
// execution profiles. Downstream modules (Execution Mapping Builder,
// UI/API/DB Executors) consume profile slices without inspecting project
// files directly.

import type {
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UIEnvironmentConfig,
  UIActionType,
  UIAssertionType,
  UILocatorStrategy,
} from 'ui-executor';

import type {
  DatabaseCatalog,
  DatabaseSchemaMetadata,
  DatabaseTableMetadata,
  DatabaseColumnMetadata,
  DatabaseForeignKeyMetadata,
  DatabaseConnectionConfig,
  DatabaseDialect,
} from 'database-executor';

import type {
  EnvironmentProfile,
  ResourceMapping,
} from 'data-resolver';

import type {
  TestProvenance,
} from 'test-execution-orchestrator';

// Re-export upstream types for downstream consumers.
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
};

// ---- Project Adapter Source (spec §8) -------------------------------------

export interface ProjectAdapterSource {
  projectRoot: string;
  configPath?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
}

// ---- Project Adapter Match (spec §34) -------------------------------------

export interface ProjectAdapterMatch {
  supported: boolean;
  score: number;
  reasons: string[];
}

// ---- Project Adapter Load Options -----------------------------------------

export interface ProjectAdapterLoadOptions {
  environment?: string;
  strict?: boolean;
}

// ---- Project Adapter Contract (spec §7) -----------------------------------

export interface ProjectAdapter {
  readonly id: string;
  readonly version: string;

  canLoad(source: ProjectAdapterSource): Promise<ProjectAdapterMatch>;
  load(
    source: ProjectAdapterSource,
    options?: ProjectAdapterLoadOptions,
  ): Promise<ProjectExecutionProfile>;
  validate?(
    profile: ProjectExecutionProfile,
  ): Promise<ProjectAdapterValidationResult>;
}

// ---- Project Identity (spec §10) ------------------------------------------

export interface ProjectIdentity {
  id: string;
  name: string;
  version?: string;
  root: string;
  adapterId: string;
  adapterVersion: string;
}

// ---- Environment Safety (spec §30) ----------------------------------------

export type EnvironmentSafety =
  | 'isolated'
  | 'shared-nonprod'
  | 'production'
  | 'unknown';

// ---- Environment Definition -----------------------------------------------

export interface ProjectEnvironmentDefinition {
  id: string;
  name: string;
  safety: EnvironmentSafety;
  baseUrl?: string;
  apiBaseUrl?: string;
  databaseHost?: string;
  databasePort?: number;
  databaseName?: string;
  envRefs?: string[];
}

// ---- Tenant Resolution (spec §19) -----------------------------------------

export type TenantResolutionStrategy =
  | 'fixed-schema'
  | 'schema-per-tenant'
  | 'database-per-tenant'
  | 'shared-schema'
  | 'runtime'
  | 'none';

export interface TenantProfile {
  strategy: TenantResolutionStrategy;
  schemaPattern?: string;
  defaultTestTenant?: string;
}

// ---- UI Project Profile (spec §11) ----------------------------------------

export interface UIProjectProfile {
  environment: UIEnvironmentConfig;
  catalog: UIElementCatalog;
  executionDefaults?: {
    browser?: 'chromium' | 'firefox' | 'webkit';
    testIdAttribute?: string;
    headless?: boolean;
  };
}

// ---- API Resource Definition (spec §13-15) --------------------------------

export interface APIResourceDefinition {
  id: string;
  baseUrlRef: string;
  allowedOrigins?: string[];
  authStrategy?: APIAuthStrategyRef;
}

export interface APIAuthStrategyRef {
  kind: 'none' | 'bearer' | 'api-key' | 'basic' | 'custom-header';
  secretRef?: string;
  headerName?: string;
}

export interface APIOperationDefinition {
  id: string;
  resourceId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  inputSchemaHints?: Record<string, string>;
  responseSchemaHints?: Record<string, string>;
}

export interface APIResourceMapping {
  logicalEntity: string;
  resourceId: string;
  operationIds?: string[];
}

// ---- API Project Profile (spec §13) ---------------------------------------

export interface APIProjectProfile {
  resources: APIResourceDefinition[];
  operations: APIOperationDefinition[];
  mappings: APIResourceMapping[];
}

// ---- Database Resource Definition (spec §16-17) ---------------------------

export interface DatabaseResourceDefinition {
  id: string;
  dialect: DatabaseDialect;
  hostRef?: string;
  port?: number;
  database?: string;
  schema?: string;
  connectionSecretRef?: string;
  tenantStrategy?: TenantProfile;
}

// ---- Database Project Profile (spec §16) ----------------------------------

export interface DatabaseProjectProfile {
  resources: DatabaseResourceDefinition[];
  catalogs: DatabaseCatalog[];
  mappings: ResourceMapping[];
}

// ---- Runtime Binding Definition (spec §22) --------------------------------

export interface RuntimeBindingDefinition {
  name: string;
  type: 'runtime' | 'secret' | 'generated';
  sensitive: boolean;
  producerHints?: string[];
  consumerHints?: string[];
  description?: string;
}

// ---- Runtime Binding Catalog (spec §22) -----------------------------------

export interface RuntimeBindingCatalog {
  definitions: RuntimeBindingDefinition[];
}

// ---- Secret Reference (spec §23) ------------------------------------------

export interface SecretReferenceDefinition {
  name: string;
  description?: string;
}

// ---- Secret Reference Catalog (spec §23) ----------------------------------

export interface SecretReferenceCatalog {
  references: SecretReferenceDefinition[];
}

// ---- Project Command (spec §24-25) ----------------------------------------

export type ProjectCommandPurpose =
  | 'install'
  | 'build'
  | 'start'
  | 'stop'
  | 'migrate'
  | 'seed'
  | 'test'
  | 'other';

export interface ProjectCommandDefinition {
  id: string;
  purpose: ProjectCommandPurpose;
  command: string;
  args: string[];
  cwd?: string;
  envRefs: string[];
  safeForAutomation: boolean;
}

// ---- Project Command Catalog (spec §24) -----------------------------------

export interface ProjectCommandCatalog {
  commands: ProjectCommandDefinition[];
}

// ---- Project Capabilities (spec §28) --------------------------------------

export interface ProjectCapabilities {
  ui: boolean;
  api: boolean;
  database: boolean;
  multiTenant: boolean;
  localStart: boolean;
  testDataMutation: boolean;
  browserExecution: boolean;
  apiExecution: boolean;
  databaseExecution: boolean;
}

// ---- Project Profile Provenance -------------------------------------------

export interface ProjectProfileProvenance {
  source: string;
  adapterId: string;
  adapterVersion: string;
  timestamp: string;
}

// ---- Project Execution Profile (spec §9) ----------------------------------

export interface ProjectExecutionProfile {
  schemaVersion: '1.0';
  project: ProjectIdentity;
  environment: ProjectEnvironmentDefinition;
  ui?: UIProjectProfile;
  api?: APIProjectProfile;
  database?: DatabaseProjectProfile;
  bindings: RuntimeBindingCatalog;
  secrets: SecretReferenceCatalog;
  commands: ProjectCommandCatalog;
  capabilities: ProjectCapabilities;
  provenance: ProjectProfileProvenance[];
  fingerprint: string;
}

// ---- Validation Result ----------------------------------------------------

export interface ProjectAdapterValidationResult {
  valid: boolean;
  errors: ProjectAdapterError[];
  warnings: ProjectAdapterWarning[];
}

// ---- Error Codes (spec §55) -----------------------------------------------

export type ProjectAdapterErrorCode =
  | 'PROJECT_CONFIG_NOT_FOUND'
  | 'PROJECT_CONFIG_INVALID'
  | 'PROJECT_PATH_ESCAPE'
  | 'PROJECT_SCHEMA_UNSUPPORTED'
  | 'PROJECT_DUPLICATE_RESOURCE'
  | 'PROJECT_INVALID_REFERENCE'
  | 'PROJECT_ADAPTER_NOT_FOUND'
  | 'PROJECT_CATALOG_INVALID'
  | 'PROJECT_ENVIRONMENT_NOT_FOUND'
  | 'PROJECT_INTERNAL_ERROR';

export interface ProjectAdapterError {
  code: ProjectAdapterErrorCode;
  message: string;
  path?: string;
}

// ---- Warning Codes (spec §54) ---------------------------------------------

export type ProjectAdapterWarningCode =
  | 'PROJECT_ENVIRONMENT_UNKNOWN'
  | 'PROJECT_NO_UI'
  | 'PROJECT_NO_API'
  | 'PROJECT_NO_DATABASE'
  | 'PROJECT_SECRET_REFERENCE_UNUSED'
  | 'PROJECT_COMMAND_UNSAFE'
  | 'PROJECT_PRODUCTION_ENVIRONMENT'
  | 'PROJECT_CATALOG_EMPTY'
  | 'PROJECT_BINDING_UNUSED';

export interface ProjectAdapterWarning {
  code: ProjectAdapterWarningCode;
  message: string;
  path?: string;
}

// ---- Project Readiness (spec §80) -----------------------------------------

export interface ProjectReadiness {
  executionMappingReady: boolean;
  uiExecutionReady: boolean;
  apiExecutionReady: boolean;
  databaseExecutionReady: boolean;
  endToEndRunnerReady: boolean;
  blockers: ProjectReadinessBlocker[];
}

export interface ProjectReadinessBlocker {
  area: 'ui' | 'api' | 'database' | 'bindings' | 'environment' | 'commands';
  description: string;
}

// ---- Quality Metrics (spec §82) -------------------------------------------

export interface ProjectProfileQuality {
  resources: number;
  validResources: number;
  uiPages: number;
  uiElements: number;
  apiOperations: number;
  databaseTables: number;
  bindings: number;
  secretRefs: number;
  commands: number;
  invalidReferences: number;
  warnings: number;
  readinessScore: number;
}

// ---- Validation Report (spec §53) -----------------------------------------

export interface ProjectValidationReport {
  schemaVersion: '1.0';
  projectId: string;
  environmentId: string;
  safety: EnvironmentSafety;
  fingerprint: string;
  errors: ProjectAdapterError[];
  warnings: ProjectAdapterWarning[];
  quality: ProjectProfileQuality;
  capabilities: ProjectCapabilities;
  readiness: ProjectReadiness;
}

// ---- Adapter Config JSON Schema Types (spec §35-36) -----------------------

export interface ProjectAdapterConfig {
  schemaVersion: string;
  project: {
    id: string;
    name: string;
    version?: string;
  };
  environments?: Record<string, ProjectEnvironmentConfig>;
  ui?: ProjectAdapterUIConfig;
  api?: ProjectAdapterAPIConfig;
  database?: ProjectAdapterDatabaseConfig;
  bindings?: ProjectAdapterBindingsConfig;
  secrets?: ProjectAdapterSecretsConfig;
  commands?: ProjectAdapterCommandsConfig;
}

export interface ProjectEnvironmentConfig {
  name: string;
  safety: EnvironmentSafety;
  baseUrl?: string;
  apiBaseUrl?: string;
  databaseHost?: string;
  databasePort?: number;
  databaseName?: string;
  envRefs?: string[];
}

export interface ProjectAdapterUIConfig {
  catalog?: string;
  baseUrl?: string;
  allowedOrigins?: string[];
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  testIdAttribute?: string;
}

export interface ProjectAdapterAPIConfig {
  catalog?: string;
  resources?: APIResourceDefinition[];
  operations?: APIOperationDefinition[];
  mappings?: APIResourceMapping[];
}

export interface ProjectAdapterDatabaseConfig {
  catalog?: string;
  resources?: DatabaseResourceDefinition[];
  mappings?: ResourceMapping[];
}

export interface ProjectAdapterBindingsConfig {
  definitions?: RuntimeBindingDefinition[];
}

export interface ProjectAdapterSecretsConfig {
  references?: SecretReferenceDefinition[];
}

export interface ProjectAdapterCommandsConfig {
  commands?: ProjectAdapterCommandConfig[];
}

export interface ProjectAdapterCommandConfig {
  id: string;
  purpose: ProjectCommandPurpose;
  command: string;
  args?: string[];
  cwd?: string;
  envRefs?: string[];
  safeForAutomation?: boolean;
}

// ---- Builder Options ------------------------------------------------------

export interface ProjectAdapterBuilderOptions {
  source: ProjectAdapterSource;
  adapterId?: string;
  environment?: string;
  outputDir?: string;
  validateOnly?: boolean;
  pretty?: boolean;
}

// ---- Builder Result -------------------------------------------------------

export interface ProjectAdapterResult {
  profile: ProjectExecutionProfile;
  validation: ProjectAdapterValidationResult;
  report: ProjectValidationReport;
}
