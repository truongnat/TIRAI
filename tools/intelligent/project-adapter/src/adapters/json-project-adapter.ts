// JSON Project Adapter — reads tirai.project.json and builds canonical profile.
//
// This is the first real adapter. It reads a data-only JSON config,
// loads referenced catalog files, and produces a ProjectExecutionProfile.
// No code execution, no AI, no network, no shell commands.

import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import type {
  ProjectAdapter,
  ProjectAdapterSource,
  ProjectAdapterMatch,
  ProjectAdapterLoadOptions,
  ProjectAdapterConfig,
  ProjectExecutionProfile,
  ProjectAdapterValidationResult,
  ProjectIdentity,
  ProjectEnvironmentDefinition,
  UIProjectProfile,
  APIProjectProfile,
  DatabaseProjectProfile,
  RuntimeBindingCatalog,
  SecretReferenceCatalog,
  ProjectCommandCatalog,
  ProjectCapabilities,
  ProjectProfileProvenance,
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UIEnvironmentConfig,
  UILocatorStrategy,
  APIResourceDefinition,
  APIOperationDefinition,
  APIResourceMapping,
  DatabaseResourceDefinition,
  DatabaseCatalog,
  ResourceMapping,
} from '../models.js';
import { ProjectAdapterError } from '../errors.js';
import { loadConfig, safeReadFile, loadCatalogJson, assertWithinRoot } from '../loader.js';
import { computeProfileFingerprint } from '../fingerprint.js';

const ADAPTER_ID = 'json-project-adapter';
const ADAPTER_VERSION = '1.0.0';

const SAFE_TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class JsonProjectAdapter implements ProjectAdapter {
  readonly id = ADAPTER_ID;
  readonly version = ADAPTER_VERSION;

  async canLoad(source: ProjectAdapterSource): Promise<ProjectAdapterMatch> {
    const configPath = source.configPath ?? 'tirai.project.json';
    const fullPath = isAbsolute(configPath)
      ? configPath
      : resolve(source.projectRoot, configPath);
    try {
      await readFile(fullPath, 'utf-8');
      return { supported: true, score: 10, reasons: ['tirai.project.json found'] };
    } catch {
      return { supported: false, score: 0, reasons: ['tirai.project.json not found'] };
    }
  }

  async load(
    source: ProjectAdapterSource,
    options?: ProjectAdapterLoadOptions,
  ): Promise<ProjectExecutionProfile> {
    const { config, raw } = await loadConfig(source);
    const envId = options?.environment ?? source.environment ?? 'local';

    // Resolve environment.
    const envConfig = config.environments?.[envId];
    if (!envConfig) {
      throw new ProjectAdapterError(
        'PROJECT_ENVIRONMENT_NOT_FOUND',
        `Environment "${envId}" not found in config`,
      );
    }

    const environment = buildEnvironment(envId, envConfig);

    // Load catalogs.
    const catalogContents: string[] = [];
    let uiProfile: UIProjectProfile | undefined;
    let apiProfile: APIProjectProfile | undefined;
    let dbProfile: DatabaseProjectProfile | undefined;

    if (config.ui) {
      uiProfile = await this.loadUIProfile(config, source.projectRoot, catalogContents);
    }
    if (config.api) {
      apiProfile = await this.loadAPIProfile(config, source.projectRoot, catalogContents);
    }
    if (config.database) {
      dbProfile = await this.loadDBProfile(config, source.projectRoot, catalogContents);
    }

    // Bindings.
    const bindings = buildBindings(config);
    // Secrets.
    const secrets = buildSecrets(config);
    // Commands.
    const commands = buildCommands(config);
    // Capabilities (derived, not trusted).
    const capabilities = deriveCapabilities(uiProfile, apiProfile, dbProfile, commands);

    // Identity.
    const project: ProjectIdentity = {
      id: config.project.id,
      name: config.project.name,
      version: config.project.version,
      root: source.projectRoot,
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
    };

    // Fingerprint.
    const fingerprint = computeProfileFingerprint(
      ADAPTER_VERSION,
      raw,
      catalogContents,
      envId,
    );

    // Provenance.
    const provenance: ProjectProfileProvenance[] = [
      {
        source: source.configPath ?? 'tirai.project.json',
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
        timestamp: new Date().toISOString(),
      },
    ];

    return {
      schemaVersion: '1.0',
      project,
      environment,
      ui: uiProfile,
      api: apiProfile,
      database: dbProfile,
      bindings,
      secrets,
      commands,
      capabilities,
      provenance,
      fingerprint,
    };
  }

  async validate(
    profile: ProjectExecutionProfile,
  ): Promise<ProjectAdapterValidationResult> {
    // Basic structural validation.
    const errors: ProjectAdapterValidationResult['errors'] = [];
    const warnings: ProjectAdapterValidationResult['warnings'] = [];

    if (profile.schemaVersion !== '1.0') {
      errors.push({
        code: 'PROJECT_SCHEMA_UNSUPPORTED',
        message: `Unsupported schema version: ${profile.schemaVersion}`,
      });
    }
    if (!profile.project.id) {
      errors.push({
        code: 'PROJECT_CONFIG_INVALID',
        message: 'Missing project ID',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // --- Private catalog loaders ---

  private async loadUIProfile(
    config: ProjectAdapterConfig,
    root: string,
    catalogContents: string[],
  ): Promise<UIProjectProfile> {
    const uiConfig = config.ui!;
    let catalog: UIElementCatalog;

    if (uiConfig.catalog) {
      const catalogPath = uiConfig.catalog;
      assertWithinRoot(
        isAbsolute(catalogPath) ? catalogPath : resolve(root, catalogPath),
        root,
      );
      const raw = await safeReadFile(catalogPath, root);
      catalogContents.push(raw);
      const parsed = loadCatalogJson(raw, catalogPath);
      catalog = parseUICatalog(parsed);
    } else {
      catalog = { environmentId: 'default', pages: [] };
    }

    const baseUrl = uiConfig.baseUrl ?? '';
    const env: UIEnvironmentConfig = {
      baseUrl,
      allowedOrigins: uiConfig.allowedOrigins ?? [baseUrl].filter(Boolean),
      browser: uiConfig.browser,
      headless: uiConfig.headless,
    };

    return {
      environment: env,
      catalog,
      executionDefaults: {
        browser: uiConfig.browser,
        testIdAttribute: uiConfig.testIdAttribute,
        headless: uiConfig.headless,
      },
    };
  }

  private async loadAPIProfile(
    config: ProjectAdapterConfig,
    root: string,
    catalogContents: string[],
  ): Promise<APIProjectProfile> {
    const apiConfig = config.api!;
    let resources: APIResourceDefinition[] = apiConfig.resources ?? [];
    let operations: APIOperationDefinition[] = apiConfig.operations ?? [];
    let mappings: APIResourceMapping[] = apiConfig.mappings ?? [];

    if (apiConfig.catalog) {
      const raw = await safeReadFile(apiConfig.catalog, root);
      catalogContents.push(raw);
      const parsed = loadCatalogJson(raw, apiConfig.catalog);
      if (Array.isArray(parsed['resources'])) {
        resources = [...resources, ...(parsed['resources'] as APIResourceDefinition[])];
      }
      if (Array.isArray(parsed['operations'])) {
        operations = [...operations, ...(parsed['operations'] as APIOperationDefinition[])];
      }
      if (Array.isArray(parsed['mappings'])) {
        mappings = [...mappings, ...(parsed['mappings'] as APIResourceMapping[])];
      }
    }

    return { resources, operations, mappings };
  }

  private async loadDBProfile(
    config: ProjectAdapterConfig,
    root: string,
    catalogContents: string[],
  ): Promise<DatabaseProjectProfile> {
    const dbConfig = config.database!;
    let resources: DatabaseResourceDefinition[] = dbConfig.resources ?? [];
    let catalogs: DatabaseCatalog[] = [];
    let dbMappings: ResourceMapping[] = dbConfig.mappings ?? [];

    if (dbConfig.catalog) {
      const raw = await safeReadFile(dbConfig.catalog, root);
      catalogContents.push(raw);
      const parsed = loadCatalogJson(raw, dbConfig.catalog);
      if (Array.isArray(parsed['resources'])) {
        resources = [...resources, ...(parsed['resources'] as DatabaseResourceDefinition[])];
      }
      if (Array.isArray(parsed['catalogs'])) {
        catalogs = parsed['catalogs'] as DatabaseCatalog[];
      }
      if (Array.isArray(parsed['mappings'])) {
        dbMappings = [...dbMappings, ...(parsed['mappings'] as ResourceMapping[])];
      }
    }

    return { resources, catalogs, mappings: dbMappings };
  }
}

// --- Helper builders ---

function buildEnvironment(
  id: string,
  config: ProjectAdapterConfig['environments'] extends undefined
    ? never
    : NonNullable<ProjectAdapterConfig['environments']>[string],
): ProjectEnvironmentDefinition {
  return {
    id,
    name: config.name,
    safety: config.safety,
    baseUrl: config.baseUrl,
    apiBaseUrl: config.apiBaseUrl,
    databaseHost: config.databaseHost,
    databasePort: config.databasePort,
    databaseName: config.databaseName,
    envRefs: config.envRefs,
  };
}

function buildBindings(config: ProjectAdapterConfig): RuntimeBindingCatalog {
  return {
    definitions: config.bindings?.definitions ?? [],
  };
}

function buildSecrets(config: ProjectAdapterConfig): SecretReferenceCatalog {
  return {
    references: config.secrets?.references ?? [],
  };
}

function buildCommands(config: ProjectAdapterConfig): ProjectCommandCatalog {
  const cmds = config.commands?.commands ?? [];
  return {
    commands: cmds.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      command: c.command,
      args: c.args ?? [],
      cwd: c.cwd,
      envRefs: c.envRefs ?? [],
      safeForAutomation: c.safeForAutomation ?? false,
    })),
  };
}

function deriveCapabilities(
  ui: UIProjectProfile | undefined,
  api: APIProjectProfile | undefined,
  db: DatabaseProjectProfile | undefined,
  commands: ProjectCommandCatalog,
): ProjectCapabilities {
  const hasStart = commands.commands.some((c) => c.purpose === 'start');
  const hasMultiTenant =
    !!db && db.resources.some((r) => r.tenantStrategy && r.tenantStrategy.strategy !== 'none');

  return {
    ui: !!ui,
    api: !!api,
    database: !!db,
    multiTenant: hasMultiTenant,
    localStart: hasStart,
    testDataMutation: !!db || !!api,
    browserExecution: !!ui,
    apiExecution: !!api,
    databaseExecution: !!db,
  };
}

function parseUICatalog(raw: Record<string, unknown>): UIElementCatalog {
  const envId = typeof raw['environmentId'] === 'string' ? raw['environmentId'] : 'default';
  const pagesRaw = Array.isArray(raw['pages']) ? raw['pages'] : [];
  const pages: UIPageDefinition[] = pagesRaw.map((p: unknown) => {
    const page = p as Record<string, unknown>;
    const elementsRaw = Array.isArray(page['elements']) ? page['elements'] : [];
    const elements: UIElementDefinition[] = elementsRaw.map((el: unknown) => {
      const e = el as Record<string, unknown>;
      const loc = (e['locator'] ?? {}) as Record<string, unknown>;
      return {
        logicalName: String(e['logicalName'] ?? ''),
        locator: {
          strategy: (String(loc['strategy'] ?? 'test-id') as UILocatorStrategy),
          value: String(loc['value'] ?? ''),
          role: typeof loc['role'] === 'string' ? loc['role'] : undefined,
          exact: typeof loc['exact'] === 'boolean' ? loc['exact'] : undefined,
        },
        sensitive: typeof e['sensitive'] === 'boolean' ? e['sensitive'] : undefined,
      };
    });
    return {
      id: String(page['id'] ?? ''),
      route: typeof page['route'] === 'string' ? page['route'] : undefined,
      elements,
    };
  });
  return { environmentId: envId, pages };
}

export function validateTenantId(tenantId: string): boolean {
  return SAFE_TENANT_ID_PATTERN.test(tenantId);
}
